# Disk Analyser

A high-performance disk space analyzer built with Tauri, React, and Rust. Quickly scan your storage devices, visualize disk usage, and safely delete unwanted files to reclaim space.

![Disk Analyser](https://img.shields.io/badge/Tauri-2.0-blue) ![React](https://img.shields.io/badge/React-19.1-61dafb) ![Rust](https://img.shields.io/badge/Rust-Latest-orange)

## Features

### 🚀 High-Performance Scanning

- **Concurrent async scanning** with configurable parallelism (up to 100 concurrent directory scans)
- **Streaming incremental updates** - see results as they're discovered
- **Smart batching** - events are batched (100 items or 50ms intervals) to prevent UI flooding
- **Cancellable scans** - stop long-running scans at any time
- **Scan caching** - previously scanned locations are cached for instant access

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

The disk scanner uses a sophisticated **concurrent streaming architecture** designed for maximum performance and responsiveness:

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React)                         │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Incremental Tree Builder                              │ │
│  │  - Receives node updates via events                    │ │
│  │  - Builds tree structure incrementally                 │ │
│  │  - Updates UI in real-time                             │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ Streaming Events
                            │ (batched: 100 items / 50ms)
┌─────────────────────────────────────────────────────────────┐
│                     Backend (Rust)                           │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Event Batching Task                                   │ │
│  │  - Collects events from scanner                        │ │
│  │  - Batches by size (100) or time (50ms)               │ │
│  │  - Emits to frontend via Tauri events                  │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ▲                                 │
│                            │ Unbounded Channel               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Progressive Scanner (Recursive)                       │ │
│  │  - Concurrent directory traversal                      │ │
│  │  - Semaphore-controlled parallelism (max 100)         │ │
│  │  - Shared registry for discovered nodes                │ │
│  │  - Cancellation token support                          │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Key Algorithm Components

#### 1. **Progressive Scanning** (`scan_progressive_impl`)

- **Recursive async traversal** - Each directory spawns child tasks for subdirectories
- **Semaphore-based concurrency control** - Limits concurrent operations to prevent resource exhaustion
- **Shared registry** - All discovered nodes are stored in a thread-safe `Arc<Mutex<HashMap>>`
- **Incremental updates** - Each file/folder emits an event immediately upon discovery

```rust
// Simplified algorithm flow:
async fn scan_progressive_impl(path, registry, semaphore, event_tx) {
    // 1. Acquire semaphore permit (max 100 concurrent)
    let permit = semaphore.acquire().await;

    // 2. Read metadata
    let metadata = fs::symlink_metadata(&path).await;

    // 3. Add to registry and emit event
    registry.insert(path, node_info);
    event_tx.send(NodeUpdate { path, size, ... });

    // 4. If directory, spawn tasks for children
    if metadata.is_dir() {
        for entry in fs::read_dir(&path).await {
            tokio::spawn(scan_progressive(entry.path(), ...));
        }
    }

    // 5. Release permit before waiting for children
    drop(permit);
}
```

#### 2. **Event Batching** (`event_task`)

- **Prevents UI flooding** - Batches events instead of emitting thousands per second
- **Dual threshold** - Emits when batch reaches 100 items OR 50ms elapsed
- **Tokio select!** - Efficiently handles both event reception and periodic flushing

```rust
loop {
    tokio::select! {
        // Receive events from scanner
        event = rx.recv() => {
            batch.push(event);
            if batch.len() >= 100 || elapsed >= 50ms {
                emit_batch();
            }
        }
        // Periodic flush
        _ = sleep(50ms) => {
            if !batch.is_empty() {
                emit_batch();
            }
        }
    }
}
```

#### 3. **Incremental Tree Building** (Frontend)

- **Path-based insertion** - Nodes are inserted into the tree using their parent path
- **Lazy parent creation** - Parent directories are created on-demand if not yet discovered
- **Size aggregation** - Directory sizes are computed bottom-up as children are added

### Performance Characteristics

| Metric                   | Value                         |
| ------------------------ | ----------------------------- |
| **Max Concurrent Dirs**  | 100                           |
| **Event Batch Size**     | 100 items                     |
| **Event Batch Interval** | 50ms                          |
| **Typical Scan Speed**   | 10,000-50,000 files/sec (SSD) |
| **Memory Overhead**      | ~200 bytes per file           |

### Why This Design?

1. **Responsiveness** - Users see results immediately, not after the entire scan completes
2. **Scalability** - Can handle millions of files without blocking
3. **Efficiency** - Concurrent I/O maximizes disk throughput
4. **Cancellability** - Scans can be stopped instantly via cancellation tokens
5. **Resource control** - Semaphore prevents overwhelming the system

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

```
disk-analyser/
├── src/                      # React frontend
│   ├── components/           # UI components
│   │   ├── MillerColumns.tsx       # Hierarchical navigation view
│   │   ├── LargestFilesView.tsx    # Virtualized file table
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

[Add your license here]

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
