import { useStore } from '@nanostores/react';
import { useEffect, useId } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  $storageLocations,
  $quickAccessFolders,
  $selectedLocation,
  $isScanning,
  setStorageLocations,
  setQuickAccessFolders,
  startScan,
  showToast,
} from '../stores';
import { scanDirectoryStreaming } from '../services/scanService';
import type { StorageLocation } from '../types';
import { LocationType } from '../types';

// Icon components for different location types
const DriveIcon = () => (
  <svg
    className="w-5 h-5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
    />
  </svg>
);

const NetworkIcon = () => (
  <svg
    className="w-5 h-5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
    />
  </svg>
);

const FolderIcon = () => (
  <svg
    className="w-5 h-5"
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

const PlusIcon = () => (
  <svg
    className="w-5 h-5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 4v16m8-8H4"
    />
  </svg>
);

// Format bytes to human-readable size
function formatSize(bytes?: number): string {
  if (bytes === undefined) return '';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

// Get icon for location type
function getLocationIcon(type: LocationType) {
  switch (type) {
    case LocationType.Storage:
      return <DriveIcon />;
    case LocationType.Network:
      return <NetworkIcon />;
    case LocationType.Folder:
      return <FolderIcon />;
    default:
      return <FolderIcon />;
  }
}

export function SidebarNavigator() {
  const storageLocations = useStore($storageLocations);
  const quickAccessFolders = useStore($quickAccessFolders);
  const selectedLocation = useStore($selectedLocation);
  const isScanning = useStore($isScanning);

  const storagesHeadingId = useId();
  const networkDisksHeadingId = useId();
  const foldersHeadingId = useId();

  // Load storage locations and quick access folders on mount
  useEffect(() => {
    async function loadLocations() {
      try {
        const [storages, folders] = await Promise.all([
          invoke<StorageLocation[]>('get_storage_locations_command'),
          invoke<StorageLocation[]>('get_quick_access_folders_command'),
        ]);

        setStorageLocations(storages);
        setQuickAccessFolders(folders);
      } catch (error) {
        console.error('Failed to load locations:', error);
        showToast(
          'error',
          'Failed to Load Locations',
          'Could not load storage locations. Please try restarting the application.',
        );
      }
    }

    loadLocations();
  }, []);

  // Handle location selection
  const handleLocationClick = (location: StorageLocation) => {
    if (!isScanning) {
      startScan(location.path);
      scanDirectoryStreaming(location.path);
    }
  };

  // Handle custom folder selection
  const handleChooseFolder = async () => {
    if (isScanning) return;

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Choose Folder to Analyze',
      });

      if (selected) {
        startScan(selected);
        scanDirectoryStreaming(selected);
      }
    } catch (error) {
      console.error('Failed to open folder dialog:', error);
      showToast(
        'error',
        'Failed to Open Folder',
        'Could not open the folder selection dialog.',
      );
    }
  };

  // Separate locations by type
  const storages = storageLocations.filter(
    (loc) => loc.location_type === LocationType.Storage,
  );
  const networkDisks = storageLocations.filter(
    (loc) => loc.location_type === LocationType.Network,
  );

  return (
    <aside
      className="w-64 h-screen bg-gray-900 border-r border-gray-800 flex flex-col"
      aria-label="Storage locations navigation"
    >
      <div className="p-4 border-b border-gray-800">
        <h2 className="text-lg font-semibold text-white">Disk Analyzer</h2>
      </div>

      <nav
        className="flex-1 overflow-y-auto p-4 space-y-6"
        aria-label="Storage locations"
      >
        {/* Storages Section */}
        {storages.length > 0 && (
          <section aria-labelledby={storagesHeadingId}>
            <h3
              id={storagesHeadingId}
              className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2"
            >
              Storages
            </h3>
            <ul className="space-y-1">
              {storages.map((location) => (
                <li key={location.path}>
                  <button
                    type="button"
                    onClick={() => handleLocationClick(location)}
                    disabled={isScanning}
                    aria-label={`Scan ${location.name}${location.total_space !== undefined ? `, ${formatSize(location.available_space)} free of ${formatSize(location.total_space)}` : ''}`}
                    aria-pressed={
                      selectedLocation?.path === location.path
                        ? 'true'
                        : 'false'
                    }
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
                      selectedLocation?.path === location.path
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    } ${isScanning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span className="flex-shrink-0">
                      {getLocationIcon(location.location_type)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {location.name}
                      </div>
                      {location.total_space !== undefined && (
                        <div className="text-xs text-gray-400">
                          {formatSize(location.available_space)} free of{' '}
                          {formatSize(location.total_space)}
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Network Disks Section */}
        {networkDisks.length > 0 && (
          <section aria-labelledby={networkDisksHeadingId}>
            <h3
              id={networkDisksHeadingId}
              className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2"
            >
              Network Disks
            </h3>
            <ul className="space-y-1">
              {networkDisks.map((location) => (
                <li key={location.path}>
                  <button
                    type="button"
                    onClick={() => handleLocationClick(location)}
                    disabled={isScanning}
                    aria-label={`Scan ${location.name}${location.total_space !== undefined ? `, ${formatSize(location.available_space)} free of ${formatSize(location.total_space)}` : ''}`}
                    aria-pressed={
                      selectedLocation?.path === location.path
                        ? 'true'
                        : 'false'
                    }
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
                      selectedLocation?.path === location.path
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    } ${isScanning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span className="flex-shrink-0">
                      {getLocationIcon(location.location_type)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {location.name}
                      </div>
                      {location.total_space !== undefined && (
                        <div className="text-xs text-gray-400">
                          {formatSize(location.available_space)} free of{' '}
                          {formatSize(location.total_space)}
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Folders Section */}
        {quickAccessFolders.length > 0 && (
          <section aria-labelledby={foldersHeadingId}>
            <h3
              id={foldersHeadingId}
              className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2"
            >
              Folders
            </h3>
            <ul className="space-y-1">
              {quickAccessFolders.map((location) => (
                <li key={location.path}>
                  <button
                    type="button"
                    onClick={() => handleLocationClick(location)}
                    disabled={isScanning}
                    aria-label={`Scan ${location.name}`}
                    aria-pressed={
                      selectedLocation?.path === location.path
                        ? 'true'
                        : 'false'
                    }
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
                      selectedLocation?.path === location.path
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    } ${isScanning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span className="flex-shrink-0">
                      {getLocationIcon(location.location_type)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {location.name}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </nav>

      {/* Bottom Actions */}
      <div className="p-4 border-t border-gray-800 space-y-2">
        <button
          type="button"
          onClick={handleChooseFolder}
          disabled={isScanning}
          aria-label="Choose custom folder to scan"
          className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-700 text-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
            isScanning
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-gray-800 hover:text-white hover:border-gray-600'
          }`}
        >
          <PlusIcon aria-hidden="true" />
          <span>Choose Folder...</span>
        </button>

        <button
          type="button"
          aria-label="Clean up more files"
          className="w-full px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
        >
          Clean up more
        </button>
      </div>
    </aside>
  );
}
