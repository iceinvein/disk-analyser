import { openFullDiskAccessSettings } from '../services/scanService';

interface PermissionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  path: string;
}

export function PermissionDialog({
  isOpen,
  onClose,
  path,
}: PermissionDialogProps) {
  const handleOpenSettings = async () => {
    await openFullDiskAccessSettings();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-[9999]" onClick={onClose} />

      {/* Dialog */}
      <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
        <div className="bg-gray-900 rounded-lg shadow-xl max-w-lg w-full p-6 border border-gray-700">
          {/* Header */}
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-white">
              🔒 Full Disk Access Required
            </h2>
          </div>

          {/* Body */}
          <div className="space-y-4 mb-6">
            <p className="text-gray-300">
              To scan <strong className="text-white">{path}</strong>, this app
              needs Full Disk Access permission.
            </p>

            <div className="bg-gray-800 p-4 rounded-lg space-y-3">
              <p className="font-semibold text-white">
                How to grant permission:
              </p>
              <ol className="list-decimal list-inside space-y-2 text-sm text-gray-300">
                <li>Click "Open System Settings" below</li>
                <li>Click the lock icon and authenticate</li>
                <li>Click the + button to add this app</li>
                <li>Enable the checkbox next to the app</li>
                <li>Close and restart this app completely</li>
              </ol>
            </div>

            <div className="bg-yellow-900/30 border border-yellow-700/50 p-3 rounded-lg">
              <p className="text-sm text-yellow-200">
                <strong>Important:</strong> You must restart the app after
                granting permission for changes to take effect.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleOpenSettings}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              Open System Settings
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
