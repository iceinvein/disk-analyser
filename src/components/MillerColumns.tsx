import { useStore } from '@nanostores/react';
import {
  useState,
  useMemo,
  memo,
  useRef,
  useEffect,
  useTransition,
} from 'react';
import {
  $currentView,
  $selectedItems,
  $scanTarget,
  $isScanning,
  toggleSelection,
  startScan,
} from '../stores';
import { scanDirectoryStreaming } from '../services/scanService';
import type { FileNode } from '../types';

const ITEM_HEIGHT = 73; // Height of each item in pixels (py-4 = 16px top + 16px bottom + content)
const OVERSCAN = 5; // Number of items to render outside viewport

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
 * Single column in Miller columns view with virtual scrolling
 * Memoized to prevent unnecessary re-renders
 */
const Column = memo(function Column({
  items,
  selectedPath,
  onSelect,
  onCheck,
  checkedItems,
}: ColumnProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  // Sort items
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      // Directories first
      if (a.is_directory && !b.is_directory) return -1;
      if (!a.is_directory && b.is_directory) return 1;
      // Then by size (descending)
      return b.size - a.size;
    });
  }, [items]);

  // Calculate visible range with virtual scrolling
  const { visibleItems, totalHeight, offsetY } = useMemo(() => {
    const total = sortedItems.length;
    const startIndex = Math.max(
      0,
      Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN,
    );
    const endIndex = Math.min(
      total,
      Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + OVERSCAN,
    );

    return {
      visibleItems: sortedItems
        .slice(startIndex, endIndex)
        .map((item, idx) => ({
          item,
          index: startIndex + idx,
        })),
      totalHeight: total * ITEM_HEIGHT,
      offsetY: startIndex * ITEM_HEIGHT,
    };
  }, [sortedItems, scrollTop, containerHeight]);

  // Update container height on mount and resize
  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.clientHeight);
      }
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  // Handle scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  return (
    <div
      ref={containerRef}
      className="flex-shrink-0 w-96 border-r border-white/5 overflow-y-auto"
      onScroll={handleScroll}
    >
      {/* Spacer for total height */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        {/* Visible items container */}
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleItems.map(({ item }) => {
            const isSelected = item.path.toString() === selectedPath;
            const isChecked = checkedItems[item.path.toString()];

            return (
              <div
                key={item.path.toString()}
                className={`
                  flex items-center gap-4 px-5 py-4 cursor-pointer border-b border-white/5
                  hover:glass-light transition-all duration-150
                  ${isSelected ? 'glass-light border-l-4 border-l-purple-400 shadow-lg shadow-purple-500/10' : ''}
                  ${isChecked ? 'bg-purple-500/10' : ''}
                `}
                style={{ height: ITEM_HEIGHT }}
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
                  className="w-5 h-5 rounded border-gray-600 bg-gray-800/50 text-purple-500 focus:ring-purple-500 focus:ring-offset-0 cursor-pointer hover:border-purple-400 transition-colors"
                />

                {/* Icon */}
                <span className="text-2xl flex-shrink-0">
                  {getFileIcon(item)}
                </span>

                {/* Name and size */}
                <div className="flex-1 min-w-0">
                  <div className="text-base text-gray-100 truncate font-medium">
                    {item.name}
                  </div>
                  <div className="text-sm text-gray-400 mt-1 flex items-center gap-3">
                    <span>{formatSize(item.size)}</span>
                    {item.is_directory && item.children.length > 0 && (
                      <span className="text-xs text-gray-500">
                        {item.children.length} item
                        {item.children.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>

                {/* Arrow for directories */}
                {item.is_directory && item.children.length > 0 && (
                  <svg
                    className="w-5 h-5 text-gray-400 flex-shrink-0"
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
      </div>
    </div>
  );
});

/**
 * Miller Columns file browser (like macOS Finder)
 */
export function MillerColumns() {
  // Use transition for non-blocking updates during scan
  const [isPending, startTransition] = useTransition();
  const [currentView, setCurrentView] = useState<FileNode | null>(null);

  // Subscribe to store with transition
  useEffect(() => {
    const unsubscribe = $currentView.subscribe((value) => {
      startTransition(() => {
        setCurrentView(value);
      });
    });
    return unsubscribe;
  }, []);

  const selectedItems = useStore($selectedItems);
  const scanTarget = useStore($scanTarget);
  const isScanning = useStore($isScanning);
  // Track selected items in each column (not including root)
  const [selectedPath, setSelectedPath] = useState<FileNode[]>([]);

  const handleRescan = () => {
    if (scanTarget && !isScanning) {
      startScan(scanTarget);
      scanDirectoryStreaming(scanTarget);
    }
  };

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
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Breadcrumb navigation */}
      <div
        className={`flex-shrink-0 glass-strong border-b border-white/10 px-6 py-4 shadow-lg transition-opacity duration-200 ${isPending ? 'opacity-70' : 'opacity-100'}`}
      >
        <div className="flex items-center justify-between gap-4">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-2 text-sm overflow-x-auto flex-1">
            {fullPath.map((node, index) => (
              <div
                key={node.path.toString()}
                className="flex items-center gap-2 flex-shrink-0"
              >
                {index > 0 && (
                  <svg
                    className="w-4 h-4 text-gray-500"
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
                  type="button"
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
                  className={`
                    px-3 py-1.5 rounded-lg transition-all duration-150
                    ${
                      index === fullPath.length - 1
                        ? 'text-white bg-purple-500/20 font-semibold'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }
                  `}
                >
                  {node.name || 'Root'}
                </button>
              </div>
            ))}
          </div>

          {/* Rescan button */}
          {scanTarget && (
            <button
              type="button"
              onClick={handleRescan}
              disabled={isScanning}
              aria-label="Rescan current directory (Ctrl+R)"
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-150 flex-shrink-0
                ${
                  isScanning
                    ? 'opacity-50 cursor-not-allowed text-gray-500'
                    : 'text-purple-400 hover:text-purple-300 hover:bg-purple-500/10'
                }
              `}
            >
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
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span className="font-medium text-sm">Rescan</span>
            </button>
          )}
        </div>
      </div>

      {/* Columns */}
      <div className="flex-1 flex overflow-x-auto overflow-y-hidden">
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
