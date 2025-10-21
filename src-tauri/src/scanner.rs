use crate::classifier::classify_file;
use crate::types::{FileNode, FileType, StreamingScanEvent};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tauri::{Emitter, Window};
use tokio::fs;
use tokio::sync::{mpsc, Mutex, Semaphore};
use tokio_util::sync::CancellationToken;

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

const MAX_CONCURRENT_DIRS: usize = 100; // Limit concurrent directory scans

/// Global cancellation token for the current scan
static SCAN_CANCELLATION: once_cell::sync::Lazy<Arc<Mutex<Option<CancellationToken>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(None)));

/// Validates if a path exists and is accessible
pub fn validate_path(path: &str) -> Result<bool, String> {
    let path_buf = PathBuf::from(path);

    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    // Try to read metadata to check accessibility
    match std::fs::metadata(&path_buf) {
        Ok(_) => Ok(true),
        Err(e) => Err(format!("Path is not accessible: {}", e)),
    }
}

/// Checks if the app has permission to access a path
pub fn check_path_permissions(path: &str) -> Result<bool, String> {
    let path_buf = PathBuf::from(path);

    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    // For macOS system paths, test access to TCC-protected locations
    #[cfg(target_os = "macos")]
    {
        // Try to read the directory to check for Full Disk Access
        match std::fs::read_dir(&path_buf) {
            Ok(_) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => Ok(false),
            Err(e) => Err(format!("Error checking permissions: {}", e)),
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        // On other platforms, just check if we can read metadata
        match std::fs::metadata(&path_buf) {
            Ok(_) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => Ok(false),
            Err(e) => Err(format!("Error checking permissions: {}", e)),
        }
    }
}

/// Cancel the current scan operation
pub async fn cancel_scan() -> Result<(), String> {
    let mut cancellation = SCAN_CANCELLATION.lock().await;
    if let Some(token) = cancellation.take() {
        token.cancel();
        Ok(())
    } else {
        Err("No scan is currently running".to_string())
    }
}

const BATCH_INTERVAL_MS: u64 = 500; // Progress update interval in milliseconds

/// Represents a discovered node during progressive scanning
#[derive(Clone, Debug)]
struct DiscoveredNode {
    path: PathBuf,
    name: String,
    size: u64,
    is_directory: bool,
    file_type: FileType,
    modified: SystemTime,
    parent_path: Option<PathBuf>,
    is_complete: bool, // true if directory fully scanned
}

/// Shared registry of discovered nodes
type NodeRegistry = Arc<Mutex<HashMap<PathBuf, DiscoveredNode>>>;

/// Progress stats for tracking scan progress
#[derive(Debug)]
struct ProgressStats {
    files_scanned: u64,
    total_size: u64,
    current_path: String,
    #[cfg(unix)]
    seen_inodes: HashSet<u64>, // Track inodes to avoid counting hard links multiple times
}

pub async fn scan_directory_async(path: String, window: Window) -> Result<FileNode, String> {
    let root_path = PathBuf::from(&path);

    // Validate path
    if !root_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    // Create new cancellation token for this scan
    let cancel_token = CancellationToken::new();
    {
        let mut cancellation = SCAN_CANCELLATION.lock().await;
        *cancellation = Some(cancel_token.clone());
    }

    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_DIRS));

    // Create progress tracker
    let progress = Arc::new(Mutex::new(ProgressStats {
        files_scanned: 0,
        total_size: 0,
        current_path: path.clone(),
        #[cfg(unix)]
        seen_inodes: HashSet::new(),
    }));

    // Create channel for streaming events with larger buffer
    // Use unbounded to prevent blocking during heavy scans
    let (tx, mut rx) = mpsc::unbounded_channel::<StreamingScanEvent>();

    // Spawn progress emitter task - emits progress updates periodically
    let window_clone = window.clone();
    let progress_clone = progress.clone();
    let progress_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(BATCH_INTERVAL_MS));
        loop {
            interval.tick().await;

            let (files_scanned, total_size, current_path) = {
                let stats = progress_clone.lock().await;
                (
                    stats.files_scanned,
                    stats.total_size,
                    stats.current_path.clone(),
                )
            };
            let _ = window_clone.emit(
                "streaming-scan-event",
                &StreamingScanEvent::Progress {
                    files_scanned,
                    total_size,
                    current_path,
                },
            );
        }
    });

    // Spawn completion event handler
    let window_clone2 = window.clone();
    let event_task = tokio::spawn(async move {
        while let Some(evt) = rx.recv().await {
            let _ = window_clone2.emit("streaming-scan-event", &evt);
        }
    });

    // Scan the directory tree with progressive updates for root level
    let result = scan_root_with_updates(
        root_path.clone(),
        semaphore,
        progress.clone(),
        window.clone(),
        cancel_token.clone(),
    )
    .await;

    // Abort progress task
    progress_task.abort();

    // Clear the cancellation token
    {
        let mut cancellation = SCAN_CANCELLATION.lock().await;
        *cancellation = None;
    }

    let result = result?;

    let total_files = count_files(&result);
    let total_size = result.size;

    // Send completion event
    let _ = tx.send(StreamingScanEvent::Complete {
        files_scanned: total_files,
        total_size,
    });

    // Close channel and wait for event task to finish
    drop(tx);
    let _ = event_task.await;

    Ok(result)
}

/// Top-down progressive scanner that populates the registry
fn scan_progressive(
    path: PathBuf,
    parent_path: Option<PathBuf>,
    registry: NodeRegistry,
    semaphore: Arc<Semaphore>,
    progress: Arc<Mutex<ProgressStats>>,
    cancel_token: CancellationToken,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send>> {
    Box::pin(async move {
        scan_progressive_impl(
            path,
            parent_path,
            registry,
            semaphore,
            progress,
            cancel_token,
        )
        .await
    })
}

async fn scan_progressive_impl(
    path: PathBuf,
    parent_path: Option<PathBuf>,
    registry: NodeRegistry,
    semaphore: Arc<Semaphore>,
    progress: Arc<Mutex<ProgressStats>>,
    cancel_token: CancellationToken,
) -> Result<(), String> {
    // Check if scan was cancelled
    if cancel_token.is_cancelled() {
        return Err("Scan cancelled".to_string());
    }

    let _permit = semaphore.acquire().await.expect("semaphore closed");

    let metadata = fs::symlink_metadata(&path)
        .await
        .map_err(|e| format!("Cannot access {}: {}", path.display(), e))?;

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);

    // Skip symlinks entirely to avoid double-counting and confusion
    if metadata.is_symlink() {
        return Ok(());
    }

    if !metadata.is_dir() {
        // Regular file - add to registry and update progress
        // On Unix, use blocks * 512 to get actual disk usage (handles sparse files correctly)
        #[cfg(unix)]
        let size = metadata.blocks() * 512;

        #[cfg(not(unix))]
        let size = metadata.len();

        let file_type = classify_file(&path);

        // Check if this file was already scanned (shouldn't happen, but be safe)
        let is_new = {
            let mut reg = registry.lock().await;
            let was_present = reg.contains_key(&path);
            reg.insert(
                path.clone(),
                DiscoveredNode {
                    path: path.clone(),
                    name: name.clone(),
                    size,
                    is_directory: false,
                    file_type: file_type.clone(),
                    modified,
                    parent_path: parent_path.clone(),
                    is_complete: true,
                },
            );
            !was_present
        };

        // Only update progress stats if this is a new file
        if is_new {
            let mut stats = progress.lock().await;

            // On Unix, check if we've seen this inode before (hard link detection)
            #[cfg(unix)]
            let is_new_inode = {
                let inode = metadata.ino();
                stats.seen_inodes.insert(inode)
            };

            #[cfg(not(unix))]
            let is_new_inode = true;

            // Only count size if this is a new inode (not a hard link)
            if is_new_inode {
                stats.files_scanned += 1;
                stats.total_size += size;
            }
            stats.current_path = path.to_string_lossy().to_string();
        }

        return Ok(());
    }

    // Directory - add to registry
    let file_type = FileType::Other;

    registry.lock().await.insert(
        path.clone(),
        DiscoveredNode {
            path: path.clone(),
            name: name.clone(),
            size: 0,
            is_directory: true,
            file_type: file_type.clone(),
            modified,
            parent_path: parent_path.clone(),
            is_complete: false,
        },
    );

    // Update progress with current directory
    {
        let mut stats = progress.lock().await;
        stats.current_path = path.to_string_lossy().to_string();
    }

    // Read directory entries
    let mut entries = fs::read_dir(&path)
        .await
        .map_err(|e| format!("Cannot read directory {}: {}", path.display(), e))?;

    let mut child_handles = Vec::new();

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| format!("Error reading entry: {}", e))?
    {
        let entry_path = entry.path();
        let registry_clone = registry.clone();
        let sem = semaphore.clone();
        let progress_clone = progress.clone();
        let parent = Some(path.clone());
        let cancel_clone = cancel_token.clone();

        let handle = tokio::task::spawn(async move {
            scan_progressive(
                entry_path,
                parent,
                registry_clone,
                sem,
                progress_clone,
                cancel_clone,
            )
            .await
        });

        child_handles.push(handle);
    }

    // Release permit before waiting
    drop(_permit);

    // Wait for all children
    for handle in child_handles {
        let _ = handle.await;
    }

    // Mark directory as complete
    if let Some(node) = registry.lock().await.get_mut(&path) {
        node.is_complete = true;
    }

    Ok(())
}

/// Special root-level scan that sends time-based partial tree snapshots
async fn scan_root_with_updates(
    path: PathBuf,
    semaphore: Arc<Semaphore>,
    progress: Arc<Mutex<ProgressStats>>,
    _window: Window,
    cancel_token: CancellationToken,
) -> Result<FileNode, String> {
    // Create shared registry for discovered nodes
    let registry: NodeRegistry = Arc::new(Mutex::new(HashMap::new()));

    // Start the progressive scan
    let registry_clone = registry.clone();
    let sem_clone = semaphore.clone();
    let progress_clone = progress.clone();
    let root_path_clone = path.clone();
    let cancel_clone = cancel_token.clone();

    scan_progressive(
        root_path_clone,
        None,
        registry_clone,
        sem_clone,
        progress_clone,
        cancel_clone,
    )
    .await?;

    // Build a shallow tree for initial display (depth 2)
    // This prevents freezing when dealing with millions of files
    // Deeper levels can be loaded on-demand by the frontend
    let reg = registry.lock().await;
    let final_tree = build_tree_from_registry_with_depth(&reg, &path, 2)
        .ok_or_else(|| "Failed to build final tree".to_string())?;

    Ok(final_tree)
}

fn count_files(node: &FileNode) -> u64 {
    if !node.is_directory {
        return 1;
    }

    node.children.iter().map(|c| count_files(c)).sum()
}

fn build_tree_from_registry_with_depth(
    registry: &HashMap<PathBuf, DiscoveredNode>,
    path: &PathBuf,
    max_depth: usize,
) -> Option<FileNode> {
    // Build parent->children index for O(1) lookups
    let mut parent_to_children: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
    for (child_path, child_node) in registry.iter() {
        if let Some(parent) = &child_node.parent_path {
            parent_to_children
                .entry(parent.clone())
                .or_insert_with(Vec::new)
                .push(child_path.clone());
        }
    }

    // Don't pre-calculate all sizes - calculate on-demand with memoization
    // This way we only calculate sizes for nodes we actually include in the tree
    let mut size_cache: HashMap<PathBuf, u64> = HashMap::new();

    build_tree_recursive_lazy(
        registry,
        &parent_to_children,
        &mut size_cache,
        path,
        0,
        max_depth,
    )
}

/// Build tree recursively with lazy size calculation (only for nodes we include)
fn build_tree_recursive_lazy(
    registry: &HashMap<PathBuf, DiscoveredNode>,
    parent_to_children: &HashMap<PathBuf, Vec<PathBuf>>,
    size_cache: &mut HashMap<PathBuf, u64>,
    path: &PathBuf,
    current_depth: usize,
    max_depth: usize,
) -> Option<FileNode> {
    let node = registry.get(path)?;

    if !node.is_directory {
        // File - return immediately with its size
        return Some(FileNode {
            name: node.name.clone(),
            path: node.path.clone(),
            size: node.size,
            is_directory: false,
            file_type: node.file_type.clone(),
            children: vec![],
            modified: node.modified,
        });
    }

    // Directory - build children if within depth limit
    let mut children = Vec::new();

    if current_depth < max_depth {
        if let Some(child_paths) = parent_to_children.get(path) {
            for child_path in child_paths {
                if let Some(child_tree) = build_tree_recursive_lazy(
                    registry,
                    parent_to_children,
                    size_cache,
                    child_path,
                    current_depth + 1,
                    max_depth,
                ) {
                    children.push(child_tree);
                }
            }
        }

        // Sort by size and limit to top 100
        children.sort_by(|a, b| b.size.cmp(&a.size));
        if children.len() > 100 {
            children.truncate(100);
        }
    }

    // Calculate size for this directory (with memoization)
    let dir_size = calculate_dir_size_lazy(registry, parent_to_children, size_cache, path);

    Some(FileNode {
        name: node.name.clone(),
        path: node.path.clone(),
        size: dir_size,
        is_directory: true,
        file_type: FileType::Other,
        children,
        modified: node.modified,
    })
}

/// Calculate directory size recursively with memoization
fn calculate_dir_size_lazy(
    registry: &HashMap<PathBuf, DiscoveredNode>,
    parent_to_children: &HashMap<PathBuf, Vec<PathBuf>>,
    cache: &mut HashMap<PathBuf, u64>,
    path: &PathBuf,
) -> u64 {
    // Check cache first
    if let Some(&size) = cache.get(path) {
        return size;
    }

    let node = match registry.get(path) {
        Some(n) => n,
        None => return 0,
    };

    let size = if !node.is_directory {
        node.size
    } else {
        // Sum all children
        let mut total = 0u64;
        if let Some(child_paths) = parent_to_children.get(path) {
            for child_path in child_paths {
                total += calculate_dir_size_lazy(registry, parent_to_children, cache, child_path);
            }
        }
        total
    };

    cache.insert(path.clone(), size);
    size
}
