use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::SystemTime;

/// Enum representing different file categories based on file extensions
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum FileType {
    Document,
    Image,
    Video,
    Audio,
    Archive,
    Executable,
    SystemFile,
    Code,
    Other,
}

/// Represents a file or directory node in the file system tree
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    /// Name of the file or directory
    pub name: String,
    /// Full path to the file or directory
    pub path: PathBuf,
    /// Size in bytes (for directories: aggregate size of all contents)
    pub size: u64,
    /// Whether this node represents a directory
    pub is_directory: bool,
    /// Child nodes (empty for files)
    pub children: Vec<FileNode>,
    /// Classification of the file type
    pub file_type: FileType,
    /// Last modified timestamp
    pub modified: SystemTime,
}

/// Tracks the progress of a directory scan operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgress {
    /// Current path being scanned
    pub current_path: String,
    /// Total number of files scanned so far
    pub files_scanned: u64,
    /// Total size accumulated so far in bytes
    pub total_size: u64,
}

/// Partial scan result emitted during progressive scanning
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartialScanResult {
    /// The current state of the file tree
    pub tree: FileNode,
    /// Number of files scanned so far
    pub files_scanned: u64,
    /// Total size accumulated so far
    pub total_size: u64,
    /// Whether the scan is complete
    pub is_complete: bool,
}

/// Statistics for a scanned node
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct NodeStats {
    /// Number of files in this node (1 for files, sum of children for directories)
    pub file_count: u64,
    /// Total size in bytes
    pub total_size: u64,
}

impl NodeStats {
    pub fn new() -> Self {
        Self {
            file_count: 0,
            total_size: 0,
        }
    }

    pub fn from_file(size: u64) -> Self {
        Self {
            file_count: 1,
            total_size: size,
        }
    }

    pub fn merge(&mut self, other: &NodeStats) {
        self.file_count += other.file_count;
        self.total_size += other.total_size;
    }
}

/// Streaming scan event emitted during progressive scanning
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum StreamingScanEvent {
    /// Progress update with aggregated stats (lightweight, sent frequently)
    #[serde(rename = "progress")]
    Progress {
        files_scanned: u64,
        total_size: u64,
        current_path: String,
    },
    /// Partial tree snapshot (heavier, sent periodically for UI updates)
    #[serde(rename = "partial_tree")]
    PartialTree {
        tree: FileNode,
        files_scanned: u64,
        total_size: u64,
    },
    /// Node discovered - incremental update (lightweight, sent as nodes are found)
    #[serde(rename = "node_update")]
    NodeUpdate {
        path: String,
        parent_path: Option<String>,
        name: String,
        size: u64,
        is_directory: bool,
        file_type: FileType,
    },
    /// Scan completed
    #[serde(rename = "complete")]
    Complete { files_scanned: u64, total_size: u64 },
}
