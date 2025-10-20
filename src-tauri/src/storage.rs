use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocationType {
    Storage,
    Network,
    Folder,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageLocation {
    pub name: String,
    pub path: PathBuf,
    pub location_type: LocationType,
    pub total_space: Option<u64>,
    pub available_space: Option<u64>,
}

#[cfg(target_os = "macos")]
pub fn get_storage_locations() -> Result<Vec<StorageLocation>, String> {
    use std::fs;

    let mut locations = Vec::new();

    // Add root volume
    if let Ok(stats) = get_volume_stats(&PathBuf::from("/")) {
        locations.push(StorageLocation {
            name: "Macintosh HD".to_string(),
            path: PathBuf::from("/"),
            location_type: LocationType::Storage,
            total_space: Some(stats.0),
            available_space: Some(stats.1),
        });
    }

    // Check /Volumes for mounted drives
    if let Ok(entries) = fs::read_dir("/Volumes") {
        for entry in entries.flatten() {
            if let Ok(path) = entry.path().canonicalize() {
                let name = entry.file_name().to_string_lossy().to_string();

                // Skip the root volume (it appears as "Macintosh HD" in /Volumes)
                if path == PathBuf::from("/") {
                    continue;
                }

                // Skip disk images (mounted .dmg files)
                if is_disk_image(&path) {
                    continue;
                }

                let (total, available) = get_volume_stats(&path).unwrap_or((0, 0));

                // Determine if it's a network drive (basic heuristic)
                let is_network = name.starts_with("smb://") || name.starts_with("afp://");

                locations.push(StorageLocation {
                    name,
                    path,
                    location_type: if is_network {
                        LocationType::Network
                    } else {
                        LocationType::Storage
                    },
                    total_space: if total > 0 { Some(total) } else { None },
                    available_space: if available > 0 { Some(available) } else { None },
                });
            }
        }
    }

    Ok(locations)
}

#[cfg(target_os = "macos")]
fn is_disk_image(path: &std::path::Path) -> bool {
    use std::process::Command;

    // Use diskutil to check if this is a disk image
    // Disk images typically have "Disk Image" in their protocol
    if let Ok(output) = Command::new("diskutil").arg("info").arg(path).output() {
        if let Ok(info) = String::from_utf8(output.stdout) {
            // Check for disk image indicators
            return info.contains("Disk Image")
                || info.contains("Apple_HFS") && info.contains("disk image")
                || info.contains("Protocol:") && info.contains("Disk Image");
        }
    }

    false
}

#[cfg(target_os = "windows")]
pub fn get_storage_locations() -> Result<Vec<StorageLocation>, String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use winapi::um::fileapi::GetLogicalDriveStringsW;
    use winapi::um::fileapi::{GetDiskFreeSpaceExW, GetVolumeInformationW};
    use winapi::um::winbase::{GetDriveTypeW, DRIVE_FIXED, DRIVE_REMOTE, DRIVE_REMOVABLE};

    let mut locations = Vec::new();

    unsafe {
        let mut buffer = vec![0u16; 256];
        let length = GetLogicalDriveStringsW(buffer.len() as u32, buffer.as_mut_ptr());

        if length == 0 {
            return Err("Failed to get logical drives".to_string());
        }

        let mut i = 0;
        while i < length as usize && buffer[i] != 0 {
            let mut end = i;
            while end < buffer.len() && buffer[end] != 0 {
                end += 1;
            }

            let drive_path = OsString::from_wide(&buffer[i..end]);
            let drive_str = drive_path.to_string_lossy().to_string();

            let drive_type = GetDriveTypeW(
                drive_path
                    .as_os_str()
                    .encode_wide()
                    .chain(Some(0))
                    .collect::<Vec<_>>()
                    .as_ptr(),
            );

            let location_type = match drive_type {
                DRIVE_REMOTE => LocationType::Network,
                DRIVE_FIXED | DRIVE_REMOVABLE => LocationType::Storage,
                _ => LocationType::Storage,
            };

            let (total, available) = get_windows_volume_stats(&drive_str).unwrap_or((None, None));

            let name = get_windows_volume_name(&drive_str)
                .unwrap_or_else(|| drive_str.trim_end_matches('\\').to_string());

            locations.push(StorageLocation {
                name,
                path: PathBuf::from(drive_str),
                location_type,
                total_space: total,
                available_space: available,
            });

            i = end + 1;
        }
    }

    Ok(locations)
}

#[cfg(target_os = "linux")]
pub fn get_storage_locations() -> Result<Vec<StorageLocation>, String> {
    use std::fs::File;
    use std::io::{BufRead, BufReader};

    let mut locations = Vec::new();

    // Parse /proc/mounts
    let file = File::open("/proc/mounts").map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);

    for line in reader.lines().flatten() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }

        let device = parts[0];
        let mount_point = parts[1];
        let fs_type = parts[2];

        // Filter for relevant mount points
        let is_physical = device.starts_with("/dev/sd")
            || device.starts_with("/dev/nvme")
            || device.starts_with("/dev/hd");
        let is_network = fs_type == "nfs" || fs_type == "cifs" || fs_type == "smbfs";
        let is_root = mount_point == "/";

        if !is_physical && !is_network && !is_root {
            continue;
        }

        let (total, available) = get_linux_volume_stats(mount_point).unwrap_or((0, 0));

        let name = if is_root {
            "Root".to_string()
        } else {
            PathBuf::from(mount_point)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| mount_point.to_string())
        };

        locations.push(StorageLocation {
            name,
            path: PathBuf::from(mount_point),
            location_type: if is_network {
                LocationType::Network
            } else {
                LocationType::Storage
            },
            total_space: if total > 0 { Some(total) } else { None },
            available_space: if available > 0 { Some(available) } else { None },
        });
    }

    Ok(locations)
}

#[cfg(target_os = "macos")]
fn get_volume_stats(path: &std::path::Path) -> Result<(u64, u64), String> {
    use std::ffi::CString;
    use std::mem;

    let path_cstr = CString::new(path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;

    unsafe {
        let mut stats: libc::statfs = mem::zeroed();
        if libc::statfs(path_cstr.as_ptr(), &mut stats) == 0 {
            let total = stats.f_blocks * stats.f_bsize as u64;
            let available = stats.f_bavail * stats.f_bsize as u64;
            Ok((total, available))
        } else {
            Err("Failed to get volume stats".to_string())
        }
    }
}

#[cfg(target_os = "windows")]
fn get_windows_volume_stats(path: &str) -> Result<(Option<u64>, Option<u64>), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::fileapi::GetDiskFreeSpaceExW;

    unsafe {
        let path_wide: Vec<u16> = OsStr::new(path).encode_wide().chain(Some(0)).collect();

        let mut free_bytes: u64 = 0;
        let mut total_bytes: u64 = 0;
        let mut total_free_bytes: u64 = 0;

        if GetDiskFreeSpaceExW(
            path_wide.as_ptr(),
            &mut free_bytes as *mut u64 as *mut _,
            &mut total_bytes as *mut u64 as *mut _,
            &mut total_free_bytes as *mut u64 as *mut _,
        ) != 0
        {
            Ok((Some(total_bytes), Some(free_bytes)))
        } else {
            Ok((None, None))
        }
    }
}

#[cfg(target_os = "windows")]
fn get_windows_volume_name(path: &str) -> Option<String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::fileapi::GetVolumeInformationW;

    unsafe {
        let path_wide: Vec<u16> = OsStr::new(path).encode_wide().chain(Some(0)).collect();
        let mut name_buffer = vec![0u16; 256];

        if GetVolumeInformationW(
            path_wide.as_ptr(),
            name_buffer.as_mut_ptr(),
            name_buffer.len() as u32,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
        ) != 0
        {
            let len = name_buffer
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(name_buffer.len());
            let name = String::from_utf16_lossy(&name_buffer[..len]);
            if !name.is_empty() {
                return Some(name);
            }
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn get_linux_volume_stats(path: &str) -> Result<(u64, u64), String> {
    use std::ffi::CString;
    use std::mem;

    let path_cstr = CString::new(path).map_err(|e| e.to_string())?;

    unsafe {
        let mut stats: libc::statvfs = mem::zeroed();
        if libc::statvfs(path_cstr.as_ptr(), &mut stats) == 0 {
            let total = stats.f_blocks * stats.f_frsize;
            let available = stats.f_bavail * stats.f_frsize;
            Ok((total, available))
        } else {
            Err("Failed to get volume stats".to_string())
        }
    }
}

pub fn get_quick_access_folders() -> Result<Vec<StorageLocation>, String> {
    let mut folders = Vec::new();

    // Common folders
    let common_folders = vec![
        ("Desktop", dirs::desktop_dir()),
        ("Documents", dirs::document_dir()),
        ("Pictures", dirs::picture_dir()),
        ("Downloads", dirs::download_dir()),
    ];

    for (name, path_opt) in common_folders {
        if let Some(path) = path_opt {
            if path.exists() {
                folders.push(StorageLocation {
                    name: name.to_string(),
                    path,
                    location_type: LocationType::Folder,
                    total_space: None,
                    available_space: None,
                });
            }
        }
    }

    Ok(folders)
}

#[tauri::command]
pub async fn get_storage_locations_command() -> Result<Vec<StorageLocation>, String> {
    get_storage_locations()
}

#[tauri::command]
pub async fn get_quick_access_folders_command() -> Result<Vec<StorageLocation>, String> {
    get_quick_access_folders()
}
