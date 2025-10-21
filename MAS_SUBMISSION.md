# Mac App Store Submission Guide

## Prerequisites

1. **Apple Developer Account** ($99/year)
   - Enroll at https://developer.apple.com/programs/

2. **Certificates** (create in Apple Developer Portal)
   - Mac App Distribution certificate
   - Mac Installer Distribution certificate

3. **App Store Connect Setup**
   - Create app listing at https://appstoreconnect.apple.com
   - Bundle ID must match: `com.dikrana.disk-analyser`

4. **Provisioning Profile**
   - Create Mac App Store provisioning profile for your app

## Important Changes for Mac App Store

### App Sandbox Requirement

The Mac App Store version **MUST** use App Sandbox, which means:

- ❌ Cannot access entire filesystem freely
- ✅ Can only access user-selected files/folders via file picker
- ✅ Users must explicitly choose what to scan

A separate `entitlements.mas.plist` has been created for Mac App Store builds.

### Build Configuration

Two build targets:
1. **Direct Distribution** (current `entitlements.plist`) - Full disk access, distributed outside App Store
2. **Mac App Store** (`entitlements.mas.plist`) - Sandboxed, for App Store submission

## Quick Start - Automated Build

For a streamlined process, use the automated build script:

```bash
./scripts/build_for_mas.sh
```

This script will:
1. Switch to Mac App Store entitlements
2. Build the app
3. Sign it for Mac App Store
4. Create the installer package
5. Switch back to direct distribution entitlements

Then upload `DiskAnalyser.pkg` via Transporter app.

## Manual Build Process

### Step 1: Update Version

Update version in both files:
- `package.json` → `"version": "1.0.0"`
- `src-tauri/tauri.conf.json` → `"version": "1.0.0"`
- `src-tauri/Cargo.toml` → `version = "1.0.0"`

### Step 2: Build with Mac App Store Entitlements

Use the automated script to switch to MAS entitlements and build:

```bash
# Switch to MAS entitlements, build, sign, and package
./scripts/build_for_mas.sh
```

Or manually:

```bash
# Switch to MAS entitlements
./scripts/switch_entitlements.sh mas

# Build the app
bun run tauri build -- --target aarch64-apple-darwin

# Sign for Mac App Store
./scripts/sign_for_mas.sh

# Create installer package
./scripts/create_mas_package.sh

# Switch back to direct distribution entitlements
./scripts/switch_entitlements.sh direct
```

The built app will be in: `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/`

**Note**: This build targets Apple Silicon (M1/M2/M3) Macs only. 

For universal binary (Intel + Apple Silicon), use the dedicated script:
```bash
./scripts/build_universal.sh
```

This will create a universal binary that works on both architectures.

### Step 3: Upload to App Store Connect via Transporter (Recommended)

**Transporter** is Apple's official app for uploading builds to App Store Connect. It's more reliable and user-friendly than command-line tools.

1. **Download Transporter** (if not installed)
   - Available on Mac App Store: https://apps.apple.com/app/transporter/id1450874784
   - Or search "Transporter" in App Store

2. **Open Transporter**
   - Launch the Transporter app
   - Sign in with your Apple ID (the one associated with your Developer account)

3. **Upload Package**
   - Click the "+" button or drag and drop `DiskAnalyser.pkg`
   - Transporter will validate the package automatically
   - Click "Deliver" to upload
   - Wait for upload to complete (progress bar will show status)

4. **Verify Upload**
   - Once complete, you'll see a success message
   - Go to App Store Connect to see your build (may take 5-10 minutes to process)

### Step 4: Alternative - Upload via Command Line

If you prefer command-line tools:

```bash
# First, create an app-specific password at:
# https://appleid.apple.com/account/manage

# Store password in keychain (one-time setup)
xcrun altool --store-password-in-keychain-item "AC_PASSWORD" \
  --username "YOUR_APPLE_ID" \
  --password "YOUR_APP_SPECIFIC_PASSWORD"

# Validate package (optional but recommended)
xcrun altool --validate-app \
  --file DiskAnalyser.pkg \
  --type macos \
  --username "YOUR_APPLE_ID" \
  --password "@keychain:AC_PASSWORD"

# Upload package
xcrun altool --upload-app \
  --file DiskAnalyser.pkg \
  --type macos \
  --username "YOUR_APPLE_ID" \
  --password "@keychain:AC_PASSWORD"
```

**Note**: `altool` is deprecated. Apple recommends using Transporter or `notarytool` for future submissions.

## App Store Connect Checklist

### App Information
- [ ] App name: "Disk Analyser"
- [ ] Subtitle (optional)
- [ ] Category: Utilities
- [ ] Privacy Policy URL (required)
- [ ] Support URL (required)

### Version Information
- [ ] Screenshots (required - 1280x800 minimum)
  - At least 3 screenshots showing main features
- [ ] App description
- [ ] Keywords
- [ ] What's New in This Version

### Pricing
- [ ] Set pricing tier (can be free or paid)
- [ ] Select territories

### App Review Information
- [ ] Contact information
- [ ] Demo account (if app requires login)
- [ ] Notes for reviewer explaining:
  - How to use the app
  - That users need to select folders to scan (due to sandbox)

### Privacy
- [ ] Complete privacy questionnaire
- [ ] Declare data collection practices

## Testing Before Submission

### Test Sandboxed Build Locally

```bash
# Build and run with MAS entitlements
bun run tauri build -- --target aarch64-apple-darwin
open "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Disk Analyser.app"
```

Verify:
- [ ] App launches successfully
- [ ] File picker works for selecting folders
- [ ] Scanning works on selected folders
- [ ] No crashes or permission errors
- [ ] UI displays correctly

## Common Rejection Reasons

1. **Missing entitlements** - Ensure `entitlements.mas.plist` is used
2. **Sandbox violations** - App tries to access files outside sandbox
3. **Missing privacy policy** - Required for all apps
4. **Poor screenshots** - Must show actual app functionality
5. **Incomplete metadata** - All required fields must be filled
6. **Crashes** - Test thoroughly before submission

## Post-Submission

- Review typically takes 1-3 days
- Monitor status in App Store Connect
- Respond promptly to any rejection feedback
- Once approved, app goes live automatically (or on scheduled date)

## Useful Resources

- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Tauri macOS Signing Guide](https://tauri.app/distribute/sign/macos/)
- [App Sandbox Documentation](https://developer.apple.com/documentation/security/app_sandbox)
- [App Store Connect Help](https://help.apple.com/app-store-connect/)

## Entitlements Management

The project maintains three entitlements files:

- **`entitlements.plist`** - Active entitlements (switches between MAS and direct)
- **`entitlements.mas.plist`** - Mac App Store (sandboxed, user-selected files only)
- **`entitlements.direct.plist`** - Direct distribution (full disk access)

Use `./scripts/switch_entitlements.sh` to switch between modes:

```bash
# Switch to Mac App Store mode
./scripts/switch_entitlements.sh mas

# Switch to Direct Distribution mode
./scripts/switch_entitlements.sh direct

# Show current mode
./scripts/switch_entitlements.sh
```

## Distribution Strategy

Consider maintaining two distribution channels:

1. **Mac App Store** (sandboxed)
   - Easier for users to discover and install
   - Automatic updates via App Store
   - Users select folders to scan via file picker
   - More restrictive but App Store compliant

2. **Direct Download** (full access)
   - Available on your website
   - Full disk access capability
   - Users grant "Full Disk Access" in System Settings
   - More powerful for advanced users

## Helper Scripts Summary

All scripts are located in the `scripts/` directory. See [scripts/README.md](scripts/README.md) for detailed documentation.

- **`bump_version.sh`** - Bump version across all config files
- **`switch_entitlements.sh`** - Switch between MAS and direct entitlements
- **`build_for_mas.sh`** - Automated MAS build for Apple Silicon (switches entitlements, builds, signs, packages)
- **`build_universal.sh`** - Build universal binary (Intel + Apple Silicon) for direct distribution
- **`sign_for_mas.sh`** - Sign app for Mac App Store
- **`create_mas_package.sh`** - Create installer package for upload
- **`cleanup.sh`** - Clean up build artifacts and temporary files

## Architecture Support

By default, all scripts build for **Apple Silicon only** (aarch64-apple-darwin). This is the recommended approach for new Mac App Store submissions as Apple Silicon is now the primary Mac platform.

If you need to support Intel Macs:
- Use `./scripts/build_universal.sh` for direct distribution
- For Mac App Store, you can submit separate builds or use universal binary (requires additional setup)
