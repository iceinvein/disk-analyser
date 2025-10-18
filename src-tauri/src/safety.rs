use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use sysinfo::{ProcessRefreshKind, RefreshKind, System};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SafetyCheck {
    Safe,
    Protected { message: String },
    InUse { message: String },
    RequiresConfirmation { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeletionResult {
    pub deleted: Vec<String>,
    pub failed: Vec<FailedDeletion>,
    pub space_freed: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailedDeletion {
    pub path: String,
    pub error: String,
}

// Platform-specific protected paths
#[cfg(target_os = "macos")]
const PROTECTED_PATHS: &[&str] = &[
    "/System",
    "/Library",
    "/Applications",
    "/usr",
    "/bin",
    "/sbin",
];

#[cfg(target_os = "windows")]
const PROTECTED_PATHS: &[&str] = &[
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
];

#[cfg(target_os = "linux")]
const PROTECTED_PATHS: &[&str] = &[
    "/bin", "/boot", "/dev", "/etc", "/lib", "/proc", "/sys", "/usr",
];

// Size threshold for requiring confirmation (10 GB in bytes)
const LARGE_DELETION_THRESHOLD: u64 = 10 * 1024 * 1024 * 1024;

/// Check if a path is within a protected system directory
fn is_protected_path(path: &Path) -> bool {
    let path_str = path.to_string_lossy();

    for protected in PROTECTED_PATHS {
        // Check if the path starts with or is within a protected directory
        #[cfg(target_os = "windows")]
        {
            if path_str
                .to_lowercase()
                .starts_with(&protected.to_lowercase())
            {
                return true;
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            if path_str.starts_with(protected) {
                return true;
            }
        }
    }

    false
}

/// Check if a file is currently in use by any running process
fn is_file_in_use(path: &Path) -> bool {
    let mut system = System::new_with_specifics(
        RefreshKind::new().with_processes(ProcessRefreshKind::everything()),
    );
    system.refresh_all();

    let path_str = path.to_string_lossy();

    // Check if any process has this file open
    for (_pid, process) in system.processes() {
        // Check the process executable path
        if let Some(exe_path) = process.exe() {
            if exe_path == path {
                return true;
            }
        }

        // On some platforms, we can check open files
        // This is a basic check - more sophisticated checks would require platform-specific APIs
        if process.name().contains(&*path_str) {
            return true;
        }
    }

    false
}

/// Calculate the total size of a path (file or directory)
fn calculate_path_size(path: &Path) -> std::io::Result<u64> {
    if path.is_file() {
        Ok(path.metadata()?.len())
    } else if path.is_dir() {
        let mut total_size = 0u64;
        for entry in walkdir::WalkDir::new(path)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_file() {
                if let Ok(metadata) = entry.metadata() {
                    total_size += metadata.len();
                }
            }
        }
        Ok(total_size)
    } else {
        Ok(0)
    }
}

/// Check the safety of deleting a single path
pub fn check_deletion_safety(path: &Path) -> SafetyCheck {
    // Check if path exists
    if !path.exists() {
        return SafetyCheck::Protected {
            message: format!("Path does not exist: {}", path.display()),
        };
    }

    // Check if it's a protected system path
    if is_protected_path(path) {
        return SafetyCheck::Protected {
            message: format!("Cannot delete protected system path: {}", path.display()),
        };
    }

    // Check if file is in use
    if is_file_in_use(path) {
        return SafetyCheck::InUse {
            message: format!("File or directory is currently in use: {}", path.display()),
        };
    }

    // Check size threshold
    if let Ok(size) = calculate_path_size(path) {
        if size > LARGE_DELETION_THRESHOLD {
            let size_gb = size as f64 / (1024.0 * 1024.0 * 1024.0);
            return SafetyCheck::RequiresConfirmation {
                message: format!(
                    "Large deletion ({:.2} GB). Please confirm this action.",
                    size_gb
                ),
            };
        }
    }

    SafetyCheck::Safe
}

/// Check the safety of deleting multiple paths
pub fn check_multiple_deletions(paths: &[PathBuf]) -> Vec<SafetyCheck> {
    paths.iter().map(|p| check_deletion_safety(p)).collect()
}

/// Delete items after safety checks have been performed
pub async fn delete_items(paths: Vec<PathBuf>) -> Result<DeletionResult, String> {
    let mut deleted = Vec::new();
    let mut failed = Vec::new();
    let mut space_freed = 0u64;

    for path in paths {
        // Perform safety check before deletion
        match check_deletion_safety(&path) {
            SafetyCheck::Safe | SafetyCheck::RequiresConfirmation { .. } => {
                // Calculate size before deletion
                if let Ok(size) = calculate_path_size(&path) {
                    // Attempt deletion
                    let result = if path.is_dir() {
                        std::fs::remove_dir_all(&path)
                    } else {
                        std::fs::remove_file(&path)
                    };

                    match result {
                        Ok(_) => {
                            space_freed += size;
                            deleted.push(path.to_string_lossy().to_string());
                        }
                        Err(e) => {
                            failed.push(FailedDeletion {
                                path: path.to_string_lossy().to_string(),
                                error: e.to_string(),
                            });
                        }
                    }
                } else {
                    failed.push(FailedDeletion {
                        path: path.to_string_lossy().to_string(),
                        error: "Could not calculate size".to_string(),
                    });
                }
            }
            SafetyCheck::Protected { message } => {
                failed.push(FailedDeletion {
                    path: path.to_string_lossy().to_string(),
                    error: message,
                });
            }
            SafetyCheck::InUse { message } => {
                failed.push(FailedDeletion {
                    path: path.to_string_lossy().to_string(),
                    error: message,
                });
            }
        }
    }

    Ok(DeletionResult {
        deleted,
        failed,
        space_freed,
    })
}

// Tauri commands

#[tauri::command]
pub async fn check_deletion_safety_command(paths: Vec<String>) -> Result<Vec<SafetyCheck>, String> {
    let path_bufs: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    Ok(check_multiple_deletions(&path_bufs))
}

#[tauri::command]
pub async fn delete_items_command(paths: Vec<String>) -> Result<DeletionResult, String> {
    let path_bufs: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    delete_items(path_bufs).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    #[test]
    fn test_protected_paths() {
        #[cfg(target_os = "macos")]
        {
            assert!(is_protected_path(Path::new("/System/Library")));
            assert!(is_protected_path(Path::new("/Applications/Safari.app")));
            assert!(!is_protected_path(Path::new("/Users/test")));
        }

        #[cfg(target_os = "windows")]
        {
            assert!(is_protected_path(Path::new("C:\\Windows\\System32")));
            assert!(is_protected_path(Path::new("C:\\Program Files\\Test")));
            assert!(!is_protected_path(Path::new("C:\\Users\\test")));
        }

        #[cfg(target_os = "linux")]
        {
            assert!(is_protected_path(Path::new("/bin/bash")));
            assert!(is_protected_path(Path::new("/etc/passwd")));
            assert!(!is_protected_path(Path::new("/home/test")));
        }
    }

    #[test]
    fn test_size_calculation() {
        let temp_dir = std::env::temp_dir().join("test_safety");
        fs::create_dir_all(&temp_dir).unwrap();

        let test_file = temp_dir.join("test.txt");
        let mut file = fs::File::create(&test_file).unwrap();
        file.write_all(b"Hello, World!").unwrap();

        let size = calculate_path_size(&test_file).unwrap();
        assert_eq!(size, 13);

        fs::remove_dir_all(&temp_dir).unwrap();
    }

    #[test]
    fn test_safety_check_nonexistent() {
        let result = check_deletion_safety(Path::new("/nonexistent/path"));
        match result {
            SafetyCheck::Protected { .. } => (),
            _ => panic!("Expected Protected for nonexistent path"),
        }
    }
}
