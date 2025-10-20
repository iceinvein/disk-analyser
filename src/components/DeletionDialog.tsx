import { useState, useEffect, useCallback, useId } from 'react';
import { useStore } from '@nanostores/react';
import { invoke } from '@tauri-apps/api/core';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Spinner,
} from '@heroui/react';
import { motion, AnimatePresence } from 'framer-motion';
import { $selectedItemsArray, $scanResult, completeDeletion } from '../stores';
import type { SafetyCheck, DeletionResult, FileNode } from '../types';

interface DeletionDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Format bytes to human-readable size
 */
function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Find a FileNode by path in the tree
 */
function findNodeByPath(root: FileNode | null, path: string): FileNode | null {
  if (!root) return null;
  if (root.path === path) return root;

  for (const child of root.children) {
    const found = findNodeByPath(child, path);
    if (found) return found;
  }

  return null;
}

export function DeletionDialog({ isOpen, onClose }: DeletionDialogProps) {
  const selectedPaths = useStore($selectedItemsArray);
  const scanResult = useStore($scanResult);

  const [safetyChecks, setSafetyChecks] = useState<SafetyCheck[]>([]);
  const [isCheckingSafety, setIsCheckingSafety] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletionResult, setDeletionResult] = useState<DeletionResult | null>(
    null,
  );
  const [confirmationText, setConfirmationText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const safetyChecksHeadingId = useId();

  // Calculate total size and get file nodes
  const selectedNodes = selectedPaths
    .map((path) => findNodeByPath(scanResult, path))
    .filter((node): node is FileNode => node !== null);

  const totalSize = selectedNodes.reduce((sum, node) => sum + node.size, 0);
  const requiresConfirmation = totalSize > 10 * 1024 * 1024 * 1024; // 10GB
  const confirmationPhrase = 'DELETE';

  /**
   * Check deletion safety for all selected items
   */
  const checkSafety = useCallback(async () => {
    setIsCheckingSafety(true);
    setError(null);

    try {
      const checks = await invoke<SafetyCheck[]>(
        'check_deletion_safety_command',
        {
          paths: selectedPaths,
        },
      );
      setSafetyChecks(checks);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to check deletion safety',
      );
    } finally {
      setIsCheckingSafety(false);
    }
  }, [selectedPaths]);

  // Check safety when dialog opens or selection changes
  useEffect(() => {
    if (isOpen && selectedPaths.length > 0 && !deletionResult) {
      checkSafety();
    }
  }, [isOpen, selectedPaths, deletionResult, checkSafety]);

  /**
   * Execute the deletion operation
   */
  async function handleDelete() {
    // Validate confirmation text for large deletions
    if (requiresConfirmation && confirmationText !== confirmationPhrase) {
      setError(
        `Please type "${confirmationPhrase}" to confirm this large deletion`,
      );
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      const result = await invoke<DeletionResult>('delete_items_command', {
        paths: selectedPaths,
      });

      setDeletionResult(result);
      completeDeletion(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete items');
    } finally {
      setIsDeleting(false);
    }
  }

  /**
   * Handle dialog close
   */
  function handleClose() {
    // Reset state
    setSafetyChecks([]);
    setDeletionResult(null);
    setConfirmationText('');
    setError(null);
    onClose();
  }

  /**
   * Get safety check icon and color
   */
  function getSafetyCheckStyle(check: SafetyCheck): {
    icon: string;
    color: string;
    bgColor: string;
  } {
    switch (check.type) {
      case 'Safe':
        return {
          icon: '✓',
          color: 'text-green-400',
          bgColor: 'bg-green-500/10',
        };
      case 'Protected':
        return {
          icon: '⚠',
          color: 'text-red-400',
          bgColor: 'bg-red-500/10',
        };
      case 'InUse':
        return {
          icon: '⚠',
          color: 'text-yellow-400',
          bgColor: 'bg-yellow-500/10',
        };
      case 'RequiresConfirmation':
        return {
          icon: '!',
          color: 'text-orange-400',
          bgColor: 'bg-orange-500/10',
        };
      default:
        return {
          icon: '?',
          color: 'text-gray-400',
          bgColor: 'bg-gray-500/10',
        };
    }
  }

  /**
   * Check if deletion is blocked
   */
  const hasBlockingIssues = safetyChecks.some(
    (check) => check.type === 'Protected' || check.type === 'InUse',
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="2xl"
      classNames={{
        base: 'glass-strong shadow-2xl',
        header: 'border-b border-white/10',
        body: 'py-6',
        footer: 'border-t border-white/10',
        backdrop: 'bg-black/60 backdrop-blur-md',
      }}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-white">
            {deletionResult ? 'Deletion Complete' : 'Confirm Deletion'}
          </h2>
          {!deletionResult && (
            <p className="text-sm text-gray-400 font-normal">
              {selectedPaths.length} item{selectedPaths.length !== 1 ? 's' : ''}{' '}
              selected • {formatSize(totalSize)} to be freed
            </p>
          )}
        </ModalHeader>

        <ModalBody>
          <AnimatePresence mode="wait">
            {deletionResult ? (
              // Show deletion results
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <div className="flex items-center gap-2 text-green-400 mb-2">
                    <span className="text-xl">✓</span>
                    <span className="font-semibold">
                      Successfully deleted {deletionResult.deleted.length} item
                      {deletionResult.deleted.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300">
                    Space freed: {formatSize(deletionResult.space_freed)}
                  </p>
                </div>

                {deletionResult.failed.length > 0 && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <div className="flex items-center gap-2 text-red-400 mb-2">
                      <span className="text-xl">✗</span>
                      <span className="font-semibold">
                        Failed to delete {deletionResult.failed.length} item
                        {deletionResult.failed.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="space-y-2 mt-3 max-h-48 overflow-y-auto">
                      {deletionResult.failed.map((failed) => (
                        <div
                          key={failed.path}
                          className="text-sm bg-gray-800/50 p-2 rounded"
                        >
                          <p className="text-gray-300 font-mono text-xs truncate">
                            {failed.path}
                          </p>
                          <p className="text-red-400 text-xs mt-1">
                            {failed.error}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            ) : (
              // Show deletion confirmation
              <motion.div
                key="confirmation"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                {/* Safety checks loading */}
                {isCheckingSafety && (
                  <div
                    className="flex items-center justify-center py-8"
                    role="status"
                    aria-live="polite"
                  >
                    <Spinner size="lg" color="primary" aria-hidden="true" />
                    <span className="ml-3 text-gray-400">
                      Checking deletion safety...
                    </span>
                  </div>
                )}

                {/* Safety checks results */}
                {!isCheckingSafety && safetyChecks.length > 0 && (
                  <div className="space-y-2">
                    <h3
                      className="text-sm font-semibold text-gray-300 mb-3"
                      id={safetyChecksHeadingId}
                    >
                      Safety Checks
                    </h3>
                    <div
                      className="space-y-2 max-h-64 overflow-y-auto"
                      role="list"
                      aria-labelledby={safetyChecksHeadingId}
                    >
                      {selectedNodes.map((node, index) => {
                        const check = safetyChecks[index];
                        const style = getSafetyCheckStyle(check);

                        return (
                          <div
                            key={node.path}
                            className={`p-3 rounded-lg border ${style.bgColor} border-gray-700`}
                            role="listitem"
                          >
                            <div className="flex items-start gap-3">
                              <span
                                className={`text-lg ${style.color} flex-shrink-0`}
                                aria-label={`Safety status: ${check.type}`}
                              >
                                {style.icon}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-200 font-mono truncate">
                                  {node.name}
                                </p>
                                <p className="text-xs text-gray-400 mt-1">
                                  {formatSize(node.size)}
                                </p>
                                {check.type !== 'Safe' &&
                                  'message' in check && (
                                    <p
                                      className={`text-xs mt-2 ${style.color}`}
                                      role="alert"
                                    >
                                      {check.message}
                                    </p>
                                  )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Large deletion confirmation */}
                {requiresConfirmation && !hasBlockingIssues && (
                  <div
                    className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-lg"
                    role="alert"
                  >
                    <div className="flex items-center gap-2 text-orange-400 mb-3">
                      <span className="text-xl" aria-hidden="true">
                        !
                      </span>
                      <span className="font-semibold">
                        Large Deletion Warning
                      </span>
                    </div>
                    <p className="text-sm text-gray-300 mb-4">
                      You are about to delete {formatSize(totalSize)} of data.
                      Please type <strong>{confirmationPhrase}</strong> to
                      confirm.
                    </p>
                    <Input
                      value={confirmationText}
                      onChange={(e) => setConfirmationText(e.target.value)}
                      placeholder={`Type "${confirmationPhrase}" to confirm`}
                      aria-label={`Type ${confirmationPhrase} to confirm deletion`}
                      aria-required="true"
                      classNames={{
                        input: 'bg-gray-800 text-white',
                        inputWrapper: 'bg-gray-800 border-gray-700',
                      }}
                      autoFocus
                    />
                  </div>
                )}

                {/* Error message */}
                {error && (
                  <div
                    className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg"
                    role="alert"
                    aria-live="assertive"
                  >
                    <p className="text-sm text-red-400">{error}</p>
                  </div>
                )}

                {/* Blocking issues warning */}
                {hasBlockingIssues && (
                  <div
                    className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg"
                    role="alert"
                  >
                    <div className="flex items-center gap-2 text-red-400">
                      <span className="text-xl" aria-hidden="true">
                        ⚠
                      </span>
                      <span className="font-semibold">
                        Cannot proceed with deletion
                      </span>
                    </div>
                    <p className="text-sm text-gray-300 mt-2">
                      Some items are protected or currently in use. Please
                      deselect these items to continue.
                    </p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </ModalBody>

        <ModalFooter>
          {deletionResult ? (
            <Button
              color="primary"
              onPress={handleClose}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Close
            </Button>
          ) : (
            <>
              <Button
                variant="light"
                onPress={handleClose}
                className="text-gray-400 hover:text-white"
                isDisabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                color="danger"
                onPress={handleDelete}
                isLoading={isDeleting}
                isDisabled={
                  isCheckingSafety ||
                  hasBlockingIssues ||
                  (requiresConfirmation &&
                    confirmationText !== confirmationPhrase)
                }
                className="bg-red-600 hover:bg-red-700"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
