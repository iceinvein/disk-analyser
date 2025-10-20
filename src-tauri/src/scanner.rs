use crate::classifier::classify_file;
use crate::types::{FileNode, FileType, StreamingScanEvent};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tauri::{Emitter, Window};
use tokio::fs;
use tokio::sync::{mpsc, Mutex, Semaphore};
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;

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
const BATCH_SIZE: usize = 200; // Emit after this many events (increased from 50 for better performance)
const BATCH_INTERVAL_MS: u64 = 500; // Or after this many milliseconds (increased from 100ms to reduce UI updates)

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

    // Create channel for streaming events with larger buffer
    // Use unbounded to prevent blocking during heavy scans
    let (tx, mut rx) = mpsc::unbounded_channel::<StreamingScanEvent>();

    // Spawn batching event emitter task
    let window_clone = window.clone();
    let event_task = tokio::spawn(async move {
        let mut batch = Vec::new();
        let mut last_emit = Instant::now();

        loop {
            tokio::select! {
                // Receive events from scanner
                event = rx.recv() => {
                    match event {
                        Some(evt) => {
                            batch.push(evt);

                            // Emit batch if size threshold reached or time elapsed
                            let should_emit = batch.len() >= BATCH_SIZE ||
                                last_emit.elapsed().as_millis() >= BATCH_INTERVAL_MS as u128;

                            if should_emit {
                                for event in batch.drain(..) {
                                    let _ = window_clone.emit("streaming-scan-event", &event);
                                }
                                last_emit = Instant::now();
                            }
                        }
                        None => {
                            for event in batch.drain(..) {
                                let _ = window_clone.emit("streaming-scan-event", &event);
                            }
                            break;
                        }
                    }
                }
                // Periodic flush even if batch not full
                _ = sleep(Duration::from_millis(BATCH_INTERVAL_MS)) => {
                    if !batch.is_empty() {
                        for event in batch.drain(..) {
                            let _ = window_clone.emit("streaming-scan-event", &event);
                        }
                        last_emit = Instant::now();
                    }
                }
            }
        }
    });

    // Scan the directory tree with progressive updates for root level
    let result = scan_root_with_updates(
        root_path.clone(),
        semaphore,
        tx.clone(),
        window.clone(),
        cancel_token.clone(),
    )
    .await;

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
    event_tx: mpsc::UnboundedSender<StreamingScanEvent>,
    cancel_token: CancellationToken,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send>> {
    Box::pin(async move {
        scan_progressive_impl(
            path,
            parent_path,
            registry,
            semaphore,
            event_tx,
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
    event_tx: mpsc::UnboundedSender<StreamingScanEvent>,
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

    if !metadata.is_dir() || metadata.is_symlink() {
        // File or symlink - add to registry and emit node update
        let size = metadata.len();
        let file_type = classify_file(&path);

        registry.lock().await.insert(
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

        // Emit incremental node update
        let _ = event_tx.send(StreamingScanEvent::NodeUpdate {
            path: path.to_string_lossy().to_string(),
            parent_path: parent_path.map(|p| p.to_string_lossy().to_string()),
            name,
            size,
            is_directory: false,
            file_type,
        });

        return Ok(());
    }

    // Directory - add to registry as incomplete and emit node update
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

    // Emit incremental node update for directory
    let _ = event_tx.send(StreamingScanEvent::NodeUpdate {
        path: path.to_string_lossy().to_string(),
        parent_path: parent_path.map(|p| p.to_string_lossy().to_string()),
        name,
        size: 0,
        is_directory: true,
        file_type,
    });

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
        let tx = event_tx.clone();
        let parent = Some(path.clone());
        let cancel_clone = cancel_token.clone();

        let handle = tokio::task::spawn(async move {
            scan_progressive(entry_path, parent, registry_clone, sem, tx, cancel_clone).await
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
    event_tx: mpsc::UnboundedSender<StreamingScanEvent>,
    _window: Window,
    cancel_token: CancellationToken,
) -> Result<FileNode, String> {
    // Create shared registry for discovered nodes
    let registry: NodeRegistry = Arc::new(Mutex::new(HashMap::new()));

    // Start the progressive scan (no snapshots - frontend handles incremental updates)
    let registry_clone = registry.clone();
    let sem_clone = semaphore.clone();
    let tx_clone = event_tx.clone();
    let root_path_clone = path.clone();
    let cancel_clone = cancel_token.clone();

    scan_progressive(
        root_path_clone,
        None,
        registry_clone,
        sem_clone,
        tx_clone,
        cancel_clone,
    )
    .await?;

    // Build a minimal tree just for the return value (Tauri command requires it)
    // Frontend already has the complete tree from incremental updates
    let reg = registry.lock().await;
    let final_tree = build_tree_from_registry_with_depth(&reg, &path, 100)
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

    build_tree_recursive(registry, &parent_to_children, path, 0, max_depth)
}

fn build_tree_recursive(
    registry: &HashMap<PathBuf, DiscoveredNode>,
    parent_to_children: &HashMap<PathBuf, Vec<PathBuf>>,
    path: &PathBuf,
    current_depth: usize,
    max_depth: usize,
) -> Option<FileNode> {
    let node = registry.get(path)?;

    if !node.is_directory {
        // Leaf node (file)
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

    // Directory node
    let mut children = Vec::new();
    let mut total_size = 0u64;

    // Only recurse if we haven't hit max depth
    if current_depth < max_depth {
        if let Some(child_paths) = parent_to_children.get(path) {
            for child_path in child_paths {
                if let Some(child_tree) = build_tree_recursive(
                    registry,
                    parent_to_children,
                    child_path,
                    current_depth + 1,
                    max_depth,
                ) {
                    total_size += child_tree.size;
                    children.push(child_tree);
                }
            }
        }

        // Sort children by size (largest first) - only top 50 to save time
        children.sort_by(|a, b| b.size.cmp(&a.size));
        if children.len() > 50 {
            children.truncate(50);
        }
    } else {
        // At max depth - just calculate total size without building children
        if let Some(child_paths) = parent_to_children.get(path) {
            for child_path in child_paths {
                if let Some(child_node) = registry.get(child_path) {
                    total_size += if child_node.is_directory {
                        // For directories at max depth, sum their subtree
                        calculate_subtree_size(registry, parent_to_children, child_path)
                    } else {
                        child_node.size
                    };
                }
            }
        }
    }

    Some(FileNode {
        name: node.name.clone(),
        path: node.path.clone(),
        size: total_size,
        is_directory: true,
        file_type: FileType::Other,
        children,
        modified: node.modified,
    })
}

/// Calculate total size of a subtree without building the tree structure
fn calculate_subtree_size(
    registry: &HashMap<PathBuf, DiscoveredNode>,
    parent_to_children: &HashMap<PathBuf, Vec<PathBuf>>,
    path: &PathBuf,
) -> u64 {
    let mut total = 0u64;

    if let Some(node) = registry.get(path) {
        if !node.is_directory {
            return node.size;
        }

        if let Some(child_paths) = parent_to_children.get(path) {
            for child_path in child_paths {
                total += calculate_subtree_size(registry, parent_to_children, child_path);
            }
        }
    }

    total
}
