import { useStore } from '@nanostores/react';
import { useEffect } from 'react';
import { Progress, Button } from '@heroui/react';
import { motion, AnimatePresence } from 'framer-motion';
import { listen } from '@tauri-apps/api/event';
import {
  $isScanning,
  $scanError,
  $canResumeScan,
  $scanTarget,
  updateProgress,
  resumeScan,
  cancelScan,
} from '../stores';
import { scanDirectoryStreaming } from '../services/scanService';
import type { ScanProgress, StreamingScanEvent } from '../types';

export function ProgressIndicator() {
  const isScanning = useStore($isScanning);
  const scanError = useStore($scanError);
  const canResumeScan = useStore($canResumeScan);
  const scanTarget = useStore($scanTarget);

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

  return (
    <AnimatePresence>
      {(isScanning || scanError) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.3 }}
          className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 p-4 shadow-lg"
        >
          <div className="max-w-7xl mx-auto">
            {scanError ? (
              // Error state with retry option
              <div
                className="flex items-center gap-4"
                role="alert"
                aria-live="assertive"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <svg
                      className="w-5 h-5 text-red-500"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className="text-sm font-medium text-red-400">
                      Scan Failed
                    </span>
                  </div>
                  <p className="text-sm text-gray-400">{scanError}</p>
                </div>
                <div className="flex gap-2">
                  {canResumeScan && (
                    <Button
                      size="sm"
                      color="primary"
                      onPress={handleResume}
                      aria-label="Resume scan"
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      Resume
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="light"
                    onPress={cancelScan}
                    aria-label="Dismiss error"
                    className="text-gray-400 hover:text-white"
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            ) : (
              // Scanning state - simplified
              <div
                className="flex items-center gap-4"
                role="status"
                aria-live="polite"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{
                        duration: 1,
                        repeat: Number.POSITIVE_INFINITY,
                        ease: 'linear',
                      }}
                      className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full"
                      aria-hidden="true"
                    />
                    <span className="text-sm font-medium text-gray-200">
                      Analyzing disk usage...
                    </span>
                  </div>

                  {/* Indeterminate progress bar */}
                  <Progress
                    size="sm"
                    isIndeterminate
                    aria-label="Scanning in progress"
                    className="w-full"
                    classNames={{
                      indicator: 'bg-gradient-to-r from-blue-500 to-cyan-500',
                    }}
                  />
                </div>
                <Button
                  size="sm"
                  variant="light"
                  onPress={cancelScan}
                  aria-label="Cancel scan"
                  className="text-gray-400 hover:text-white"
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
