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
    return await invoke<boolean>('check_path_permissions', { path });
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

    unlistenPartialResults = await listen<PartialScanResult>(
      'partial-scan-result',
      (event) => {
        console.log('Received partial-scan-result event:', {
          files_scanned: event.payload.files_scanned,
          total_size: event.payload.total_size,
          is_complete: event.payload.is_complete,
          children_count: event.payload.tree.children.length,
        });

        const { tree, is_complete } = event.payload;

        if (is_complete) {
          console.log('Final result received, completing scan');
          // Final result - complete the scan
          completeScan(tree);
        } else {
          console.log('Partial result received, updating UI');
          // Partial result - update the UI
          updatePartialScan(tree);
        }
      },
    );

    // Start the scan
    const result = await invoke<FileNode>('scan_directory_command', { path });

    // Fallback: Complete the scan if no partial results were emitted
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

    // Listen for streaming progress events
    console.log('[STREAMING] Setting up event listener for:', path);
    unlistenStreamingEvents = await listen<StreamingScanEvent>(
      'streaming-scan-event',
      (event) => {
        const payload = event.payload;

        if (payload.type === 'node_discovered') {
          // Just log for now - we'll use the final result
          console.log(`[STREAMING] Discovered: ${payload.node.name}`);
        } else if (payload.type === 'progress') {
          console.log(
            `[STREAMING] Progress: ${payload.files_scanned} files, ${(payload.total_size / 1024 / 1024).toFixed(2)} MB`,
          );
        } else if (payload.type === 'complete') {
          console.log(
            `[STREAMING] Scan complete: ${payload.files_scanned} files, ${(payload.total_size / 1024 / 1024).toFixed(2)} MB`,
          );
        }
      },
    );

    console.log(
      '[STREAMING] Starting scan via scan_directory_streaming_command',
    );
    // Start the scan
    const result = await invoke<FileNode>('scan_directory_streaming_command', {
      path,
    });
    console.log(
      '[STREAMING] Scan command returned, result has',
      result.children.length,
      'children',
    );

    // Complete the scan with final result
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
