import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { FileNode, PartialScanResult, StreamingScanEvent } from '../types';
import {
  completeScan,
  updatePartialScan,
  handleScanError,
  setCanResumeScan,
  $showPermissionDialog,
  $permissionDialogPath,
  addNodeIncremental,
  clearIncrementalState,
} from '../stores';

// Store the unlisten function for partial results
let unlistenPartialResults: UnlistenFn | null = null;
let unlistenStreamingEvents: UnlistenFn | null = null;

/**
 * Check if the app has permission to access a path
 * @param path - Path to check
 * @returns Whether the app has permission
 */
export async function checkPathPermissions(path: string): Promise<boolean> {
  try {
    return await invoke<boolean>('check_path_permissions_command', { path });
  } catch (error) {
    console.error('Permission check error:', error);
    return false;
  }
}

/**
 * Open System Settings to Full Disk Access (macOS only)
 */
export async function openFullDiskAccessSettings(): Promise<void> {
  try {
    await invoke('open_full_disk_access_settings');
  } catch (error) {
    console.error('Failed to open settings:', error);
  }
}

/**
 * Initiate a directory scan
 * @param path - Path to scan
 */
export async function scanDirectory(path: string): Promise<void> {
  try {
    // Validate path first
    const isValid = await invoke<boolean>('validate_path_command', { path });

    if (!isValid) {
      handleScanError('The selected path is not valid or accessible.');
      return;
    }

    // For macOS system paths, proactively check permissions
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const isSystemPath =
      path === '/' ||
      path.startsWith('/System') ||
      path.startsWith('/Library') ||
      path.startsWith('/private') ||
      path.startsWith('/usr') ||
      path.includes('Macintosh HD');

    if (isMac && isSystemPath) {
      const hasPermission = await checkPathPermissions(path);

      if (!hasPermission) {
        // Show permission dialog for macOS
        $permissionDialogPath.set(path);
        $showPermissionDialog.set(true);
        return;
      }
    }

    // Set up listener for partial results (progressive scanning)
    if (unlistenPartialResults) {
      unlistenPartialResults();
    }

    let scanCompleted = false;

    unlistenPartialResults = await listen<PartialScanResult>(
      'partial-scan-result',
      (event) => {
        const { tree, is_complete } = event.payload;

        if (is_complete) {
          // Final result - complete the scan
          scanCompleted = true;
          completeScan(tree);
        } else {
          // Partial result - update the UI
          updatePartialScan(tree);
        }
      },
    );

    // Start the scan
    const result = await invoke<FileNode>('scan_directory_command', { path });

    // Fallback: Complete the scan if no completion event was received
    if (!scanCompleted) {
      completeScan(result);
    }
  } catch (error) {
    console.error('Scan error:', error);

    // Parse error message
    let errorMessage = 'An unknown error occurred during scanning.';

    if (typeof error === 'string') {
      errorMessage = error;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    } else if (error && typeof error === 'object' && 'message' in error) {
      errorMessage = String(error.message);
    }

    // Check if this is a permission error on macOS
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const isPermissionError =
      errorMessage.toLowerCase().includes('permission') ||
      errorMessage.toLowerCase().includes('access denied');

    if (isMac && isPermissionError) {
      // Show permission dialog instead of generic error
      $permissionDialogPath.set(path);
      $showPermissionDialog.set(true);
      return;
    }

    // Determine if scan can be resumed based on error type
    const canResume = isResumableError(errorMessage);
    setCanResumeScan(canResume);

    // Handle the error
    handleScanError(errorMessage);
  }
}

/**
 * Determine if an error is resumable
 * @param errorMessage - The error message
 * @returns Whether the scan can be resumed
 */
function isResumableError(errorMessage: string): boolean {
  const resumablePatterns = [
    'permission denied',
    'access denied',
    'temporarily unavailable',
    'resource busy',
  ];

  const lowerMessage = errorMessage.toLowerCase();
  return resumablePatterns.some((pattern) => lowerMessage.includes(pattern));
}

/**
 * Initiate a directory scan with streaming updates (new async scanner)
 * @param path - Path to scan
 */
export async function scanDirectoryStreaming(path: string): Promise<void> {
  try {
    // Validate path first
    const isValid = await invoke<boolean>('validate_path_command', { path });

    if (!isValid) {
      handleScanError('The selected path is not valid or accessible.');
      return;
    }

    // For macOS system paths, proactively check permissions
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const isSystemPath =
      path === '/' ||
      path.startsWith('/System') ||
      path.startsWith('/Library') ||
      path.startsWith('/private') ||
      path.startsWith('/usr') ||
      path.includes('Macintosh HD');

    if (isMac && isSystemPath) {
      const hasPermission = await checkPathPermissions(path);

      if (!hasPermission) {
        // Show permission dialog for macOS
        $permissionDialogPath.set(path);
        $showPermissionDialog.set(true);
        return;
      }
    }

    // Set up listener for streaming events
    if (unlistenStreamingEvents) {
      unlistenStreamingEvents();
    }

    // Clear previous incremental state
    clearIncrementalState();

    // Listen for streaming progress events
    unlistenStreamingEvents = await listen<StreamingScanEvent>(
      'streaming-scan-event',
      (event) => {
        const payload = event.payload;

        if (payload.type === 'node_update') {
          // Incremental node update - append to tree
          addNodeIncremental(
            payload.path,
            payload.parent_path,
            payload.name,
            payload.size,
            payload.is_directory,
            payload.file_type,
          );
        } else if (payload.type === 'partial_tree') {
          // Update the UI with partial results
          updatePartialScan(payload.tree);
        }
        // Complete event is handled after invoke completes
      },
    );

    // Start the scan
    const result = await invoke<FileNode>('scan_directory_streaming_command', {
      path,
    });

    // Mark scan as complete
    // Always use the result from the backend - it's the complete, accurate tree
    completeScan(result);
  } catch (error) {
    console.error('Scan error:', error);

    // Parse error message
    let errorMessage = 'An unknown error occurred during scanning.';

    if (typeof error === 'string') {
      errorMessage = error;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    } else if (error && typeof error === 'object' && 'message' in error) {
      errorMessage = String(error.message);
    }

    // Check if this is a permission error on macOS
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const isPermissionError =
      errorMessage.toLowerCase().includes('permission') ||
      errorMessage.toLowerCase().includes('access denied');

    if (isMac && isPermissionError) {
      // Show permission dialog instead of generic error
      $permissionDialogPath.set(path);
      $showPermissionDialog.set(true);
      return;
    }

    // Determine if scan can be resumed based on error type
    const canResume = isResumableError(errorMessage);
    setCanResumeScan(canResume);

    // Handle the error
    handleScanError(errorMessage);
  }
}
