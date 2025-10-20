import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listen } from '@tauri-apps/api/event';
import {
  $isScanning,
  $scanError,
  $canResumeScan,
  $scanTarget,
  $scanProgress,
  updateProgress,
  updatePartialScan,
  resumeScan,
  cancelScan,
} from '../stores';
import { scanDirectoryStreaming } from '../services/scanService';
import type { ScanProgress, StreamingScanEvent } from '../types';

/**
 * Format bytes into human-readable units
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / k ** i;
  return `${value.toFixed(1)} ${units[i]}`;
}

/**
 * Format number with commas
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}

export function ProgressIndicator() {
  const isScanning = useStore($isScanning);
  const scanError = useStore($scanError);
  const canResumeScan = useStore($canResumeScan);
  const scanTarget = useStore($scanTarget);
  const scanProgress = useStore($scanProgress);
  const [isMinimized, setIsMinimized] = useState(false);

  // Listen to Tauri scan progress events
  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenStreaming: (() => void) | undefined;

    const setupListener = async () => {
      // Listen to old scan-progress events
      unlistenProgress = await listen<ScanProgress>(
        'scan-progress',
        (event) => {
          updateProgress(event.payload);
        },
      );

      // Listen to new streaming-scan-event events
      unlistenStreaming = await listen<StreamingScanEvent>(
        'streaming-scan-event',
        (event) => {
          const payload = event.payload;
          if (payload.type === 'progress') {
            updateProgress({
              current_path: payload.current_path,
              files_scanned: payload.files_scanned,
              total_size: payload.total_size,
            });
          } else if (payload.type === 'partial_tree') {
            // Update tree with partial results
            updatePartialScan(payload.tree);
          }
        },
      );
    };

    setupListener();

    return () => {
      if (unlistenProgress) {
        unlistenProgress();
      }
      if (unlistenStreaming) {
        unlistenStreaming();
      }
    };
  }, []);

  // Handle resume scan
  const handleResume = () => {
    resumeScan();
    if (scanTarget) {
      scanDirectoryStreaming(scanTarget);
    }
  };

  // Get shortened path for display
  const getShortPath = (path: string | undefined) => {
    if (!path) return '';
    const parts = path.split('/');
    if (parts.length > 3) {
      return `.../${parts.slice(-2).join('/')}`;
    }
    return path;
  };

  return (
    <AnimatePresence>
      {(isScanning || scanError) && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="fixed bottom-6 right-6 z-50"
        >
          {scanError ? (
            // Error state - Floating card
            <div
              className="glass-strong border border-red-500/30 rounded-2xl p-5 shadow-2xl shadow-red-500/20 max-w-md"
              role="alert"
              aria-live="assertive"
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-red-400"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-red-400 mb-1">
                    Scan Failed
                  </h3>
                  <p className="text-sm text-gray-300">{scanError}</p>
                  <div className="flex gap-2 mt-4">
                    {canResumeScan && (
                      <button
                        type="button"
                        onClick={handleResume}
                        className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors"
                      >
                        Resume
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={cancelScan}
                      className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-sm font-medium transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            // Scanning state - Floating card
            <motion.div
              layout
              className={`glass-strong border border-purple-500/30 rounded-2xl shadow-2xl shadow-purple-500/20 overflow-hidden ${
                isMinimized ? 'w-16 h-16' : 'w-80'
              }`}
              role="status"
              aria-live="polite"
            >
              {isMinimized ? (
                // Minimized state - Just pulsing icon
                <button
                  type="button"
                  onClick={() => setIsMinimized(false)}
                  className="w-full h-full flex items-center justify-center hover:bg-white/5 transition-colors"
                  aria-label="Expand scanning progress"
                >
                  <motion.div
                    animate={{
                      scale: [1, 1.2, 1],
                      opacity: [0.7, 1, 0.7],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: 'easeInOut',
                    }}
                    className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center"
                  >
                    <svg
                      className="w-4 h-4 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  </motion.div>
                </button>
              ) : (
                // Expanded state - Full details
                <div className="p-5">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <motion.div
                        animate={{
                          rotate: 360,
                        }}
                        transition={{
                          duration: 2,
                          repeat: Number.POSITIVE_INFINITY,
                          ease: 'linear',
                        }}
                        className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center"
                      >
                        <svg
                          className="w-4 h-4 text-white"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                          />
                        </svg>
                      </motion.div>
                      <div>
                        <h3 className="text-sm font-semibold text-white">
                          Analyzing
                        </h3>
                        <p className="text-xs text-gray-400">
                          Scanning files...
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setIsMinimized(true)}
                        className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors"
                        aria-label="Minimize"
                      >
                        <svg
                          className="w-4 h-4 text-gray-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M20 12H4"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={cancelScan}
                        className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors"
                        aria-label="Cancel scan"
                      >
                        <svg
                          className="w-4 h-4 text-gray-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Progress stats */}
                  {scanProgress && (
                    <div className="space-y-3">
                      {/* Files scanned */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">
                          Files scanned
                        </span>
                        <span className="text-sm font-semibold text-purple-300">
                          {formatNumber(scanProgress.files_scanned)}
                        </span>
                      </div>

                      {/* Total size */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">
                          Total size
                        </span>
                        <span className="text-sm font-semibold text-cyan-300">
                          {formatSize(scanProgress.total_size)}
                        </span>
                      </div>

                      {/* Current path */}
                      {scanProgress.current_path && (
                        <div className="pt-2 border-t border-white/10">
                          <span className="text-xs text-gray-500 block mb-1">
                            Current path
                          </span>
                          <span className="text-xs text-gray-300 font-mono truncate block">
                            {getShortPath(scanProgress.current_path)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Animated progress bar */}
                  <div className="mt-4 h-1 bg-gray-800 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-purple-500 via-cyan-500 to-purple-500"
                      animate={{
                        x: ['-100%', '100%'],
                      }}
                      transition={{
                        duration: 1.5,
                        repeat: Number.POSITIVE_INFINITY,
                        ease: 'linear',
                      }}
                      style={{ width: '50%' }}
                    />
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
