use crate::classifier::classify_file;
use crate::types::{FileNode, FileType, PartialScanResult, ScanProgress};
use rayon::prelude::*;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime};
use tauri::{Emitter, Window};

// Maximum depth to scan (prevents infinite recursion)
const MAX_DEPTH: usize = 20;

/// Validates if a path exists and is accessible
///
/// # Arguments
/// * `path` - Path string to validate
///
/// # Returns
/// Result indicating if the path is valid and accessible
pub fn validate_path(path: &str) -> Result<bool, String> {
    let path_buf = PathBuf::from(path);

    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    // Try to read metadata to check accessibility
    match fs::metadata(&path_buf) {
        Ok(_) => Ok(true),
        Err(e) => Err(format!("Path is not accessible: {}", e)),
    }
}

/// Checks if the app has permission to access a path
///
/// # Arguments
/// * `path` - Path string to check
///
/// # Returns
/// Result indicating if the path is accessible (true) or needs permission (false)
pub fn check_path_permissions(path: &str) -> Result<bool, String> {
    let path_buf = PathBuf::from(path);

    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    // For macOS system paths, test access to TCC-protected locations
    #[cfg(target_os = "macos")]
    {
        let is_root_or_system = path == "/"
            || path == "/Volumes/Macintosh HD"
            || path.starts_with("/System")
            || path.starts_with("/Library")
            || path.starts_with("/private")
            || path.starts_with("/usr");

        if is_root_or_system {
            // Try to READ the TCC database - this ALWAYS requires Full Disk Access
            // Just checking metadata isn't enough - we need to actually try to read it
            let tcc_path = PathBuf::from("/Library/Application Support/com.apple.TCC/TCC.db");

            match fs::File::open(&tcc_path) {
                Ok(_) => {
                    // Can open TCC database - Full Disk Access granted
                    return Ok(true);
                }
                Err(_) => {
                    // Cannot open TCC database - Full Disk Access NOT granted
                    return Ok(false);
                }
            }
        }
    }

    // Try to read the directory to check if we have permission
    if path_buf.is_dir() {
        match fs::read_dir(&path_buf) {
            Ok(mut entries) => {
                // Try to actually read an entry to ensure we have real access
                match entries.next() {
                    Some(Ok(_)) => Ok(true),
                    Some(Err(e)) if e.kind() == std::io::ErrorKind::PermissionDenied => Ok(false),
                    None => Ok(true), // Empty directory
                    _ => Ok(true),
                }
            }
            Err(e) => {
                // Check if it's a permission error
                if e.kind() == std::io::ErrorKind::PermissionDenied {
                    Ok(false)
                } else {
                    Err(format!("Error checking permissions: {}", e))
                }
            }
        }
    } else {
        // For files, try to read metadata
        match fs::metadata(&path_buf) {
            Ok(_) => Ok(true),
            Err(e) => {
                if e.kind() == std::io::ErrorKind::PermissionDenied {
                    Ok(false)
                } else {
                    Err(format!("Error checking permissions: {}", e))
                }
            }
        }
    }
}

/// Scans a directory recursively and builds a FileNode tree
///
/// # Arguments
/// * `path` - Root path to scan
/// * `window` - Tauri window for emitting progress events
///
/// # Returns
/// Result containing the root FileNode or an error string
pub async fn scan_directory(path: String, window: Window) -> Result<FileNode, String> {
    let root_path = PathBuf::from(&path);

    // Validate the path first
    validate_path(&path)?;

    // Run the blocking scan operation in a separate thread
    let result = tokio::task::spawn_blocking(move || -> Result<FileNode, String> {
        let mut files_scanned = 0u64;
        let mut total_size = 0u64;
        let mut last_emit = Instant::now();

        let result = build_tree_sync_progressive(
            &root_path,
            &window,
            &mut files_scanned,
            &mut total_size,
            &mut last_emit,
            true, // is_root
        )?;

        // Emit final complete result
        let final_result = PartialScanResult {
            tree: result.clone(),
            files_scanned,
            total_size,
            is_complete: true,
        };

        if let Err(e) = window.emit("partial-scan-result", &final_result) {
            eprintln!("Failed to emit final scan result: {}", e);
        }

        Ok(result)
    })
    .await
    .map_err(|e| format!("Scan task failed: {}", e))??;

    Ok(result)
}

/// Recursively builds a FileNode tree with progressive emission (synchronous version)
///
/// # Arguments
/// * `path` - Current path to process
/// * `window` - Tauri window for emitting progress events
/// * `files_scanned` - Counter for total files scanned
/// * `total_size` - Accumulator for total size
/// * `last_emit` - Timestamp of last partial result emission
/// * `is_root` - Whether this is the root node
///
/// # Returns
/// Result containing a FileNode or an error string
fn build_tree_sync_progressive(
    path: &Path,
    window: &Window,
    files_scanned: &mut u64,
    total_size: &mut u64,
    last_emit: &mut Instant,
    is_root: bool,
) -> Result<FileNode, String> {
    build_tree_sync_progressive_depth(
        path,
        window,
        files_scanned,
        total_size,
        last_emit,
        is_root,
        0,
    )
}

fn build_tree_sync_progressive_depth(
    path: &Path,
    window: &Window,
    files_scanned: &mut u64,
    total_size: &mut u64,
    last_emit: &mut Instant,
    is_root: bool,
    depth: usize,
) -> Result<FileNode, String> {
    // Only log root calls to reduce noise
    if is_root {
        eprintln!("=== SCANNING ROOT: {} ===", path.display());
    }

    // Stop if we've gone too deep (safety limit)
    if depth > MAX_DEPTH {
        eprintln!("Max depth ({}) reached at: {}", MAX_DEPTH, path.display());
        return Ok(FileNode {
            name: path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string(),
            path: path.to_path_buf(),
            size: 0,
            is_directory: true,
            children: vec![],
            file_type: FileType::Other,
            modified: SystemTime::UNIX_EPOCH,
        });
    }

    // Handle symbolic links - use symlink_metadata to avoid following them
    let metadata = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(e) => {
            // Log permission errors but continue
            eprintln!(
                "Permission denied or error accessing {}: {}",
                path.display(),
                e
            );
            return Err(format!("Error accessing path: {}", e));
        }
    };

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);

    // Handle symbolic links as special files with zero size
    if metadata.is_symlink() {
        *files_scanned += 1;

        return Ok(FileNode {
            name,
            path: path.to_path_buf(),
            size: 0,
            is_directory: false,
            children: vec![],
            file_type: FileType::Other,
            modified,
        });
    }

    if metadata.is_file() {
        // Handle file (including zero-byte files)
        let size = metadata.len();
        let file_type = classify_file(path);

        *files_scanned += 1;
        *total_size += size;

        // Emit progress event every 100 files
        if *files_scanned % 100 == 0 {
            emit_progress(window, path, *files_scanned, *total_size);
        }

        Ok(FileNode {
            name,
            path: path.to_path_buf(),
            size,
            is_directory: false,
            children: vec![],
            file_type,
            modified,
        })
    } else if metadata.is_dir() {
        // Handle directory (including empty directories)
        let mut children = Vec::new();
        let mut dir_size = 0u64;

        if is_root {
            eprintln!("=== Processing root directory: {} ===", path.display());
        }

        // Emit progress for directory
        emit_progress(window, path, *files_scanned, *total_size);

        // Read directory entries
        match fs::read_dir(path) {
            Ok(entries) => {
                // Collect all entries first
                let entry_paths: Vec<PathBuf> =
                    entries.filter_map(|e| e.ok()).map(|e| e.path()).collect();

                // For root directory, process children in parallel for better performance
                if is_root && entry_paths.len() > 1 {
                    eprintln!(
                        "Processing {} top-level items in parallel",
                        entry_paths.len()
                    );

                    // Use Arc to share state across threads
                    let files_scanned_arc = Arc::new(Mutex::new(*files_scanned));
                    let total_size_arc = Arc::new(Mutex::new(*total_size));
                    let children_arc = Arc::new(Mutex::new(Vec::new()));
                    let last_emit_arc = Arc::new(Mutex::new(*last_emit));

                    // Process entries in parallel
                    entry_paths.par_iter().for_each(|entry_path| {
                        let mut local_files = 0u64;
                        let mut local_size = 0u64;
                        let mut local_last_emit = Instant::now();

                        match build_tree_sync_progressive_depth(
                            entry_path,
                            window,
                            &mut local_files,
                            &mut local_size,
                            &mut local_last_emit,
                            false,
                            depth + 1,
                        ) {
                            Ok(node) => {
                                // Update shared state
                                let mut fs = files_scanned_arc.lock().unwrap();
                                *fs += local_files;
                                let current_files = *fs;
                                drop(fs);

                                let mut ts = total_size_arc.lock().unwrap();
                                *ts += local_size;
                                let current_size = *ts;
                                drop(ts);

                                let mut children_lock = children_arc.lock().unwrap();
                                children_lock.push(node);
                                let children_count = children_lock.len();
                                drop(children_lock);

                                // Emit partial result every 3 completed directories or every 2 seconds
                                let mut last_emit_lock = last_emit_arc.lock().unwrap();
                                if children_count % 3 == 0 || last_emit_lock.elapsed().as_secs() > 2
                                {
                                    let children_snapshot = children_arc.lock().unwrap().clone();

                                    let partial_tree = FileNode {
                                        name: name.clone(),
                                        path: path.to_path_buf(),
                                        size: children_snapshot.iter().map(|c| c.size).sum(),
                                        is_directory: true,
                                        children: children_snapshot,
                                        file_type: FileType::Other,
                                        modified,
                                    };

                                    eprintln!(
                                        "Emitting partial result: {} children, {} files",
                                        children_count, current_files
                                    );
                                    emit_partial_result(
                                        window,
                                        &partial_tree,
                                        current_files,
                                        current_size,
                                    );
                                    *last_emit_lock = Instant::now();
                                }
                            }
                            Err(e) => {
                                eprintln!("Error scanning {}: {}", entry_path.display(), e);
                            }
                        }
                    });

                    // Update counters from parallel results
                    *files_scanned = *files_scanned_arc.lock().unwrap();
                    *total_size = *total_size_arc.lock().unwrap();
                    *last_emit = *last_emit_arc.lock().unwrap();

                    // Collect final results
                    children = children_arc.lock().unwrap().clone();
                    dir_size = children.iter().map(|c| c.size).sum();

                    eprintln!(
                        "Parallel scan complete: {} children, {} files",
                        children.len(),
                        *files_scanned
                    );
                } else {
                    // Sequential processing for non-root or small directories
                    for entry_path in entry_paths {
                        match build_tree_sync_progressive_depth(
                            &entry_path,
                            window,
                            files_scanned,
                            total_size,
                            last_emit,
                            false,
                            depth + 1,
                        ) {
                            Ok(child_node) => {
                                let is_child_dir = child_node.is_directory;
                                dir_size += child_node.size;
                                children.push(child_node);

                                // Emit partial result after completing each top-level directory
                                // OR if enough time has passed (500ms)
                                let should_emit = is_root
                                    && is_child_dir
                                    && (children.len() % 5 == 0
                                        || last_emit.elapsed().as_millis() > 500);

                                if should_emit {
                                    eprintln!("Condition met: is_root={}, is_child_dir={}, children={}, elapsed={}ms", 
                                        is_root, is_child_dir, children.len(), last_emit.elapsed().as_millis());

                                    let partial_tree = FileNode {
                                        name: name.clone(),
                                        path: path.to_path_buf(),
                                        size: dir_size,
                                        is_directory: true,
                                        children: children.clone(),
                                        file_type: FileType::Other,
                                        modified,
                                    };

                                    emit_partial_result(
                                        window,
                                        &partial_tree,
                                        *files_scanned,
                                        *total_size,
                                    );
                                    *last_emit = Instant::now();
                                }
                            }
                            Err(e) => {
                                eprintln!("Error scanning {}: {}", entry_path.display(), e);
                            }
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!(
                    "Permission denied reading directory {}: {}",
                    path.display(),
                    e
                );
                // Return empty directory node on permission error
                // This allows the scan to continue even if some directories are inaccessible
            }
        }

        // Empty directories will have size 0 and empty children vec
        Ok(FileNode {
            name,
            path: path.to_path_buf(),
            size: dir_size, // Aggregate size of all children (0 for empty dirs)
            is_directory: true,
            children,
            file_type: FileType::Other,
            modified,
        })
    } else {
        // Handle other special file types (devices, pipes, etc.)
        *files_scanned += 1;

        Ok(FileNode {
            name,
            path: path.to_path_buf(),
            size: 0,
            is_directory: false,
            children: vec![],
            file_type: FileType::Other,
            modified,
        })
    }
}

/// Emits a partial scan result to the frontend
///
/// # Arguments
/// * `window` - Tauri window to emit the event to
/// * `tree` - Current state of the file tree
/// * `files_scanned` - Total files scanned so far
/// * `total_size` - Total size accumulated so far
fn emit_partial_result(window: &Window, tree: &FileNode, files_scanned: u64, total_size: u64) {
    eprintln!(
        "Emitting partial result: {} files, {} children",
        files_scanned,
        tree.children.len()
    );

    let partial = PartialScanResult {
        tree: tree.clone(),
        files_scanned,
        total_size,
        is_complete: false,
    };

    if let Err(e) = window.emit("partial-scan-result", &partial) {
        eprintln!("Failed to emit partial result: {}", e);
    } else {
        eprintln!("Successfully emitted partial result");
    }
}

/// Emits a progress event to the frontend
///
/// # Arguments
/// * `window` - Tauri window to emit the event to
/// * `current_path` - Current path being scanned
/// * `files_scanned` - Total files scanned so far
/// * `total_size` - Total size accumulated so far
fn emit_progress(window: &Window, current_path: &Path, files_scanned: u64, total_size: u64) {
    let progress = ScanProgress {
        current_path: current_path.to_string_lossy().to_string(),
        files_scanned,
        total_size,
    };

    // Emit event to frontend
    if let Err(e) = window.emit("scan-progress", &progress) {
        eprintln!("Failed to emit progress event: {}", e);
    }
}
