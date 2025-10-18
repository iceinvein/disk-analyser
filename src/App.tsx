import './styles.css';
import { useState, useEffect, useCallback } from 'react';
import { SidebarNavigator } from './components/SidebarNavigator';
import { ProgressIndicator } from './components/ProgressIndicator';
import { MillerColumns } from './components/MillerColumns';
import { DeletionDialog } from './components/DeletionDialog';
import { PermissionDialog } from './components/PermissionDialog';
import { SunburstChart } from './components/SunburstChart';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastContainer } from './components/Toast';
import { useStore } from '@nanostores/react';
import {
  $currentView,
  $selectedItemsCount,
  clearSelection,
  $scanTarget,
  $showPermissionDialog,
  $permissionDialogPath,
} from './stores';
import { Button } from '@heroui/react';
import { scanDirectoryStreaming } from './services/scanService';

function App() {
  const currentView = useStore($currentView);
  const selectedCount = useStore($selectedItemsCount);
  const scanTarget = useStore($scanTarget);
  const showPermissionDialog = useStore($showPermissionDialog);
  const permissionDialogPath = useStore($permissionDialogPath);
  const [isDeletionDialogOpen, setIsDeletionDialogOpen] = useState(false);

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

      // Ctrl/Cmd + A - Select all (could be implemented in FileListView)
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
      <div className="flex h-screen bg-gray-950 text-white">
        {/* Keyboard shortcuts help - Screen reader only */}
        <div className="sr-only" role="region" aria-label="Keyboard shortcuts">
          <h2>Available Keyboard Shortcuts</h2>
          <ul>
            <li>Delete: Open deletion dialog for selected items</li>
            <li>Escape: Clear selection or close dialog</li>
            <li>Ctrl/Cmd + R: Refresh current scan</li>
            <li>Ctrl/Cmd + D: Deselect all items</li>
            <li>Arrow keys: Navigate file list</li>
            <li>Space: Toggle selection in file list</li>
            <li>Enter: Expand/collapse folder in file list</li>
          </ul>
        </div>

        {/* Fixed Left Sidebar */}
        <aside className="w-64 flex-shrink-0 border-r border-gray-800 overflow-hidden">
          <SidebarNavigator />
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col overflow-hidden" role="main">
          {currentView ? (
            <>
              {/* Main layout: Miller columns (left) + Sunburst (right) */}
              <div className="flex-1 flex overflow-hidden">
                {/* Left: Miller Columns File Browser */}
                <div className="flex-1 flex flex-col overflow-hidden relative">
                  <MillerColumns />

                  {/* Action Bar - Bottom (shown when items are selected) */}
                  {selectedCount > 0 && (
                    <div
                      className="flex-shrink-0 p-4 bg-gray-900 border-t border-gray-700 flex items-center justify-between"
                      role="toolbar"
                      aria-label="Selection actions"
                    >
                      <div
                        className="text-sm text-gray-300"
                        role="status"
                        aria-live="polite"
                      >
                        {selectedCount} item{selectedCount !== 1 ? 's' : ''}{' '}
                        selected
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="light"
                          onPress={() => clearSelection()}
                          aria-label="Clear selection (Ctrl+D)"
                          className="text-gray-400 hover:text-white"
                        >
                          Clear Selection
                        </Button>
                        <Button
                          color="danger"
                          onPress={handleOpenDeletionDialog}
                          aria-label="Delete selected items (Delete key)"
                          className="bg-red-600 hover:bg-red-700"
                        >
                          Delete Selected
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right: Sunburst Chart (30% width) */}
                <div className="w-[30%] min-w-[400px] max-w-[500px] flex-shrink-0 border-l border-gray-800 flex items-center justify-center p-8 bg-gray-900/50">
                  <SunburstChart />
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

        {/* Toast Notifications */}
        <ToastContainer />
      </div>
    </ErrorBoundary>
  );
}

export default App;
