import { useStore } from '@nanostores/react';
import { useState, useMemo } from 'react';
import { $currentView, $selectedItems, toggleSelection } from '../stores';
import type { FileNode } from '../types';

/**
 * Format bytes into human-readable units
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / k ** i;
  return `${value.toFixed(2)} ${units[i]}`;
}

/**
 * Get icon for file type
 */
function getFileIcon(node: FileNode): string {
  if (node.is_directory) return '📁';

  const ext = node.name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'svg':
      return '🖼️';
    case 'mp4':
    case 'mov':
    case 'avi':
      return '🎬';
    case 'mp3':
    case 'wav':
    case 'flac':
      return '🎵';
    case 'pdf':
      return '📄';
    case 'zip':
    case 'tar':
    case 'gz':
      return '📦';
    case 'js':
    case 'ts':
    case 'jsx':
    case 'tsx':
      return '📜';
    default:
      return '📄';
  }
}

interface ColumnProps {
  items: FileNode[];
  selectedPath: string | null;
  onSelect: (node: FileNode) => void;
  onCheck: (node: FileNode) => void;
  checkedItems: Record<string, boolean>;
}

/**
 * Single column in Miller columns view
 */
function Column({
  items,
  selectedPath,
  onSelect,
  onCheck,
  checkedItems,
}: ColumnProps) {
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      // Directories first
      if (a.is_directory && !b.is_directory) return -1;
      if (!a.is_directory && b.is_directory) return 1;
      // Then by size (descending)
      return b.size - a.size;
    });
  }, [items]);

  return (
    <div className="flex-shrink-0 w-80 border-r border-gray-800 overflow-y-auto">
      {sortedItems.map((item) => {
        const isSelected = item.path.toString() === selectedPath;
        const isChecked = checkedItems[item.path.toString()];

        return (
          <div
            key={item.path.toString()}
            className={`
              flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-gray-800/50
              hover:bg-gray-800/50 transition-colors
              ${isSelected ? 'bg-blue-600/20 border-l-2 border-l-blue-500' : ''}
            `}
            onClick={() => onSelect(item)}
          >
            {/* Checkbox */}
            <input
              type="checkbox"
              checked={isChecked || false}
              onChange={(e) => {
                e.stopPropagation();
                onCheck(item);
              }}
              aria-label={`Select ${item.name}`}
              className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-900"
            />

            {/* Icon */}
            <span className="text-lg flex-shrink-0">{getFileIcon(item)}</span>

            {/* Name and size */}
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-200 truncate">{item.name}</div>
            </div>

            {/* Size */}
            <div className="text-xs text-gray-500 flex-shrink-0">
              {formatSize(item.size)}
            </div>

            {/* Arrow for directories */}
            {item.is_directory && item.children.length > 0 && (
              <svg
                className="w-4 h-4 text-gray-600 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Miller Columns file browser (like macOS Finder)
 */
export function MillerColumns() {
  const currentView = useStore($currentView);
  const selectedItems = useStore($selectedItems);
  // Track selected items in each column (not including root)
  const [selectedPath, setSelectedPath] = useState<FileNode[]>([]);

  // Reset when currentView changes (new scan)
  useMemo(() => {
    if (currentView) {
      setSelectedPath([]);
    }
  }, [currentView]);

  if (!currentView) return null;

  const handleSelect = (node: FileNode, columnIndex: number) => {
    if (node.is_directory && node.children.length > 0) {
      // Navigate into directory - add to selected path
      const newPath = [...selectedPath.slice(0, columnIndex), node];
      setSelectedPath(newPath);
      // Don't update currentView - keep the root stable
    } else {
      // File selected - could show details or preview
      // For now, just track it in the path
    }
  };

  const handleCheck = (node: FileNode) => {
    toggleSelection(node.path.toString());
  };

  // Build full path for breadcrumb (root + selected)
  const fullPath = [currentView, ...selectedPath];

  return (
    <div className="flex-1 flex overflow-x-auto overflow-y-hidden">
      {/* Breadcrumb navigation */}
      <div className="absolute top-0 left-0 right-0 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800 px-4 py-2 z-10">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          {fullPath.map((node, index) => (
            <div key={node.path.toString()} className="flex items-center gap-2">
              {index > 0 && (
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              )}
              <button
                onClick={() => {
                  if (index === 0) {
                    // Click on root - clear selection
                    setSelectedPath([]);
                  } else {
                    // Click on intermediate - trim path to that level
                    const newPath = selectedPath.slice(0, index);
                    setSelectedPath(newPath);
                  }
                }}
                className="hover:text-gray-200 transition-colors"
              >
                {node.name || 'Root'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Columns */}
      <div className="flex pt-12">
        {/* First column: show root's children directly */}
        <Column
          items={currentView.children}
          selectedPath={selectedPath[0]?.path.toString() || null}
          onSelect={(item) => handleSelect(item, 0)}
          onCheck={handleCheck}
          checkedItems={selectedItems}
        />

        {/* Subsequent columns: show children of each selected item */}
        {selectedPath.map((node, index) => {
          const nextSelected = selectedPath[index + 1];

          return (
            <Column
              key={`${node.path.toString()}-${index}`}
              items={node.children}
              selectedPath={nextSelected?.path.toString() || null}
              onSelect={(item) => handleSelect(item, index + 1)}
              onCheck={handleCheck}
              checkedItems={selectedItems}
            />
          );
        })}
      </div>
    </div>
  );
}
