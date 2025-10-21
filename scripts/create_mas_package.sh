#!/bin/bash
# Create Mac App Store Package for Disk Analyser
# Usage: ./create_mas_package.sh

set -e

APP_NAME="Disk Analyser"
APP_PATH="src-tauri/target/release/bundle/macos/${APP_NAME}.app"
PKG_NAME="DiskAnalyser.pkg"

# Replace with your actual installer certificate identity
# For Mac App Store, use "3rd Party Mac Developer Installer"
INSTALLER_IDENTITY="3rd Party Mac Developer Installer: Dik Rana (UT6J7B9B3Z)"

echo "📦 Creating Mac App Store package for Disk Analyser..."
echo ""

# Check if signed app exists
if [ ! -d "$APP_PATH" ]; then
    echo "❌ Error: App not found at $APP_PATH"
    echo "Run './sign_for_mas.sh' first"
    exit 1
fi

# Verify app is signed
echo "🔍 Verifying app signature..."
if ! codesign --verify --deep --strict "$APP_PATH" 2>/dev/null; then
    echo "❌ Error: App is not properly signed"
    echo "Run './sign_for_mas.sh' first"
    exit 1
fi

echo "  ✓ App signature is valid"

# Check for provisioning profile
if [ ! -f "$APP_PATH/Contents/embedded.provisionprofile" ]; then
    echo "⚠️  Warning: No provisioning profile found in app bundle"
    echo "This is required for Mac App Store submission"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Create package
echo ""
echo "📦 Building installer package..."
productbuild --component "$APP_PATH" /Applications \
    --sign "$INSTALLER_IDENTITY" \
    "$PKG_NAME"

# Verify package
echo ""
echo "✅ Verifying package signature..."
pkgutil --check-signature "$PKG_NAME"

# Get package info
echo ""
echo "📋 Package information:"
PKG_SIZE=$(du -h "$PKG_NAME" | cut -f1)
echo "  File: $PKG_NAME"
echo "  Size: $PKG_SIZE"

echo ""
echo "✅ Package created successfully!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Next steps:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Option 1: Upload via Transporter (Recommended)"
echo "  1. Open Transporter app"
echo "  2. Sign in with your Apple ID"
echo "  3. Drag and drop $PKG_NAME"
echo "  4. Click 'Deliver'"
echo ""
echo "Option 2: Upload via command line"
echo "  xcrun altool --upload-app --type macos --file $PKG_NAME \\"
echo "    --username YOUR_APPLE_ID --password @keychain:AC_PASSWORD"
echo ""
echo "Option 3: Validate before uploading"
echo "  xcrun altool --validate-app --type macos --file $PKG_NAME \\"
echo "    --username YOUR_APPLE_ID --password @keychain:AC_PASSWORD"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "💡 Tip: Create an app-specific password at:"
echo "   https://appleid.apple.com/account/manage"
echo ""
echo "   Then store it in keychain:"
echo "   xcrun altool --store-password-in-keychain-item AC_PASSWORD \\"
echo "     --username YOUR_APPLE_ID --password YOUR_APP_SPECIFIC_PASSWORD"
