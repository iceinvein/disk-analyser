/**
 * Example usage of Nanostores in React components
 *
 * This file demonstrates how to use the stores in your components.
 * You can delete this file once you've implemented the actual components.
 */

import { useStore } from '@nanostores/react';
import {
  $isScanning,
  $scanProgress,
  $currentView,
  $selectedItemsCount,
  startScan,
  toggleSelection,
  setSortConfig,
} from './stores';

// Example: Using atomic stores
function ScanStatusExample() {
  const isScanning = useStore($isScanning);
  const scanProgress = useStore($scanProgress);

  return (
    <div>
      {isScanning && scanProgress && (
        <div>
          <p>Scanning: {scanProgress.current_path}</p>
          <p>Files scanned: {scanProgress.files_scanned}</p>
          <p>Total size: {scanProgress.total_size} bytes</p>
        </div>
      )}
    </div>
  );
}

// Example: Using computed stores
function SelectionCountExample() {
  const selectedCount = useStore($selectedItemsCount);

  return (
    <div>
      <p>Selected items: {selectedCount}</p>
    </div>
  );
}

// Example: Using action functions
function ScanControlExample() {
  const handleStartScan = () => {
    startScan('/path/to/scan');
  };

  return (
    <button type="button" onClick={handleStartScan}>
      Start Scan
    </button>
  );
}

// Example: Using multiple stores together
function FileListExample() {
  const currentView = useStore($currentView);

  const handleToggleSelection = (path: string) => {
    toggleSelection(path);
  };

  const handleSort = () => {
    setSortConfig('size', 'desc');
  };

  return (
    <div>
      {currentView && (
        <div>
          <h2>{currentView.name}</h2>
          <button type="button" onClick={handleSort}>
            Sort by Size
          </button>
          {currentView.children.map((child) => (
            <div key={child.path}>
              <label>
                <input
                  type="checkbox"
                  onChange={() => handleToggleSelection(child.path)}
                />
                <span>{child.name}</span>
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export {
  ScanStatusExample,
  SelectionCountExample,
  ScanControlExample,
  FileListExample,
};
