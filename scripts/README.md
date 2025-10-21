# Build & Release Scripts

This directory contains automation scripts for building, versioning, and releasing Disk Analyser.

## Version Management

### `bump_version.sh`
Bump version across all configuration files and optionally build.

```bash
./scripts/bump_version.sh [major|minor|patch]
```

**Features:**
- Updates version in `package.json`, `Cargo.toml`, and `tauri.conf.json`
- Interactive build options (skip, direct, MAS, universal)
- Optional git commit and tag creation

**Examples:**
```bash
./scripts/bump_version.sh patch   # 0.1.0 → 0.1.1
./scripts/bump_version.sh minor   # 0.1.0 → 0.2.0
./scripts/bump_version.sh major   # 0.1.0 → 1.0.0
```

## Entitlements Management

### `switch_entitlements.sh`
Switch between Mac App Store and Direct Distribution entitlements.

```bash
./scripts/switch_entitlements.sh [mas|direct]
```

**Modes:**
- `mas` - Mac App Store (sandboxed, user-selected files only)
- `direct` - Direct Distribution (full disk access)
- No argument - Show current mode

**Examples:**
```bash
./scripts/switch_entitlements.sh mas      # Switch to MAS mode
./scripts/switch_entitlements.sh direct   # Switch to direct mode
./scripts/switch_entitlements.sh          # Show current mode
```

## Mac App Store Build

### `build_for_mas.sh`
Complete automated Mac App Store build process.

```bash
./scripts/build_for_mas.sh
```

**What it does:**
1. Switches to MAS entitlements
2. Builds frontend
3. Builds Tauri app for Apple Silicon
4. Signs for Mac App Store
5. Creates installer package
6. Switches back to direct entitlements
7. Cleans up backup files

**Output:** `DiskAnalyser.pkg` ready for upload via Transporter

### `sign_for_mas.sh`
Sign app bundle for Mac App Store submission.

```bash
./scripts/sign_for_mas.sh
```

**Requirements:**
- App must be built first
- Valid Apple Distribution certificate
- Provisioning profile

**What it signs:**
- Frameworks and dylibs
- XPC services
- Helper executables
- Main application

### `create_mas_package.sh`
Create installer package for App Store Connect upload.

```bash
./scripts/create_mas_package.sh
```

**Requirements:**
- Signed app bundle
- Valid Mac Installer Distribution certificate

**Output:** `DiskAnalyser.pkg`

## Direct Distribution Build

### `build_universal.sh`
Build universal binary for direct distribution (Intel + Apple Silicon).

```bash
./scripts/build_universal.sh
```

**What it does:**
1. Installs required Rust targets
2. Builds for Apple Silicon (aarch64)
3. Builds for Intel (x86_64)
4. Creates universal binary with `lipo`

**Output:** Universal app in `src-tauri/target/universal-apple-darwin/release/bundle/macos/`

## Maintenance

### `cleanup.sh`
Clean up build artifacts and temporary files.

```bash
./scripts/cleanup.sh
```

**Removes:**
- Entitlements backup files
- .pkg installer files
- Build artifacts (optional, requires confirmation)
- Frontend build directory

## Quick Reference

### First Time Setup
```bash
# Make all scripts executable
chmod +x scripts/*.sh
```

### Common Workflows

**Release to Mac App Store:**
```bash
./scripts/bump_version.sh minor
# Select option 3 (Build for Mac App Store)
# Upload DiskAnalyser.pkg via Transporter app
```

**Direct Distribution Release:**
```bash
./scripts/bump_version.sh patch
# Select option 4 (Build universal binary)
# Distribute the .app or create DMG
```

**Development Build:**
```bash
bun run tauri dev
```

**Clean Build:**
```bash
./scripts/cleanup.sh
bun run tauri build
```

## File Structure

```
scripts/
├── README.md                    # This file
├── bump_version.sh              # Version management
├── switch_entitlements.sh       # Entitlements switcher
├── build_for_mas.sh            # MAS automated build
├── build_universal.sh          # Universal binary build
├── sign_for_mas.sh             # MAS signing
├── create_mas_package.sh       # Package creation
└── cleanup.sh                  # Cleanup utility
```

## Notes

- All scripts use color-coded output for better readability
- Scripts create backups before making changes
- Error handling with `set -e` (exit on error)
- Scripts are idempotent where possible

## Troubleshooting

**"Permission denied" error:**
```bash
chmod +x scripts/*.sh
```

**"Certificate not found" error:**
```bash
# List available certificates
security find-identity -v -p codesigning

# Update certificate names in sign_for_mas.sh
```

**Build fails with target error:**
```bash
# Install required Rust targets
rustup target add aarch64-apple-darwin
rustup target add x86_64-apple-darwin
```

## Related Documentation

- [MAS_SUBMISSION.md](../MAS_SUBMISSION.md) - Complete Mac App Store submission guide
- [Tauri Documentation](https://tauri.app/v2/guides/)
- [Apple Developer Portal](https://developer.apple.com)
