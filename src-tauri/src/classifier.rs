use crate::types::{FileNode, FileType};
use std::collections::HashMap;
use std::path::Path;

/// Statistics for a specific file category
#[derive(Debug, Clone)]
pub struct CategoryStats {
    pub category: FileType,
    pub total_size: u64,
    pub file_count: u64,
}

/// Classifies a file based on its extension
///
/// # Arguments
/// * `path` - Path to the file to classify
///
/// # Returns
/// The FileType category for the file
pub fn classify_file(path: &Path) -> FileType {
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|s| s.to_lowercase());

    // Special handling for macOS Photos Library - check parent path
    let path_str = path.to_string_lossy().to_lowercase();
    let is_photos_library = path_str.contains(".photoslibrary") || path_str.contains("photo booth");

    match extension.as_deref() {
        // Documents
        Some("pdf") | Some("doc") | Some("docx") | Some("txt") | Some("rtf") | Some("odt") => {
            FileType::Document
        }
        // Images (including Apple Photos Library internal formats)
        Some("jpg") | Some("jpeg") | Some("png") | Some("gif") | Some("bmp") | Some("svg")
        | Some("webp") | Some("ico") | Some("heic") | Some("heif") | Some("raw") | Some("cr2")
        | Some("nef") | Some("dng") | Some("tiff") | Some("tif") => FileType::Image,
        // Apple Photos Library database files - treat as images since they store photo data
        Some("photos") | Some("photoslibrary") if is_photos_library => FileType::Image,
        Some("db") | Some("sqlite") | Some("sqlite-shm") | Some("sqlite-wal")
            if is_photos_library =>
        {
            FileType::Image
        }
        // Videos (including Apple formats)
        Some("mp4") | Some("avi") | Some("mov") | Some("mkv") | Some("flv") | Some("wmv")
        | Some("webm") | Some("m4v") => FileType::Video,
        // Audio
        Some("mp3") | Some("wav") | Some("flac") | Some("aac") | Some("ogg") | Some("m4a")
        | Some("wma") => FileType::Audio,
        // Archives
        Some("zip") | Some("tar") | Some("gz") | Some("rar") | Some("7z") | Some("bz2")
        | Some("xz") => FileType::Archive,
        // Executables
        Some("exe") | Some("app") | Some("bin") | Some("dll") | Some("so") | Some("dylib") => {
            FileType::Executable
        }
        // Code
        Some("rs") | Some("ts") | Some("tsx") | Some("js") | Some("jsx") | Some("py")
        | Some("java") | Some("c") | Some("cpp") | Some("h") | Some("hpp") | Some("go")
        | Some("rb") | Some("php") | Some("swift") | Some("kt") | Some("cs") => FileType::Code,
        // System files (common system file extensions)
        Some("sys") | Some("ini") | Some("cfg") | Some("conf") | Some("log") => {
            FileType::SystemFile
        }
        // Apple plist files in Photos Library
        Some("plist") if is_photos_library => FileType::Image,
        // Default to Other
        _ => FileType::Other,
    }
}

/// Aggregates file statistics by category from a file tree
///
/// # Arguments
/// * `root` - Root FileNode to analyze
///
/// # Returns
/// Vector of CategoryStats with aggregated size and count for each category
pub fn get_category_stats(root: &FileNode) -> Vec<CategoryStats> {
    let mut stats_map: HashMap<FileType, (u64, u64)> = HashMap::new();

    // Recursively traverse the tree and collect stats
    collect_stats(root, &mut stats_map);

    // Convert HashMap to Vec<CategoryStats>
    stats_map
        .into_iter()
        .map(|(category, (total_size, file_count))| CategoryStats {
            category,
            total_size,
            file_count,
        })
        .collect()
}

/// Helper function to recursively collect statistics
fn collect_stats(node: &FileNode, stats_map: &mut HashMap<FileType, (u64, u64)>) {
    if !node.is_directory {
        // For files, add to the stats
        let entry = stats_map.entry(node.file_type.clone()).or_insert((0, 0));
        entry.0 += node.size; // Add size
        entry.1 += 1; // Increment count
    }

    // Recursively process children
    for child in &node.children {
        collect_stats(child, stats_map);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::SystemTime;

    #[test]
    fn test_classify_documents() {
        assert_eq!(classify_file(Path::new("test.pdf")), FileType::Document);
        assert_eq!(classify_file(Path::new("test.doc")), FileType::Document);
        assert_eq!(classify_file(Path::new("test.txt")), FileType::Document);
    }

    #[test]
    fn test_classify_images() {
        assert_eq!(classify_file(Path::new("test.jpg")), FileType::Image);
        assert_eq!(classify_file(Path::new("test.png")), FileType::Image);
        assert_eq!(classify_file(Path::new("test.gif")), FileType::Image);
    }

    #[test]
    fn test_classify_videos() {
        assert_eq!(classify_file(Path::new("test.mp4")), FileType::Video);
        assert_eq!(classify_file(Path::new("test.avi")), FileType::Video);
        assert_eq!(classify_file(Path::new("test.mov")), FileType::Video);
    }

    #[test]
    fn test_classify_audio() {
        assert_eq!(classify_file(Path::new("test.mp3")), FileType::Audio);
        assert_eq!(classify_file(Path::new("test.wav")), FileType::Audio);
    }

    #[test]
    fn test_classify_archives() {
        assert_eq!(classify_file(Path::new("test.zip")), FileType::Archive);
        assert_eq!(classify_file(Path::new("test.tar")), FileType::Archive);
        assert_eq!(classify_file(Path::new("test.gz")), FileType::Archive);
    }

    #[test]
    fn test_classify_executables() {
        assert_eq!(classify_file(Path::new("test.exe")), FileType::Executable);
        assert_eq!(classify_file(Path::new("test.app")), FileType::Executable);
        assert_eq!(classify_file(Path::new("test.bin")), FileType::Executable);
    }

    #[test]
    fn test_classify_code() {
        assert_eq!(classify_file(Path::new("test.rs")), FileType::Code);
        assert_eq!(classify_file(Path::new("test.ts")), FileType::Code);
        assert_eq!(classify_file(Path::new("test.js")), FileType::Code);
        assert_eq!(classify_file(Path::new("test.py")), FileType::Code);
    }

    #[test]
    fn test_classify_other() {
        assert_eq!(classify_file(Path::new("test.unknown")), FileType::Other);
        assert_eq!(classify_file(Path::new("test")), FileType::Other);
    }

    #[test]
    fn test_case_insensitive() {
        assert_eq!(classify_file(Path::new("test.PDF")), FileType::Document);
        assert_eq!(classify_file(Path::new("test.JPG")), FileType::Image);
        assert_eq!(classify_file(Path::new("test.MP4")), FileType::Video);
    }

    #[test]
    fn test_get_category_stats() {
        let root = FileNode {
            name: "root".to_string(),
            path: PathBuf::from("/root"),
            size: 3000,
            is_directory: true,
            file_type: FileType::Other,
            modified: SystemTime::now(),
            children: vec![
                FileNode {
                    name: "doc1.pdf".to_string(),
                    path: PathBuf::from("/root/doc1.pdf"),
                    size: 1000,
                    is_directory: false,
                    file_type: FileType::Document,
                    modified: SystemTime::now(),
                    children: vec![],
                },
                FileNode {
                    name: "doc2.txt".to_string(),
                    path: PathBuf::from("/root/doc2.txt"),
                    size: 500,
                    is_directory: false,
                    file_type: FileType::Document,
                    modified: SystemTime::now(),
                    children: vec![],
                },
                FileNode {
                    name: "image.jpg".to_string(),
                    path: PathBuf::from("/root/image.jpg"),
                    size: 1500,
                    is_directory: false,
                    file_type: FileType::Image,
                    modified: SystemTime::now(),
                    children: vec![],
                },
            ],
        };

        let stats = get_category_stats(&root);

        // Find Document stats
        let doc_stats = stats
            .iter()
            .find(|s| s.category == FileType::Document)
            .unwrap();
        assert_eq!(doc_stats.total_size, 1500);
        assert_eq!(doc_stats.file_count, 2);

        // Find Image stats
        let img_stats = stats
            .iter()
            .find(|s| s.category == FileType::Image)
            .unwrap();
        assert_eq!(img_stats.total_size, 1500);
        assert_eq!(img_stats.file_count, 1);
    }
}
