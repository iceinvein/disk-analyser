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
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-md z-[9999]"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
        <div className="glass-strong rounded-2xl shadow-2xl max-w-lg w-full p-6">
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

            <div className="glass-light p-4 rounded-xl space-y-3">
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

            <div className="glass-light border border-yellow-500/30 p-3 rounded-xl shadow-lg shadow-yellow-500/10">
              <p className="text-sm text-yellow-200">
                <strong>Important:</strong> You must restart the app after
                granting permission for changes to take effect.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg glass-light hover:border-white/20 text-gray-300 transition-all duration-200 shadow-md"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleOpenSettings}
              className="px-4 py-2 rounded-lg glass-light border-blue-400/30 hover:border-blue-400/50 text-white transition-all duration-200 shadow-lg shadow-blue-500/20"
            >
              Open System Settings
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
