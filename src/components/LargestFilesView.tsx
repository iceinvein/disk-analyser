import { useStore } from '@nanostores/react';
import { useMemo, useRef } from 'react';
import { Chip, Checkbox } from '@heroui/react';
import { $currentView, $selectedItems, toggleSelection } from '../stores';
import type { FileNode } from '../types';
import { useVirtualizer } from '@tanstack/react-virtual';
import { File } from 'lucide-react';

// Format bytes to human-readable size
function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

// Format date - handle both number (ms) and SystemTime object from Rust
function formatDate(timestamp: number | { secs_since_epoch: number; nanos_since_epoch: number }): string {
  let ms: number;

  if (typeof timestamp === 'number') {
    ms = timestamp;
  } else if (timestamp && typeof timestamp === 'object' && 'secs_since_epoch' in timestamp) {
    // Rust SystemTime serialized as {secs_since_epoch, nanos_since_epoch}
    ms = timestamp.secs_since_epoch * 1000;
  } else {
    return 'Unknown';
  }

  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return 'Invalid Date';
  }

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Get file extension
function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : '';
}

// Get parent directory path
function getParentPath(fullPath: string): string {
  const parts = fullPath.split('/');
  parts.pop(); // Remove filename
  return parts.join('/') || '/';
}

// Virtualized table component
function VirtualizedFileTable({ files }: { files: FileNode[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const selectedItems = useStore($selectedItems);

  const rowVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 10,
  });

  const headerHeight = 44; // Height of sticky header

  return (
    <div ref={parentRef} className="flex-1 overflow-auto">
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize() + headerHeight}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {/* Table Header - Sticky */}
        <div className="grid grid-cols-[40px_minmax(300px,2fr)_80px_100px_120px] gap-6 px-6 py-3 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-10 border-b border-white/10">
          <div></div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Name</div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">Type</div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Size</div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Modified</div>
        </div>

        {/* Virtualized Rows */}
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const file = files[virtualRow.index];
          const filePath = file.path.toString();
          const isSelected = selectedItems[filePath] || false;

          return (
            <div
              key={filePath}
              style={{
                position: 'absolute',
                top: `${headerHeight}px`,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="grid grid-cols-[40px_minmax(300px,2fr)_80px_100px_120px] gap-6 px-6 py-3 border-b border-white/5 hover:bg-white/5 transition-colors"
            >
              {/* Checkbox Column */}
              <div className="flex items-center">
                <Checkbox
                  isSelected={isSelected}
                  onValueChange={() => toggleSelection(filePath)}
                  aria-label={`Select ${file.name}`}
                  size="sm"
                />
              </div>

              {/* Name Column */}
              <div className="flex items-center gap-3 min-w-0">
                <File className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white truncate text-sm">
                    {file.name}
                  </div>
                  <div className="text-xs text-gray-500 truncate mt-0.5">
                    {getParentPath(file.path.toString())}
                  </div>
                </div>
              </div>

              {/* Type Column */}
              <div className="flex items-center justify-center">
                {getFileExtension(file.name) && (
                  <Chip
                    size="sm"
                    variant="flat"
                    classNames={{
                      base: 'bg-purple-500/10 border border-purple-500/20 px-2 min-w-[48px] h-6 flex items-center justify-center',
                      content: 'text-purple-300 font-mono text-xs uppercase leading-none',
                    }}
                  >
                    {getFileExtension(file.name)}
                  </Chip>
                )}
              </div>

              {/* Size Column */}
              <div className="flex items-center justify-end">
                <div className="text-sm font-semibold text-purple-300 tabular-nums">
                  {formatSize(file.size)}
                </div>
              </div>

              {/* Modified Column */}
              <div className="flex items-center justify-end">
                <div className="text-xs text-gray-400 tabular-nums">
                  {formatDate(file.modified)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Collect all files recursively (excluding directories)
function collectAllFiles(node: FileNode, files: FileNode[] = []): FileNode[] {
  if (!node.is_directory) {
    files.push(node);
  }
  
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      collectAllFiles(child, files);
    }
  }
  
  return files;
}

export function LargestFilesView() {
  const currentView = useStore($currentView);
  const selectedItems = useStore($selectedItems);

  // Collect and sort all files by size (largest first)
  const sortedFiles = useMemo(() => {
    if (!currentView) return [];

    const allFiles = collectAllFiles(currentView);

    // Sort by size descending
    return allFiles.sort((a, b) => b.size - a.size);
  }, [currentView]);

  // Count selected items
  const selectedCount = Object.values(selectedItems).filter(Boolean).length;

  if (!currentView) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <p>Select a location to start scanning</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 py-4 px-6 glass-strong border-b border-white/10">
        <div>
          <h2 className="text-lg font-semibold text-white">Largest Files</h2>
          <p className="text-sm text-gray-400 mt-1">
            {sortedFiles.length.toLocaleString()} files sorted by size
            {selectedCount > 0 && ` • ${selectedCount} selected`}
          </p>
        </div>
      </div>

      {/* Custom virtualized table */}
      <VirtualizedFileTable files={sortedFiles} />
    </div>
  );
}
