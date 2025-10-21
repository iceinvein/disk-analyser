# Disk Analyser

A high-performance disk space analyzer built with Tauri, React, and Rust. Quickly scan your storage devices, visualize disk usage, and safely delete unwanted files to reclaim space.

![Disk Analyser](https://img.shields.io/badge/Tauri-2.0-blue) ![React](https://img.shields.io/badge/React-19.1-61dafb) ![Rust](https://img.shields.io/badge/Rust-Latest-orange)

## Features

### 🚀 High-Performance Scanning

- **Concurrent async scanning** with configurable parallelism (up to 100 concurrent directory scans)
- **Optimized tree building** - lazy size calculation only for displayed nodes, not entire filesystem
- **Accurate disk usage** - uses actual disk blocks to handle APFS compression, sparse files, and hard links
- **Smart inode tracking** - prevents double-counting hard links on Unix systems
- **Symlink handling** - skips symbolic links to avoid circular references and double-counting
- **Streaming progress updates** - see real-time statistics (file count, size, current path) during scan
- **Cancellable scans** - stop long-running scans at any time
- **Instant results** - tree is built and displayed immediately after scan completes

### 📊 Dual Visualization Modes

- **Miller Columns View** - Navigate your file system hierarchically with a familiar multi-column interface
- **Largest Files View** - Virtualized table showing all files sorted by size with instant filtering

### 🎯 Smart File Management

- **Multi-select** - Select multiple files and folders for batch operations
- **Safety checks** - Pre-deletion validation warns about system files, applications, and protected locations
- **Detailed deletion preview** - See exactly what will be deleted and how much space will be freed
- **Confirmation for risky operations** - Type-to-confirm for deletions over 1GB or system-critical files

### 🎨 Modern UI

- **Glassmorphism design** - Beautiful frosted glass effects throughout
- **Dark theme** - Easy on the eyes with purple accent colors
- **Enhanced scanning overlay** - Terminal-style scrolling log showing last 5 scanned paths
- **Typewriter animation** - Witty messages with realistic typing effect and randomized timing
- **Real-time statistics** - Live file count, total size, and elapsed time during scans
- **Responsive layout** - Adapts to different window sizes
- **Virtualized rendering** - Smooth performance even with millions of files
- **Accessibility** - Full keyboard navigation and screen reader support

### 💾 Storage Integration

- **Auto-detect storage devices** - Automatically discovers mounted volumes and drives
- **Quick access folders** - One-click access to common locations (Desktop, Documents, Downloads, etc.)
- **Custom folder selection** - Scan any folder on your system

## Technology Stack

### Frontend

- **React 19** - UI framework with latest features
- **TypeScript** - Type-safe development
- **Nanostores** - Lightweight state management (< 1KB)
- **TanStack Virtual** - Efficient virtualization for large lists
- **HeroUI** - Modern component library
- **Tailwind CSS 4** - Utility-first styling
- **Framer Motion** - Smooth animations
- **Lucide React** - Beautiful icons

### Backend

- **Rust** - High-performance systems language
- **Tauri 2.0** - Secure desktop application framework
- **Tokio** - Async runtime for concurrent operations
- **Serde** - Serialization/deserialization

## Scanning Algorithm

The disk scanner uses an **optimized concurrent architecture** designed for maximum performance and accuracy:

### Architecture Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React)                         │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Scanning Overlay                                      │ │
│  │  - Shows real-time progress (files, size, time)       │ │
│  │  - Terminal-style scrolling log of recent paths       │ │
│  │  - Typewriter animation with witty messages           │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Tree Display (Post-Scan)                             │ │
│  │  - Receives complete tree after scan finishes         │ │
│  │  - Instant display with depth-2 tree (root + 2 levels)│ │
│  │  - Lazy loading for deeper navigation                 │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ Progress Events (500ms intervals)
                            │ Complete Event (with tree)
┌─────────────────────────────────────────────────────────────┐
│                     Backend (Rust)                           │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Progress Emitter Task                                 │ │
│  │  - Emits stats every 500ms                            │ │
│  │  - Files scanned, total size, current path            │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Concurrent Scanner                                    │ │
│  │  - Recursive async directory traversal                │ │
│  │  - Semaphore-controlled parallelism (max 100)         │ │
│  │  - Inode tracking to avoid hard link duplication      │ │
│  │  - Symlink skipping to prevent cycles                 │ │
│  │  - Actual disk block calculation (not logical size)   │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Lazy Tree Builder                                     │ │
│  │  - Builds depth-2 tree from registry after scan       │ │
│  │  - Only calculates sizes for displayed nodes          │ │
│  │  - Memoization prevents redundant calculations        │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Key Algorithm Components

#### 1. **Concurrent Scanning** (`scan_root_with_updates`)

- **Recursive async traversal** - Each directory spawns child tasks for subdirectories
- **Semaphore-based concurrency control** - Limits concurrent operations to prevent resource exhaustion (max 100)
- **Inode tracking** - On Unix systems, tracks inodes to detect and skip hard links (prevents double-counting)
- **Symlink skipping** - Uses `symlink_metadata` to detect and skip symbolic links (prevents cycles)
- **Accurate size calculation** - Uses `metadata.blocks() * 512` to get actual disk usage (handles APFS compression and sparse files)

```rust
// Simplified algorithm flow:
async fn scan_root_with_updates(path, semaphore, progress, window, cancel_token) {
    // 1. Acquire semaphore permit (max 100 concurrent)
    let permit = semaphore.acquire().await;

    // 2. Read metadata (symlink_metadata to not follow symlinks)
    let metadata = fs::symlink_metadata(&path).await;

    // 3. Skip symlinks
    if metadata.is_symlink() {
        return;
    }

    // 4. Track inodes to avoid hard link duplication
    #[cfg(unix)]
    {
        let inode = metadata.ino();
        if !progress.seen_inodes.insert(inode) {
            return; // Already counted this hard link
        }
    }

    // 5. Calculate actual disk usage
    let size = metadata.blocks() * 512; // Actual disk blocks

    // 6. Update progress stats
    progress.files_scanned += 1;
    progress.total_size += size;
    progress.current_path = path.to_string();

    // 7. If directory, spawn tasks for children
    if metadata.is_dir() {
        for entry in fs::read_dir(&path).await {
            tokio::spawn(scan_root_with_updates(entry.path(), ...));
        }
    }

    // 8. Release permit
    drop(permit);
}
```

#### 2. **Progress Updates** (`progress_task`)

- **Periodic emission** - Emits progress stats every 500ms
- **Non-blocking** - Runs in separate task to not slow down scanning
- **Real-time feedback** - Shows files scanned, total size, and current path

```rust
loop {
    interval.tick().await; // 500ms

    let (files_scanned, total_size, current_path) = {
        let stats = progress.lock().await;
        (stats.files_scanned, stats.total_size, stats.current_path.clone())
    };

    window.emit("streaming-scan-event", StreamingScanEvent::Progress {
        files_scanned,
        total_size,
        current_path,
    });
}
```

#### 3. **Lazy Tree Building** (Post-Scan)

- **Depth-limited** - Only builds tree to depth 2 (root + 2 levels) for initial display
- **Lazy size calculation** - Only calculates directory sizes for nodes actually included in the tree
- **Memoization** - Caches calculated sizes to avoid redundant work
- **Fast completion** - Tree building completes in seconds instead of minutes for large scans

```rust
fn build_tree_recursive_lazy(
    registry: &HashMap<PathBuf, DiscoveredNode>,
    parent_to_children: &HashMap<PathBuf, Vec<PathBuf>>,
    size_cache: &mut HashMap<PathBuf, u64>,
    path: &PathBuf,
    current_depth: usize,
    max_depth: usize,
) -> Option<FileNode> {
    // Only calculate size if we need this node
    if current_depth >= max_depth {
        return None;
    }

    // Use cached size if available
    let size = if let Some(&cached) = size_cache.get(path) {
        cached
    } else {
        calculate_dir_size_lazy(registry, parent_to_children, size_cache, path)
    };

    // Build node with children (if within depth limit)
    // ...
}
```

### Performance Characteristics

| Metric                       | Value                         |
| ---------------------------- | ----------------------------- |
| **Max Concurrent Dirs**      | 100                           |
| **Progress Update Interval** | 500ms                         |
| **Typical Scan Speed**       | 10,000-50,000 files/sec (SSD) |
| **Tree Build Time**          | 1-5 seconds (7M files)        |
| **Memory Overhead**          | ~200 bytes per file           |

### Why This Design?

1. **Accuracy** - Actual disk usage with hard link detection and APFS compression support
2. **Performance** - Lazy tree building only processes displayed nodes (not all 7M+ files)
3. **Responsiveness** - Real-time progress updates during scan, instant tree display after
4. **Scalability** - Can handle millions of files without UI freezing
5. **Efficiency** - Concurrent I/O maximizes disk throughput
6. **Cancellability** - Scans can be stopped instantly via cancellation tokens
7. **Resource control** - Semaphore prevents overwhelming the system

### UI Enhancements

The scanning overlay provides an engaging experience during long scans:

- **Terminal-style log** - Shows last 5 scanned paths with macOS-style window chrome
- **Typewriter animation** - Witty messages with realistic typing effect:
  - Random typing speed (40-80ms per character)
  - Random pause duration (1.5-2.5 seconds)
  - Faster backspacing (20-60ms per character)
  - Variable gaps between messages (400-1200ms)
- **Real-time statistics** - Animated counters for files scanned and total size
- **Elapsed time** - Shows scan duration in MM:SS format
- **Smooth animations** - Framer Motion for polished transitions

## Installation

### Prerequisites

- **Bun** 1.0+ (install via [bun.sh](https://bun.sh/))
- **Rust** 1.70+ (install via [rustup](https://rustup.rs/))
- **Tauri CLI** (installed automatically via bun)

### Development Setup

```bash
# Clone the repository
git clone <repository-url>
cd disk-analyser

# Install dependencies
bun install

# Run in development mode
bun run tauri dev
```

### Building for Production

```bash
# Build the application
bun run tauri build

# The built application will be in src-tauri/target/release/
```

## Usage

1. **Launch the app** - The sidebar shows available storage devices and quick access folders
2. **Select a location** - Click on a storage device or folder to start scanning
3. **View results** - Switch between Miller Columns and Largest Files views
4. **Select files** - Check boxes to select files/folders for deletion
5. **Delete safely** - Click Delete, review the safety report, and confirm

### Keyboard Shortcuts

- `Delete` - Open deletion dialog for selected items
- `Escape` - Clear selection or close dialog
- `Ctrl/Cmd + R` - Refresh current scan
- `Ctrl/Cmd + D` - Deselect all items

## Project Structure

```text
disk-analyser/
├── src/                      # React frontend
│   ├── components/           # UI components
│   │   ├── MillerColumns.tsx       # Hierarchical navigation view
│   │   ├── LargestFilesView.tsx    # Virtualized file table
│   │   ├── ScanningOverlay.tsx     # Enhanced scanning UI
│   │   ├── DeletionDialog.tsx      # Safe deletion interface
│   │   └── ...
│   ├── services/             # Frontend services
│   │   └── scanService.ts          # Scan orchestration
│   ├── stores.ts             # Nanostores state management
│   ├── types.ts              # TypeScript type definitions
│   └── App.tsx               # Main application component
├── src-tauri/                # Rust backend
│   ├── src/
│   │   ├── scanner.rs              # Core scanning algorithm
│   │   ├── safety.rs               # Deletion safety checks
│   │   ├── storage.rs              # Storage device detection
│   │   └── lib.rs                  # Tauri commands
│   └── Cargo.toml            # Rust dependencies
└── package.json              # Node dependencies
```

## Safety Features

The app includes multiple layers of protection:

- ✅ **System file detection** - Warns about OS files, applications, libraries
- ✅ **Protected path checking** - Blocks deletion of critical system directories
- ✅ **Size-based confirmation** - Requires typing confirmation for large deletions (>1GB)
- ✅ **Detailed preview** - Shows exactly what will be deleted before proceeding
- ✅ **Graceful error handling** - Reports which files couldn't be deleted and why

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
