use crate::classifier::classify_file;
use crate::types::{FileNode, FileType, NodeStats, StreamingScanEvent};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tauri::{Emitter, Window};
use tokio::fs;
use tokio::sync::{mpsc, Semaphore};
use tokio::time::sleep;

const MAX_CONCURRENT_DIRS: usize = 100; // Limit concurrent directory scans
const BATCH_SIZE: usize = 50; // Emit after this many events
const BATCH_INTERVAL_MS: u64 = 100; // Or after this many milliseconds

pub async fn scan_directory_async(path: String, window: Window) -> Result<FileNode, String> {
    let root_path = PathBuf::from(&path);

    // Validate path
    if !root_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    eprintln!("=== Starting streaming scan: {} ===", root_path.display());

    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_DIRS));
    let start_time = Instant::now();

    // Create channel for streaming events with larger buffer
    // Use unbounded to prevent blocking during heavy scans
    let (tx, mut rx) = mpsc::unbounded_channel::<StreamingScanEvent>();

    // Spawn batching event emitter task
    let window_clone = window.clone();
    let event_task = tokio::spawn(async move {
        let mut batch = Vec::new();
        let mut last_emit = Instant::now();
        let mut total_events = 0;

        loop {
            tokio::select! {
                // Receive events from scanner
                event = rx.recv() => {
                    match event {
                        Some(evt) => {
                            total_events += 1;
                            batch.push(evt);

                            // Emit batch if size threshold reached or time elapsed
                            let should_emit = batch.len() >= BATCH_SIZE ||
                                last_emit.elapsed().as_millis() >= BATCH_INTERVAL_MS as u128;

                            if should_emit {
                                eprintln!("Emitting batch of {} events (total: {})", batch.len(), total_events);
                                for event in batch.drain(..) {
                                    if let Err(e) = window_clone.emit("streaming-scan-event", &event) {
                                        eprintln!("Failed to emit event: {}", e);
                                    }
                                }
                                last_emit = Instant::now();
                            }
                        }
                        None => {
                            // Channel closed, emit remaining batch and exit
                            eprintln!("Channel closed, emitting final batch of {} events", batch.len());
                            for event in batch.drain(..) {
                                if let Err(e) = window_clone.emit("streaming-scan-event", &event) {
                                    eprintln!("Failed to emit event: {}", e);
                                }
                            }
                            break;
                        }
                    }
                }
                // Periodic flush even if batch not full
                _ = sleep(Duration::from_millis(BATCH_INTERVAL_MS)) => {
                    if !batch.is_empty() {
                        eprintln!("Periodic flush: {} events", batch.len());
                        for event in batch.drain(..) {
                            if let Err(e) = window_clone.emit("streaming-scan-event", &event) {
                                eprintln!("Failed to emit event: {}", e);
                            }
                        }
                        last_emit = Instant::now();
                    }
                }
            }
        }

        eprintln!(
            "Event emitter task finished (total events: {})",
            total_events
        );
    });

    // Scan the directory tree
    let result = scan_dir_recursive(
        root_path.clone(),
        semaphore,
        tx.clone(),
        None, // No parent path for root
    )
    .await?;

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

    eprintln!(
        "=== Scan complete: {} files, {} bytes in {:.1}s ===",
        total_files,
        total_size,
        start_time.elapsed().as_secs_f32()
    );

    Ok(result)
}

fn scan_dir_recursive(
    path: PathBuf,
    semaphore: Arc<Semaphore>,
    event_tx: mpsc::UnboundedSender<StreamingScanEvent>,
    parent_path: Option<String>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<FileNode, String>> + Send>> {
    Box::pin(async move { scan_dir_recursive_impl(path, semaphore, event_tx, parent_path).await })
}

async fn scan_dir_recursive_impl(
    path: PathBuf,
    semaphore: Arc<Semaphore>,
    event_tx: mpsc::UnboundedSender<StreamingScanEvent>,
    parent_path: Option<String>,
) -> Result<FileNode, String> {
    // Get metadata
    let metadata = fs::symlink_metadata(&path)
        .await
        .map_err(|e| format!("Cannot access {}: {}", path.display(), e))?;

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    let path_str = path.to_string_lossy().to_string();

    // Handle files
    if metadata.is_file() {
        let size = metadata.len();
        let file_type = classify_file(&path);

        let node = FileNode {
            name,
            path: path.clone(),
            size,
            is_directory: false,
            children: vec![],
            file_type,
            modified,
        };

        // Emit file discovery immediately
        let stats = NodeStats::from_file(size);
        if let Err(e) = event_tx.send(StreamingScanEvent::NodeDiscovered {
            node: node.clone(),
            stats,
            parent_path,
        }) {
            eprintln!("Failed to send file event: {}", e);
        }

        return Ok(node);
    }

    // Handle symlinks (skip them)
    if metadata.is_symlink() {
        let node = FileNode {
            name,
            path,
            size: 0,
            is_directory: false,
            children: vec![],
            file_type: FileType::Other,
            modified,
        };
        return Ok(node);
    }

    // Handle directories
    if !metadata.is_dir() {
        return Err("Not a file or directory".to_string());
    }

    // Read directory entries
    let mut read_dir = fs::read_dir(&path)
        .await
        .map_err(|e| format!("Cannot read directory {}: {}", path.display(), e))?;

    let mut children = Vec::new();
    let mut child_handles = Vec::new();
    let mut stats = NodeStats::new();

    // Process entries
    while let Ok(Some(entry)) = read_dir.next_entry().await {
        let entry_path = entry.path();

        match entry.metadata().await {
            Ok(meta) => {
                if meta.is_file() {
                    // Handle file immediately
                    let size = meta.len();
                    let file_type = classify_file(&entry_path);
                    let child_name = entry.file_name().to_string_lossy().to_string();
                    let child_modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);

                    let file_node = FileNode {
                        name: child_name,
                        path: entry_path.clone(),
                        size,
                        is_directory: false,
                        children: vec![],
                        file_type,
                        modified: child_modified,
                    };

                    // Emit file immediately
                    let file_stats = NodeStats::from_file(size);
                    let _ = event_tx.send(StreamingScanEvent::NodeDiscovered {
                        node: file_node.clone(),
                        stats: file_stats,
                        parent_path: Some(path_str.clone()),
                    });

                    // Aggregate into parent stats
                    stats.merge(&file_stats);
                    children.push(file_node);
                } else if meta.is_dir() && !meta.is_symlink() {
                    // Spawn async task for subdirectory
                    let sem = semaphore.clone();
                    let entry_path_clone = entry_path.clone();
                    let tx = event_tx.clone();
                    let parent = Some(path_str.clone());

                    let handle = tokio::task::spawn(async move {
                        let _permit = sem.acquire().await.expect("semaphore closed");
                        scan_dir_recursive(entry_path_clone, sem.clone(), tx, parent).await
                    });

                    child_handles.push(handle);
                }
            }
            Err(e) => {
                eprintln!("Cannot access {}: {}", entry_path.display(), e);
            }
        }
    }

    // Collect results from child tasks with progressive aggregation
    let mut completed = 0;
    let total_subdirs = child_handles.len();

    for handle in child_handles {
        match handle.await {
            Ok(Ok(child_node)) => {
                // Calculate child stats
                let child_stats = NodeStats {
                    file_count: count_files(&child_node),
                    total_size: child_node.size,
                };

                // Aggregate into parent
                stats.merge(&child_stats);
                children.push(child_node.clone());
                completed += 1;

                // Emit directory update as children complete
                // More frequent updates for better real-time feel
                if completed % 3 == 0 || completed == total_subdirs {
                    let partial_dir = FileNode {
                        name: name.clone(),
                        path: path.clone(),
                        size: stats.total_size,
                        is_directory: true,
                        children: children.clone(),
                        file_type: FileType::Other,
                        modified,
                    };

                    let _ = event_tx.send(StreamingScanEvent::NodeDiscovered {
                        node: partial_dir,
                        stats,
                        parent_path: parent_path.clone(),
                    });
                }

                // Emit progress update
                let _ = event_tx.send(StreamingScanEvent::Progress {
                    files_scanned: stats.file_count,
                    total_size: stats.total_size,
                    current_path: path_str.clone(),
                });
            }
            Ok(Err(e)) => {
                eprintln!("Error scanning subdirectory: {}", e);
            }
            Err(e) => {
                eprintln!("Task join error: {}", e);
            }
        }
    }

    // Final directory node
    let final_node = FileNode {
        name,
        path,
        size: stats.total_size,
        is_directory: true,
        children,
        file_type: FileType::Other,
        modified,
    };

    // Emit final directory state
    let _ = event_tx.send(StreamingScanEvent::NodeDiscovered {
        node: final_node.clone(),
        stats,
        parent_path,
    });

    Ok(final_node)
}

fn count_files(node: &FileNode) -> u64 {
    if !node.is_directory {
        return 1;
    }

    node.children.iter().map(|c| count_files(c)).sum()
}
