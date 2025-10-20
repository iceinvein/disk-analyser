import { atom, computed, map } from 'nanostores';
import type {
  FileNode,
  ScanProgress,
  DeletionResult,
  SortConfig,
  StorageLocation,
  FileType,
} from './types';
import { perfMonitor } from './utils/performance';

// Toast notification types
export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration: number;
}

// Atomic stores for simple values
export const $scanTarget = atom<string | null>(null);
export const $selectedLocation = atom<StorageLocation | null>(null);
export const $storageLocations = atom<StorageLocation[]>([]);
export const $quickAccessFolders = atom<StorageLocation[]>([]);
export const $isScanning = atom<boolean>(false);
export const $scanProgress = atom<ScanProgress | null>(null);
export const $scanResult = atom<FileNode | null>(null);
export const $currentView = atom<FileNode | null>(null);
export const $filterText = atom<string>('');
export const $toasts = atom<Toast[]>([]);
export const $scanError = atom<string | null>(null);
export const $canResumeScan = atom<boolean>(false);
export const $showPermissionDialog = atom<boolean>(false);
export const $permissionDialogPath = atom<string>('');

// Scan cache - stores scan results by path
export const $scanCache = map<Record<string, FileNode>>({});

// Map stores for complex objects
export const $sortConfig = map<SortConfig>({
  field: 'size',
  order: 'desc',
});

export const $selectedItems = map<Record<string, boolean>>({});
export const $expandedFolders = map<Record<string, boolean>>({});

// Computed stores for derived state
export const $selectedItemsArray = computed($selectedItems, (items) =>
  Object.keys(items).filter((key) => items[key]),
);

export const $selectedItemsCount = computed(
  $selectedItemsArray,
  (items) => items.length,
);

// Action functions

/**
 * Set storage locations
 * @param locations - Array of storage locations
 */
export function setStorageLocations(locations: StorageLocation[]): void {
  $storageLocations.set(locations);
}

/**
 * Set quick access folders
 * @param folders - Array of quick access folders
 */
export function setQuickAccessFolders(folders: StorageLocation[]): void {
  $quickAccessFolders.set(folders);
}

/**
 * Check if a path has cached scan results
 * @param path - The path to check
 * @returns true if cached results exist
 */
export function hasCachedScan(path: string): boolean {
  const cache = $scanCache.get();
  return path in cache;
}

/**
 * Get cached scan result for a path
 * @param path - The path to get cached results for
 * @returns Cached FileNode or null if not found
 */
export function getCachedScan(path: string): FileNode | null {
  const cache = $scanCache.get();
  return cache[path] || null;
}

/**
 * Store scan result in cache
 * @param path - The path that was scanned
 * @param result - The scan result to cache
 */
export function cacheScanResult(path: string, result: FileNode): void {
  $scanCache.setKey(path, result);
}

/**
 * Clear all cached scan results
 */
export function clearScanCache(): void {
  $scanCache.set({});
}

/**
 * Select a location and load from cache or start scanning
 * @param location - The storage location to select
 * @param forceRescan - Force a new scan even if cached
 */
export function selectLocation(
  location: StorageLocation,
  forceRescan = false,
): void {
  $selectedLocation.set(location);

  // Check cache first unless forcing rescan
  if (!forceRescan && hasCachedScan(location.path)) {
    const cached = getCachedScan(location.path);
    if (cached) {
      $scanResult.set(cached);
      $currentView.set(cached);
      $scanTarget.set(location.path);
      showToast(
        'info',
        'Loaded from Cache',
        'Using previously scanned data. Click "Rescan" to refresh.',
      );
      return;
    }
  }

  startScan(location.path);
}

/**
 * Start a new scan operation
 * @param path - The path to scan
 */
export function startScan(path: string): void {
  perfMonitor.start('scan-operation');
  $scanTarget.set(path);
  $isScanning.set(true);
  $scanProgress.set(null);
  $scanResult.set(null);
  $currentView.set(null);
  $scanError.set(null);
  $canResumeScan.set(false);
}

/**
 * Update scan progress during scanning
 * @param progress - Current scan progress
 */
export function updateProgress(progress: ScanProgress): void {
  $scanProgress.set(progress);
}

/**
 * Update with partial scan results (progressive scanning)
 * @param result - Partial scan result
 */
export function updatePartialScan(result: FileNode): void {
  $scanResult.set(result);
  // Only update current view if it's not set yet
  if (!$currentView.get()) {
    $currentView.set(result);
  }
}

// Incremental tree building state
const nodeRegistry = new Map<string, FileNode>();
const childrenMap = new Map<string, string[]>(); // parent_path -> child paths
let rootPath: string | null = null;
let lastUpdateTime = 0;
let pendingUpdate = false;
const UPDATE_INTERVAL_MS = 2000; // Only update UI every 2 seconds (reduced frequency for better performance)

/**
 * Add a node incrementally to the tree (streaming updates)
 * @param path - Node path
 * @param parentPath - Parent node path (null for root)
 * @param name - Node name
 * @param size - Node size
 * @param isDirectory - Whether node is a directory
 * @param fileType - File type
 */
export function addNodeIncremental(
  path: string,
  parentPath: string | null,
  name: string,
  size: number,
  isDirectory: boolean,
  fileType: FileType,
): void {
  // Create the node
  const node: FileNode = {
    name,
    path,
    size,
    is_directory: isDirectory,
    children: [],
    file_type: fileType,
    modified: Date.now(),
  };

  // Add to registry
  nodeRegistry.set(path, node);

  // Track root (first node with no parent)
  if (!parentPath && !rootPath) {
    rootPath = path;
  }

  // Track parent-child relationship
  if (parentPath) {
    const siblings = childrenMap.get(parentPath) || [];
    siblings.push(path);
    childrenMap.set(parentPath, siblings);
  }

  // Time-based throttling - only update UI every 500ms
  const now = Date.now();
  if (
    now - lastUpdateTime >= UPDATE_INTERVAL_MS &&
    rootPath &&
    !pendingUpdate
  ) {
    lastUpdateTime = now;
    scheduleTreeUpdate();
  }
}

/**
 * Schedule a tree update using requestAnimationFrame for smooth rendering
 */
function scheduleTreeUpdate(): void {
  if (pendingUpdate || !rootPath) return;

  pendingUpdate = true;
  requestAnimationFrame(() => {
    if (rootPath) {
      const tree = buildTreeFromRegistry(rootPath);

      if (tree) {
        $scanResult.set(tree);
        // Update currentView to show streaming updates
        $currentView.set(tree);
      }
    }
    pendingUpdate = false;
  });
}

/**
 * Build a tree from the node registry
 * Note: This is expensive for large trees - only call when necessary
 */
function buildTreeFromRegistry(rootPath: string): FileNode | null {
  const node = nodeRegistry.get(rootPath);
  if (!node) return null;

  // For files, return as-is
  if (!node.is_directory) {
    return { ...node };
  }

  // For directories, recursively build children
  const childPaths = childrenMap.get(rootPath) || [];
  const children: FileNode[] = [];
  let totalSize = 0;

  for (const childPath of childPaths) {
    const childTree = buildTreeFromRegistry(childPath);
    if (childTree) {
      children.push(childTree);
      totalSize += childTree.size;
    }
  }

  // Sort children by size (largest first)
  // Note: This is expensive for large directories - consider removing during scan
  children.sort((a, b) => b.size - a.size);

  // Return directory with calculated size and children
  return {
    ...node,
    size: totalSize, // Aggregate size from children
    children,
  };
}

/**
 * Clear incremental tree building state
 */
export function clearIncrementalState(): void {
  nodeRegistry.clear();
  childrenMap.clear();
  rootPath = null;
  lastUpdateTime = 0;
  pendingUpdate = false;
}

/**
 * Complete the scan operation with results
 * @param result - The root FileNode of the scanned directory
 */
export function completeScan(result: FileNode): void {
  perfMonitor.end('scan-operation');
  $scanResult.set(result);
  $currentView.set(result);
  $isScanning.set(false);

  // Cache the scan result
  const scanTarget = $scanTarget.get();
  if (scanTarget) {
    cacheScanResult(scanTarget, result);
  }
}

/**
 * Navigate to a specific node in the file tree
 * @param node - The FileNode to navigate to
 */
export function navigateTo(node: FileNode): void {
  $currentView.set(node);
}

/**
 * Toggle selection state of an item
 * @param path - The path of the item to toggle
 */
export function toggleSelection(path: string): void {
  const current = $selectedItems.get();
  $selectedItems.setKey(path, !current[path]);
}

/**
 * Clear all selected items
 */
export function clearSelection(): void {
  $selectedItems.set({});
}

/**
 * Set the sort configuration
 * @param field - The field to sort by
 * @param order - The sort order (ascending or descending)
 */
export function setSortConfig(
  field: SortConfig['field'],
  order: SortConfig['order'],
): void {
  $sortConfig.set({ field, order });
}

/**
 * Set the filter text for searching
 * @param text - The search/filter text
 */
export function setFilterText(text: string): void {
  $filterText.set(text);
}

/**
 * Toggle the expanded state of a folder
 * @param path - The path of the folder to toggle
 */
export function toggleFolderExpand(path: string): void {
  const current = $expandedFolders.get();
  $expandedFolders.setKey(path, !current[path]);
}

/**
 * Complete a deletion operation and update state
 * @param result - The result of the deletion operation
 */
export function completeDeletion(result: DeletionResult): void {
  // Remove deleted items from selection
  const current = $selectedItems.get();
  const updated = { ...current };

  for (const path of result.deleted) {
    delete updated[path];
  }

  $selectedItems.set(updated);

  // Show success/failure notifications
  if (result.deleted.length > 0) {
    const sizeGB = (result.space_freed / (1024 * 1024 * 1024)).toFixed(2);
    showToast(
      'success',
      'Deletion Complete',
      `Successfully deleted ${result.deleted.length} item(s), freed ${sizeGB} GB`,
    );
  }

  if (result.failed.length > 0) {
    showToast(
      'error',
      'Some Items Failed to Delete',
      `${result.failed.length} item(s) could not be deleted. Check console for details.`,
    );
    console.error('Failed deletions:', result.failed);
  }

  // Note: The actual tree update would require either:
  // 1. Triggering a rescan of the current directory
  // 2. Manually removing nodes from the tree (more complex)
  // For now, we just clear the selection of deleted items
  // The implementation of tree updates will be handled in the UI components
}

// Toast notification functions

let toastIdCounter = 0;

/**
 * Show a toast notification
 * @param type - Type of toast (success, error, warning, info)
 * @param title - Optional title
 * @param message - Message to display
 * @param duration - Duration in milliseconds (default: 5000)
 */
export function showToast(
  type: ToastType,
  title: string | undefined,
  message: string,
  duration = 5000,
): void {
  const id = `toast-${toastIdCounter++}`;
  const toast: Toast = {
    id,
    type,
    title,
    message,
    duration,
  };

  const current = $toasts.get();
  $toasts.set([...current, toast]);
}

/**
 * Remove a toast notification
 * @param id - ID of the toast to remove
 */
export function removeToast(id: string): void {
  const current = $toasts.get();
  $toasts.set(current.filter((t) => t.id !== id));
}

/**
 * Clear all toast notifications
 */
export function clearToasts(): void {
  $toasts.set([]);
}

// Error handling functions

/**
 * Handle scan error
 * @param error - Error message
 */
export function handleScanError(error: string): void {
  $isScanning.set(false);
  $scanError.set(error);
  showToast('error', 'Scan Failed', error);
}

/**
 * Set whether scan can be resumed
 * @param canResume - Whether the scan can be resumed
 */
export function setCanResumeScan(canResume: boolean): void {
  $canResumeScan.set(canResume);
}

/**
 * Resume a previously interrupted scan
 * Note: This function should be called from the UI, which will then call scanDirectory
 */
export function resumeScan(): void {
  const target = $scanTarget.get();
  if (target && $canResumeScan.get()) {
    $scanError.set(null);
    $canResumeScan.set(false);
    startScan(target);
    // The UI component should call scanDirectory(target) after this
  }
}

/**
 * Cancel current scan
 */
export async function cancelScan(): Promise<void> {
  try {
    // Call backend to cancel the scan
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('cancel_scan_command');

    // Update UI state
    $isScanning.set(false);
    $scanError.set(null);
    $canResumeScan.set(false);
    showToast('info', 'Scan Cancelled', 'The scan operation was cancelled.');
  } catch (error) {
    console.error('Failed to cancel scan:', error);
    // Still update UI even if backend cancel fails
    $isScanning.set(false);
    showToast(
      'warning',
      'Scan Stopped',
      'The scan was stopped but may still be running in the background.',
    );
  }
}
