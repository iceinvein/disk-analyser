mod classifier;
mod safety;
mod scanner;
mod scanner_async;
mod scanner_bfs;
mod storage;
mod types;

pub use classifier::{classify_file, get_category_stats, CategoryStats};
pub use safety::{
    check_deletion_safety, check_multiple_deletions, delete_items, DeletionResult, SafetyCheck,
};
pub use scanner::{scan_directory, validate_path};
pub use scanner_async::scan_directory_async;
pub use storage::{get_quick_access_folders, get_storage_locations, LocationType, StorageLocation};
pub use types::{
    FileNode, FileType, NodeStats, PartialScanResult, ScanProgress, StreamingScanEvent,
};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Tauri command to validate a path
#[tauri::command]
fn validate_path_command(path: String) -> Result<bool, String> {
    scanner::validate_path(&path)
}

/// Tauri command to scan a directory (parallel with progressive updates)
#[tauri::command]
async fn scan_directory_command(path: String, window: tauri::Window) -> Result<FileNode, String> {
    // Use parallel scanner - it's fast and works well
    scanner::scan_directory(path, window).await
}

/// Tauri command to scan a directory with streaming updates (new async scanner)
#[tauri::command]
async fn scan_directory_streaming_command(
    path: String,
    window: tauri::Window,
) -> Result<FileNode, String> {
    // Use new streaming scanner with progressive aggregation
    scanner_async::scan_directory_async(path, window).await
}

/// Tauri command to check if the app has necessary permissions for a path
#[tauri::command]
fn check_path_permissions(path: String) -> Result<bool, String> {
    scanner::check_path_permissions(&path)
}

/// Tauri command to open System Settings to Full Disk Access (macOS only)
#[tauri::command]
fn open_full_disk_access_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // Open System Settings to Privacy & Security > Full Disk Access
        let result = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
            .spawn();

        match result {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Failed to open System Settings: {}", e)),
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("This feature is only available on macOS".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            validate_path_command,
            scan_directory_command,
            scan_directory_streaming_command,
            check_path_permissions,
            open_full_disk_access_settings,
            safety::check_deletion_safety_command,
            safety::delete_items_command,
            storage::get_storage_locations_command,
            storage::get_quick_access_folders_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
