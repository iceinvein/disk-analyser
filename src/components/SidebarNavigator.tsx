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
  selectLocation,
  startScan,
  showToast,
  hasCachedScan,
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
      // Check if we have cached data
      if (hasCachedScan(location.path)) {
        selectLocation(location, false); // Load from cache
      } else {
        selectLocation(location, true); // Force new scan
        scanDirectoryStreaming(location.path);
      }
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

  return (
    <aside
      className="w-64 h-screen flex flex-col"
      aria-label="Storage locations navigation"
    >
      <div className="p-6 border-b border-white/10">
        <h2 className="text-xl font-bold text-white drop-shadow-lg">
          Disk Analyzer
        </h2>
        <p className="text-xs text-gray-400 mt-1">Analyze & Clean Storage</p>
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
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:ring-offset-2 focus:ring-offset-transparent ${
                      selectedLocation?.path === location.path
                        ? 'glass-light shadow-lg shadow-blue-500/20 text-white border-blue-400/30'
                        : 'text-gray-300 hover:glass-light hover:text-white hover:shadow-md'
                    } ${isScanning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span className="flex-shrink-0 text-xl">
                      {getLocationIcon(location.location_type)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate text-sm">
                        {location.name}
                      </div>
                      {location.total_space !== undefined && (
                        <>
                          <div className="text-xs text-gray-400 mt-1">
                            {formatSize(
                              location.total_space - location.available_space,
                            )}{' '}
                            of {formatSize(location.total_space)}
                          </div>
                          {/* Usage bar */}
                          <div className="mt-2 h-1.5 bg-gray-800/50 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 rounded-full transition-all duration-300"
                              style={{
                                width: `${((location.total_space - location.available_space) / location.total_space) * 100}%`,
                              }}
                            />
                          </div>
                        </>
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
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-purple-400/50 focus:ring-offset-2 focus:ring-offset-transparent ${
                      selectedLocation?.path === location.path
                        ? 'glass-light shadow-lg shadow-purple-500/20 text-white border-purple-400/30'
                        : 'text-gray-300 hover:glass-light hover:text-white hover:shadow-md'
                    } ${isScanning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span className="flex-shrink-0 text-lg">
                      {getLocationIcon(location.location_type)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate text-sm">
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
      <div className="p-4 border-t border-white/10 space-y-2">
        <button
          type="button"
          onClick={handleChooseFolder}
          disabled={isScanning}
          aria-label="Choose custom folder to scan"
          className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl glass-light text-gray-300 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-purple-400/50 focus:ring-offset-2 focus:ring-offset-transparent shadow-md ${
            isScanning
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:text-white hover:shadow-lg hover:border-white/20'
          }`}
        >
          <PlusIcon aria-hidden="true" />
          <span className="font-medium">Choose Folder...</span>
        </button>
      </div>
    </aside>
  );
}
