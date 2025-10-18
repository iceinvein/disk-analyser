import { useStore } from '@nanostores/react';
import { useMemo, useState, useEffect, memo, useId } from 'react';
import { List, type RowComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import {
  $currentView,
  $expandedFolders,
  $selectedItems,
  $sortConfig,
  $filterText,
  toggleFolderExpand,
  toggleSelection,
  setSortConfig,
  setFilterText,
} from '../stores';
import type { FileNode, SortField, SortOrder } from '../types';
import type { FileType } from '../types';

// Icon components
const ChevronRightIcon = () => (
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
);

const ChevronDownIcon = () => (
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
      d="M19 9l-7 7-7-7"
    />
  </svg>
);

const FolderIcon = () => (
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
      d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
    />
  </svg>
);

const FileIcon = () => (
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
      d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
    />
  </svg>
);

const SortAscIcon = () => (
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
      d="M5 15l7-7 7 7"
    />
  </svg>
);

const SortDescIcon = () => (
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
      d="M19 9l-7 7-7-7"
    />
  </svg>
);

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

// Format timestamp to readable date
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Get file type display name
function getFileTypeDisplay(fileType: FileType): string {
  return fileType;
}

// Flatten tree structure for virtual scrolling
interface FlatNode {
  node: FileNode;
  depth: number;
  isExpanded: boolean;
}

function flattenTree(
  node: FileNode,
  expandedFolders: Record<string, boolean>,
  depth = 0,
): FlatNode[] {
  const result: FlatNode[] = [];
  const isExpanded = expandedFolders[node.path] || false;

  result.push({ node, depth, isExpanded });

  if (node.is_directory && isExpanded && node.children.length > 0) {
    for (const child of node.children) {
      result.push(...flattenTree(child, expandedFolders, depth + 1));
    }
  }

  return result;
}

// Memoized sort comparator functions for better performance
const sortComparators: Record<SortField, (a: FileNode, b: FileNode) => number> =
  {
    size: (a, b) => a.size - b.size,
    name: (a, b) => a.name.localeCompare(b.name),
    type: (a, b) => {
      if (a.is_directory !== b.is_directory) {
        return a.is_directory ? -1 : 1;
      }
      return a.file_type.localeCompare(b.file_type);
    },
    modified: (a, b) => a.modified - b.modified,
  };

// Sort nodes with memoization-friendly implementation
function sortNodes(
  nodes: FileNode[],
  field: SortField,
  order: SortOrder,
): FileNode[] {
  const comparator = sortComparators[field];
  const sorted = [...nodes].sort((a, b) => {
    const comparison = comparator(a, b);
    return order === 'asc' ? comparison : -comparison;
  });

  return sorted;
}

// Filter nodes by search text
function filterNodes(node: FileNode, searchText: string): FileNode | null {
  if (!searchText) return node;

  const lowerSearch = searchText.toLowerCase();
  const nameMatches = node.name.toLowerCase().includes(lowerSearch);

  if (node.is_directory) {
    const filteredChildren = node.children
      .map((child) => filterNodes(child, searchText))
      .filter((child): child is FileNode => child !== null);

    if (nameMatches || filteredChildren.length > 0) {
      return {
        ...node,
        children: filteredChildren,
      };
    }
    return null;
  }

  return nameMatches ? node : null;
}

// Apply sorting to tree recursively
function applySortToTree(
  node: FileNode,
  field: SortField,
  order: SortOrder,
): FileNode {
  if (!node.is_directory || node.children.length === 0) {
    return node;
  }

  const sortedChildren = sortNodes(node.children, field, order).map((child) =>
    applySortToTree(child, field, order),
  );

  return {
    ...node,
    children: sortedChildren,
  };
}

// Row component for virtual list
interface RowData {
  flatNodes: FlatNode[];
  selectedItems: Record<string, boolean>;
  onToggleExpand: (path: string) => void;
  onToggleSelection: (path: string) => void;
  onKeyDown: (e: React.KeyboardEvent, index: number) => void;
  focusedIndex: number;
}

type RowProps = RowComponentProps<RowData>;

// Memoize Row component to prevent unnecessary re-renders
const Row = memo(function Row({ index, style, ...props }: RowProps) {
  const {
    flatNodes,
    selectedItems,
    onToggleExpand,
    onToggleSelection,
    onKeyDown,
    focusedIndex,
  } = props;
  const { node, depth, isExpanded } = flatNodes[index];
  const isSelected = selectedItems[node.path] || false;
  const isFocused = focusedIndex === index;

  return (
    <div
      style={style}
      role="row"
      aria-selected={isSelected ? 'true' : 'false'}
      tabIndex={isFocused ? 0 : -1}
      onKeyDown={(e) => onKeyDown(e, index)}
      className={`flex items-center gap-2 px-4 py-2 border-b border-gray-800 hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${
        isSelected ? 'bg-blue-900/30' : ''
      }`}
    >
      {/* Indentation */}
      <div style={{ width: `${depth * 24}px` }} className="flex-shrink-0" />

      {/* Expand/Collapse Icon */}
      <div className="flex-shrink-0 w-4">
        {node.is_directory && node.children.length > 0 && (
          <button
            type="button"
            onClick={() => onToggleExpand(node.path)}
            aria-label={
              isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`
            }
            aria-expanded={isExpanded ? 'true' : 'false'}
            className="text-gray-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
          >
            {isExpanded ? (
              <ChevronDownIcon aria-hidden="true" />
            ) : (
              <ChevronRightIcon aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      {/* Checkbox */}
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => onToggleSelection(node.path)}
        aria-label={`Select ${node.name}`}
        className="flex-shrink-0 w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
      />

      {/* Icon */}
      <div className="flex-shrink-0 text-gray-400">
        {node.is_directory ? <FolderIcon /> : <FileIcon />}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0 text-sm text-gray-200 truncate">
        {node.name}
        {node.is_directory && (
          <span className="text-gray-500 ml-2">({formatSize(node.size)})</span>
        )}
      </div>

      {/* Size */}
      <div className="flex-shrink-0 w-24 text-sm text-gray-400 text-right">
        {formatSize(node.size)}
      </div>

      {/* Type */}
      <div className="flex-shrink-0 w-32 text-sm text-gray-400 truncate">
        {node.is_directory ? 'Folder' : getFileTypeDisplay(node.file_type)}
      </div>

      {/* Modified */}
      <div className="flex-shrink-0 w-28 text-sm text-gray-400">
        {formatDate(node.modified)}
      </div>
    </div>
  );
});

export function FileListView() {
  const currentView = useStore($currentView);
  const expandedFolders = useStore($expandedFolders);
  const selectedItems = useStore($selectedItems);
  const sortConfig = useStore($sortConfig);
  const filterText = useStore($filterText);

  const [localSearchText, setLocalSearchText] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const searchInputId = useId();
  const sortLabelId = useId();

  // Handle search input with debouncing (300ms delay)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setFilterText(localSearchText);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [localSearchText]);

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalSearchText(e.target.value);
  };

  // Handle sort change
  const handleSortChange = (field: SortField) => {
    if (sortConfig.field === field) {
      // Toggle order if same field
      setSortConfig(field, sortConfig.order === 'asc' ? 'desc' : 'asc');
    } else {
      // Default to descending for new field
      setSortConfig(field, 'desc');
    }
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    const { node } = flatNodes[index];

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (index < flatNodes.length - 1) {
          setFocusedIndex(index + 1);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (index > 0) {
          setFocusedIndex(index - 1);
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (node.is_directory && !expandedFolders[node.path]) {
          toggleFolderExpand(node.path);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (node.is_directory && expandedFolders[node.path]) {
          toggleFolderExpand(node.path);
        }
        break;
      case ' ':
      case 'Enter':
        e.preventDefault();
        if (e.key === ' ') {
          toggleSelection(node.path);
        } else if (node.is_directory) {
          toggleFolderExpand(node.path);
        }
        break;
    }
  };

  // Process tree: filter, sort, flatten
  const flatNodes = useMemo(() => {
    if (!currentView) return [];

    // Apply filter
    const filtered = filterNodes(currentView, filterText);
    if (!filtered) return [];

    // Apply sort
    const sorted = applySortToTree(
      filtered,
      sortConfig.field,
      sortConfig.order,
    );

    // Flatten for virtual scrolling
    return flattenTree(sorted, expandedFolders);
  }, [currentView, filterText, sortConfig, expandedFolders]);

  if (!currentView) {
    return (
      <div
        className="flex-1 flex items-center justify-center bg-gray-900 text-gray-400"
        role="status"
      >
        <p>Select a location to start scanning</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-900">
      {/* Header with search and controls */}
      <div className="p-4 border-b border-gray-800 space-y-4">
        {/* Search */}
        <div className="relative">
          <label htmlFor={searchInputId} className="sr-only">
            Search files and folders
          </label>
          <input
            id={searchInputId}
            type="text"
            value={localSearchText}
            onChange={handleSearchChange}
            placeholder="Search files and folders..."
            aria-label="Search files and folders"
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Sort Controls */}
        <div
          className="flex items-center gap-2 text-sm"
          role="toolbar"
          aria-label="Sort options"
        >
          <span className="text-gray-400" id={sortLabelId}>
            Sort by:
          </span>
          <button
            type="button"
            onClick={() => handleSortChange('name')}
            aria-label={`Sort by name ${sortConfig.field === 'name' ? (sortConfig.order === 'asc' ? 'ascending' : 'descending') : ''}`}
            aria-pressed={sortConfig.field === 'name' ? 'true' : 'false'}
            className={`px-3 py-1 rounded-lg flex items-center gap-1 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              sortConfig.field === 'name'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            Name
            {sortConfig.field === 'name' &&
              (sortConfig.order === 'asc' ? (
                <SortAscIcon aria-hidden="true" />
              ) : (
                <SortDescIcon aria-hidden="true" />
              ))}
          </button>
          <button
            type="button"
            onClick={() => handleSortChange('size')}
            aria-label={`Sort by size ${sortConfig.field === 'size' ? (sortConfig.order === 'asc' ? 'ascending' : 'descending') : ''}`}
            aria-pressed={sortConfig.field === 'size' ? 'true' : 'false'}
            className={`px-3 py-1 rounded-lg flex items-center gap-1 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              sortConfig.field === 'size'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            Size
            {sortConfig.field === 'size' &&
              (sortConfig.order === 'asc' ? (
                <SortAscIcon aria-hidden="true" />
              ) : (
                <SortDescIcon aria-hidden="true" />
              ))}
          </button>
          <button
            type="button"
            onClick={() => handleSortChange('type')}
            aria-label={`Sort by type ${sortConfig.field === 'type' ? (sortConfig.order === 'asc' ? 'ascending' : 'descending') : ''}`}
            aria-pressed={sortConfig.field === 'type' ? 'true' : 'false'}
            className={`px-3 py-1 rounded-lg flex items-center gap-1 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              sortConfig.field === 'type'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            Type
            {sortConfig.field === 'type' &&
              (sortConfig.order === 'asc' ? (
                <SortAscIcon aria-hidden="true" />
              ) : (
                <SortDescIcon aria-hidden="true" />
              ))}
          </button>
          <button
            type="button"
            onClick={() => handleSortChange('modified')}
            aria-label={`Sort by modified date ${sortConfig.field === 'modified' ? (sortConfig.order === 'asc' ? 'ascending' : 'descending') : ''}`}
            aria-pressed={sortConfig.field === 'modified' ? 'true' : 'false'}
            className={`px-3 py-1 rounded-lg flex items-center gap-1 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              sortConfig.field === 'modified'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            Modified
            {sortConfig.field === 'modified' &&
              (sortConfig.order === 'asc' ? (
                <SortAscIcon aria-hidden="true" />
              ) : (
                <SortDescIcon aria-hidden="true" />
              ))}
          </button>
        </div>
      </div>

      {/* Column Headers */}
      <div
        className="flex items-center gap-2 px-4 py-2 bg-gray-800 border-b border-gray-700 text-xs font-semibold text-gray-400 uppercase"
        role="row"
        aria-label="Column headers"
      >
        <div className="flex-shrink-0 w-4" /> {/* Expand icon space */}
        <div className="flex-shrink-0 w-4" /> {/* Checkbox space */}
        <div className="flex-shrink-0 w-4" /> {/* Icon space */}
        <div className="flex-1 min-w-0" role="columnheader">
          Name
        </div>
        <div className="flex-shrink-0 w-24 text-right" role="columnheader">
          Size
        </div>
        <div className="flex-shrink-0 w-32" role="columnheader">
          Type
        </div>
        <div className="flex-shrink-0 w-28" role="columnheader">
          Modified
        </div>
      </div>

      {/* Virtual List */}
      <div className="flex-1" role="treegrid" aria-label="File and folder list">
        <AutoSizer>
          {({ height }) => (
            <List
              defaultHeight={height}
              rowCount={flatNodes.length}
              rowHeight={48}
              rowComponent={Row}
              rowProps={{
                flatNodes,
                selectedItems,
                onToggleExpand: toggleFolderExpand,
                onToggleSelection: toggleSelection,
                onKeyDown: handleKeyDown,
                focusedIndex,
              }}
              style={{ width: '100%' }}
            />
          )}
        </AutoSizer>
      </div>
    </div>
  );
}
