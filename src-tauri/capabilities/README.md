# Tauri Capabilities Configuration

This directory contains the security capabilities configuration for the Disk Analyzer application.

## Security Model

The Disk Analyzer uses a hybrid security model:

1. **Tauri IPC Permissions**: Defined in `default.json` for frontend-to-backend communication
2. **Native File System Access**: Rust backend uses standard library for direct file system operations

## Configured Permissions

### Core Permissions
- `core:default` - Basic Tauri functionality
- `core:event:default` - Event system for progress updates during scanning
- `core:path:default` - Path manipulation utilities

### Dialog Permissions
- `dialog:default` - Basic dialog functionality
- `dialog:allow-open` - Allows opening folder selection dialogs
- `dialog:allow-save` - Allows save dialogs (for future export features)

### Opener Permissions
- `opener:default` - Allows opening files/folders in system default applications

## File System Access

The application uses **custom Tauri commands** implemented in Rust that have direct access to the file system through Rust's standard library (`std::fs`, `walkdir`). This approach provides:

- **Better Performance**: Native Rust file operations are faster than IPC-based file system access
- **Fine-grained Control**: Custom safety checks and validation logic
- **Cross-platform Compatibility**: Handles platform-specific differences in Rust code

### Safety Measures

The backend implements several safety measures:

1. **Path Validation**: All paths are validated before access
2. **Protected Paths**: System-critical directories are protected from deletion
3. **Permission Handling**: Gracefully handles permission denied errors
4. **Process Lock Detection**: Checks if files are in use before deletion

### Platform-Specific Considerations

#### macOS
- Protected paths: `/System`, `/Library`, `/Applications`, `/usr`, `/bin`, `/sbin`
- Uses `statfs` for storage capacity information
- Volumes detected in `/Volumes`

#### Windows
- Protected paths: `C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)`
- Uses `GetDiskFreeSpaceEx` for storage capacity
- Drive letters enumerated for storage locations

#### Linux
- Protected paths: `/bin`, `/boot`, `/dev`, `/etc`, `/lib`, `/proc`, `/sys`, `/usr`
- Uses `statvfs` for storage capacity
- Mounts parsed from `/proc/mounts`

## Testing Permissions

To test that permissions are correctly configured:

1. Build the application: `bun run tauri build`
2. Run the application
3. Test folder selection dialog
4. Test scanning a directory
5. Test deletion with safety checks

## Future Enhancements

Potential permission additions for future features:

- Network access for cloud storage integration
- Notification permissions for scan completion alerts
- System tray permissions for background operation
