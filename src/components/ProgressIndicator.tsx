import { useStore } from '@nanostores/react';
import { useEffect } from 'react';
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
          // Ignore partial_tree and node_update events - we only show stats during scan
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
      {/* Only show error state, scanning is handled by ScanningOverlay */}
      {scanError && !isScanning && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="fixed bottom-6 right-6 z-50"
        >
          {/* Error state - Floating card */}
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
        </motion.div>
      )}
    </AnimatePresence>
  );
}
