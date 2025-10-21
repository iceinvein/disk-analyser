import './styles.css';
import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useTransition,
} from 'react';
import { SidebarNavigator } from './components/SidebarNavigator';
import { ProgressIndicator } from './components/ProgressIndicator';
import { MillerColumns } from './components/MillerColumns';
import { LargestFilesView } from './components/LargestFilesView';
import { ViewModeTabs } from './components/ViewModeTabs';
import { DeletionDialog } from './components/DeletionDialog';
import { PermissionDialog } from './components/PermissionDialog';
import { ScanningOverlay } from './components/ScanningOverlay';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastContainer } from './components/Toast';
import { useStore } from '@nanostores/react';
import type { FileNode } from './types';
import {
  $currentView,
  $selectedItemsCount,
  $selectedItems,
  clearSelection,
  $scanTarget,
  $showPermissionDialog,
  $permissionDialogPath,
  $viewMode,
  $isScanning,
} from './stores';
import { scanDirectoryStreaming } from './services/scanService';

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

function App() {
  // Use transition for non-blocking tree updates
  const [isPending, startTransition] = useTransition();
  const [currentView, setCurrentView] = useState<FileNode | null>(null);
  const isScanning = useStore($isScanning);

  // Subscribe to store with transition
  useEffect(() => {
    const unsubscribe = $currentView.subscribe((value) => {
      startTransition(() => {
        setCurrentView(value);
      });
    });
    return unsubscribe;
  }, []);

  const selectedCount = useStore($selectedItemsCount);
  const selectedItems = useStore($selectedItems);
  const scanTarget = useStore($scanTarget);
  const showPermissionDialog = useStore($showPermissionDialog);
  const permissionDialogPath = useStore($permissionDialogPath);
  const viewMode = useStore($viewMode);
  const [isDeletionDialogOpen, setIsDeletionDialogOpen] = useState(false);

  // Calculate total size of selected items
  const selectedTotalSize = useMemo(() => {
    if (!currentView || selectedCount === 0) return 0;

    let total = 0;
    function calculateSize(node: FileNode): void {
      if (selectedItems[node.path.toString()]) {
        total += node.size || 0;
      }
      if (node.children) {
        node.children.forEach((child) => {
          calculateSize(child);
        });
      }
    }
    calculateSize(currentView);
    return total;
  }, [currentView, selectedItems, selectedCount]);

  const handleOpenDeletionDialog = useCallback(() => {
    if (selectedCount > 0) {
      setIsDeletionDialogOpen(true);
    }
  }, [selectedCount]);

  const handleCloseDeletionDialog = useCallback(() => {
    setIsDeletionDialogOpen(false);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if user is typing in an input field
      const target = e.target as HTMLElement;
      const isInputField =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Delete key - open deletion dialog (when items are selected and not in input)
      if (e.key === 'Delete' && selectedCount > 0 && !isInputField) {
        e.preventDefault();
        handleOpenDeletionDialog();
      }

      // Escape key - clear selection or close dialog
      if (e.key === 'Escape') {
        if (isDeletionDialogOpen) {
          handleCloseDeletionDialog();
        } else if (selectedCount > 0) {
          clearSelection();
        }
      }

      // Ctrl/Cmd + R - Refresh/Rescan
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === 'r' &&
        scanTarget &&
        !isInputField
      ) {
        e.preventDefault();
        scanDirectoryStreaming(scanTarget);
      }

      // Ctrl/Cmd + D - Deselect all
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && !isInputField) {
        e.preventDefault();
        clearSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedCount,
    isDeletionDialogOpen,
    scanTarget,
    handleOpenDeletionDialog,
    handleCloseDeletionDialog,
  ]);

  return (
    <ErrorBoundary>
      <div className="flex h-screen text-white">
        {/* Keyboard shortcuts help - Screen reader only */}
        <div className="sr-only" role="region" aria-label="Keyboard shortcuts">
          <h2>Available Keyboard Shortcuts</h2>
          <ul>
            <li>Delete: Open deletion dialog for selected items</li>
            <li>Escape: Clear selection or close dialog</li>
            <li>Ctrl/Cmd + R: Refresh current scan</li>
            <li>Ctrl/Cmd + D: Deselect all items</li>
          </ul>
        </div>

        {/* Fixed Left Sidebar with glassmorphism */}
        <aside className="w-64 flex-shrink-0 overflow-hidden glass-strong shadow-2xl">
          <SidebarNavigator />
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col overflow-hidden" role="main">
          {currentView ? (
            <>
              {/* View Mode Tabs */}
              <ViewModeTabs />

              {/* Content Area - Conditionally render based on view mode */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {viewMode === 'miller-columns' ? (
                  <MillerColumns />
                ) : (
                  <LargestFilesView />
                )}

                {/* Action Bar - Bottom (always visible) */}
                <div
                  className="flex-shrink-0 p-4 glass-strong border-t border-white/10 flex items-center justify-between"
                  role="toolbar"
                  aria-label="File actions"
                >
                  <div className="flex items-center gap-4">
                    {isPending && (
                      <div className="text-xs text-purple-400 flex items-center gap-2">
                        <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
                        Updating...
                      </div>
                    )}
                    {selectedCount > 0 ? (
                      <div className="text-sm" role="status" aria-live="polite">
                        <span className="text-white font-semibold">
                          {selectedCount}
                        </span>
                        <span className="text-gray-400">
                          {' '}
                          item{selectedCount !== 1 ? 's' : ''} selected
                        </span>
                        <span className="text-gray-500 mx-2">•</span>
                        <span className="text-purple-300 font-medium">
                          {formatSize(selectedTotalSize)}
                        </span>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400">
                        No items selected
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3">
                    {selectedCount > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => clearSelection()}
                          aria-label="Clear selection (Ctrl+D)"
                          className="px-4 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-all duration-150 font-medium"
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          onClick={handleOpenDeletionDialog}
                          aria-label="Delete selected items (Delete key)"
                          className="px-4 py-2 rounded-lg bg-red-600/90 hover:bg-red-600 text-white font-medium transition-all duration-150 shadow-lg shadow-red-500/20 hover:shadow-red-500/30"
                        >
                          <span className="flex items-center gap-2">
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
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                            Delete
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div
              className="flex-1 flex items-center justify-center"
              role="status"
            >
              <div className="text-center text-gray-400">
                <div className="mb-6">
                  <svg
                    className="w-24 h-24 mx-auto mb-4 text-gray-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
                    />
                  </svg>
                </div>
                <h1 className="text-3xl font-bold mb-3 text-white">
                  Disk Analyzer
                </h1>
                <p className="text-lg mb-2">
                  Select a location from the sidebar to begin scanning
                </p>
                <p className="text-sm text-gray-500">
                  Choose a storage device, network disk, or folder to analyze
                </p>
              </div>
            </div>
          )}
        </main>

        {/* Progress Indicator - Overlay/Bottom Bar */}
        <ProgressIndicator />

        {/* Deletion Dialog */}
        <DeletionDialog
          isOpen={isDeletionDialogOpen}
          onClose={handleCloseDeletionDialog}
        />

        {/* Permission Dialog */}
        <PermissionDialog
          isOpen={showPermissionDialog}
          onClose={() => $showPermissionDialog.set(false)}
          path={permissionDialogPath}
        />

        {/* Scanning Overlay - Shows during scan with stats */}
        {isScanning && <ScanningOverlay />}

        {/* Toast Notifications */}
        <ToastContainer />
      </div>
    </ErrorBoundary>
  );
}

export default App;
