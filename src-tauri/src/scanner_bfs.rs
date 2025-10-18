use crate::classifier::classify_file;
use crate::types::{FileNode, FileType, PartialScanResult};
use rayon::prelude::*;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime};
use tauri::{Emitter, Window};

const MAX_DEPTH: usize = 15; // Reduced for better performance

/// Breadth-first hierarchical scanner
/// Scans level by level, emitting results after each level completes
pub async fn scan_directory_bfs(path: String, window: Window) -> Result<FileNode, String> {
    let root_path = PathBuf::from(&path);

    // Validate path exists
    if !root_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    // Run breadth-first scan in blocking thread
    let result = tokio::task::spawn_blocking(move || -> Result<FileNode, String> {
        eprintln!(
            "=== Starting breadth-first scan: {} ===",
            root_path.display()
        );

        let mut files_scanned = 0u64;
        let mut total_size = 0u64;

        // Level 0: Scan immediate children only (fast!)
        let mut root = scan_immediate_children(&root_path, &mut files_scanned, &mut total_size)?;

        // Emit level 0 immediately
        emit_partial(&window, &root, files_scanned, total_size);
        eprintln!("✓ Level 0: {} items", root.children.len());

        // Progressively scan deeper levels with parallel processing
        let start_time = Instant::now();
        let mut last_emit = Instant::now();

        for level in 1..=MAX_DEPTH {
            let dirs_at_level = count_dirs_at_level(&root, level);
            if dirs_at_level == 0 {
                break; // No more directories to scan
            }

            eprintln!("→ Scanning level {}: {} directories", level, dirs_at_level);

            // Scan all directories at this level IN PARALLEL
            scan_level_parallel(
                &mut root,
                level,
                0,
                &mut files_scanned,
                &mut total_size,
                &window,
                &mut last_emit,
            );

            // Update sizes up the tree
            update_sizes(&mut root);

            // Emit after each level
            emit_partial(&window, &root, files_scanned, total_size);
            eprintln!(
                "✓ Level {}: {} files, {:.1}s elapsed",
                level,
                files_scanned,
                start_time.elapsed().as_secs_f32()
            );

            // Stop if taking too long (safety)
            if start_time.elapsed().as_secs() > 300 {
                eprintln!("⚠ Scan timeout at level {}", level);
                break;
            }
        }

        // Final emission
        let final_result = PartialScanResult {
            tree: root.clone(),
            files_scanned,
            total_size,
            is_complete: true,
        };

        if let Err(e) = window.emit("partial-scan-result", &final_result) {
            eprintln!("Failed to emit final result: {}", e);
        }

        eprintln!("=== Scan complete: {} files ===", files_scanned);
        Ok(root)
    })
    .await
    .map_err(|e| format!("Scan failed: {}", e))??;

    Ok(result)
}

/// Scan immediate children of a directory (no recursion)
fn scan_immediate_children(
    path: &Path,
    files_scanned: &mut u64,
    total_size: &mut u64,
) -> Result<FileNode, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|e| format!("Cannot access {}: {}", path.display(), e))?;

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);

    if !metadata.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let mut children = Vec::new();
    let mut dir_size = 0u64;

    // Read immediate children
    match fs::read_dir(path) {
        Ok(entries) => {
            for entry_result in entries {
                if let Ok(entry) = entry_result {
                    let entry_path = entry.path();

                    if let Ok(meta) = fs::symlink_metadata(&entry_path) {
                        let child_name = entry.file_name().to_string_lossy().to_string();
                        let is_dir = meta.is_dir() && !meta.is_symlink();
                        let size = if is_dir { 0 } else { meta.len() };
                        let file_type = if is_dir {
                            FileType::Other
                        } else {
                            classify_file(&entry_path)
                        };
                        let child_modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);

                        if !is_dir {
                            *files_scanned += 1;
                            *total_size += size;
                            dir_size += size;
                        }

                        children.push(FileNode {
                            name: child_name,
                            path: entry_path,
                            size,
                            is_directory: is_dir,
                            children: vec![],
                            file_type,
                            modified: child_modified,
                        });
                    }
                }
            }
        }
        Err(e) => {
            eprintln!("Cannot read {}: {}", path.display(), e);
        }
    }

    Ok(FileNode {
        name,
        path: path.to_path_buf(),
        size: dir_size,
        is_directory: true,
        children,
        file_type: FileType::Other,
        modified,
    })
}

/// Count directories at a specific level
fn count_dirs_at_level(node: &FileNode, target_level: usize) -> usize {
    count_dirs_recursive(node, target_level, 0)
}

fn count_dirs_recursive(node: &FileNode, target_level: usize, current_level: usize) -> usize {
    if current_level == target_level {
        return if node.is_directory && node.children.is_empty() {
            1
        } else {
            0
        };
    }

    node.children
        .iter()
        .map(|child| count_dirs_recursive(child, target_level, current_level + 1))
        .sum()
}

/// Scan all directories at a specific level IN PARALLEL
fn scan_level_parallel(
    node: &mut FileNode,
    target_level: usize,
    current_level: usize,
    files_scanned: &mut u64,
    total_size: &mut u64,
    window: &Window,
    last_emit: &mut Instant,
) {
    if current_level == target_level {
        if node.is_directory && node.children.is_empty() {
            // Scan this directory's children
            match fs::read_dir(&node.path) {
                Ok(entries) => {
                    for entry_result in entries {
                        if let Ok(entry) = entry_result {
                            let entry_path = entry.path();

                            if let Ok(meta) = fs::symlink_metadata(&entry_path) {
                                let child_name = entry.file_name().to_string_lossy().to_string();
                                let is_dir = meta.is_dir() && !meta.is_symlink();
                                let size = if is_dir { 0 } else { meta.len() };
                                let file_type = if is_dir {
                                    FileType::Other
                                } else {
                                    classify_file(&entry_path)
                                };
                                let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);

                                if !is_dir {
                                    *files_scanned += 1;
                                    *total_size += size;
                                }

                                node.children.push(FileNode {
                                    name: child_name,
                                    path: entry_path,
                                    size,
                                    is_directory: is_dir,
                                    children: vec![],
                                    file_type,
                                    modified,
                                });
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Cannot read {}: {}", node.path.display(), e);
                }
            }
        }
        return;
    }

    // For level 1, use parallel processing
    if current_level == 0 && target_level == 1 {
        // Parallel scan of top-level directories
        let files_arc = Arc::new(Mutex::new(*files_scanned));
        let size_arc = Arc::new(Mutex::new(*total_size));

        node.children.par_iter_mut().for_each(|child| {
            if child.is_directory && child.children.is_empty() {
                let mut local_files = 0u64;
                let mut local_size = 0u64;

                // Scan this child
                if let Ok(entries) = fs::read_dir(&child.path) {
                    for entry_result in entries {
                        if let Ok(entry) = entry_result {
                            let entry_path = entry.path();

                            if let Ok(meta) = fs::symlink_metadata(&entry_path) {
                                let child_name = entry.file_name().to_string_lossy().to_string();
                                let is_dir = meta.is_dir() && !meta.is_symlink();
                                let size = if is_dir { 0 } else { meta.len() };
                                let file_type = if is_dir {
                                    FileType::Other
                                } else {
                                    classify_file(&entry_path)
                                };
                                let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);

                                if !is_dir {
                                    local_files += 1;
                                    local_size += size;
                                }

                                child.children.push(FileNode {
                                    name: child_name,
                                    path: entry_path,
                                    size,
                                    is_directory: is_dir,
                                    children: vec![],
                                    file_type,
                                    modified,
                                });
                            }
                        }
                    }
                }

                // Update shared counters
                *files_arc.lock().unwrap() += local_files;
                *size_arc.lock().unwrap() += local_size;
            }
        });

        *files_scanned = *files_arc.lock().unwrap();
        *total_size = *size_arc.lock().unwrap();
        return;
    }

    // Recurse to children sequentially for deeper levels
    for child in &mut node.children {
        scan_level_parallel(
            child,
            target_level,
            current_level + 1,
            files_scanned,
            total_size,
            window,
            last_emit,
        );
    }
}

/// Update directory sizes bottom-up
fn update_sizes(node: &mut FileNode) -> u64 {
    if !node.is_directory {
        return node.size;
    }

    let mut total = 0u64;
    for child in &mut node.children {
        total += update_sizes(child);
    }

    node.size = total;
    total
}

/// Emit partial result
fn emit_partial(window: &Window, tree: &FileNode, files_scanned: u64, total_size: u64) {
    let partial = PartialScanResult {
        tree: tree.clone(),
        files_scanned,
        total_size,
        is_complete: false,
    };

    if let Err(e) = window.emit("partial-scan-result", &partial) {
        eprintln!("Failed to emit partial result: {}", e);
    }
}
