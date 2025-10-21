#!/bin/bash
# Mac App Store Signing Script for Disk Analyser
# Usage: ./sign_for_mas.sh

set -e

# Configuration
APP_NAME="Disk Analyser"
APP_PATH="src-tauri/target/release/bundle/macos/${APP_NAME}.app"
ENTITLEMENTS="src-tauri/entitlements.mas.plist"
CHILD_ENTITLEMENTS="src-tauri/entitlements.mas.inherit.plist"
PROVISIONING_PROFILE="Disk_Analyser.provisionprofile"

# You need to replace these with your actual certificate identities
# Find them with: security find-identity -v -p codesigning
# For Mac App Store, use "3rd Party Mac Developer" certificates
INSTALLER_IDENTITY="3rd Party Mac Developer Installer: Dik Rana (UT6J7B9B3Z)"
APP_IDENTITY="Apple Distribution: Dik Rana (UT6J7B9B3Z)"

echo "🔐 Signing ${APP_NAME} for Mac App Store..."
echo ""

# Check if app exists
if [ ! -d "$APP_PATH" ]; then
    echo "❌ Error: App not found at $APP_PATH"
    echo "Run 'bun run tauri build' first"
    exit 1
fi

# Check if entitlements exist
if [ ! -f "$ENTITLEMENTS" ]; then
    echo "❌ Error: Entitlements file not found at $ENTITLEMENTS"
    exit 1
fi

# Create child entitlements if it doesn't exist
if [ ! -f "$CHILD_ENTITLEMENTS" ]; then
    echo "📝 Creating child entitlements file..."
    cat > "$CHILD_ENTITLEMENTS" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <true/>
    <key>com.apple.security.inherit</key>
    <true/>
</dict>
</plist>
EOF
    echo "  ✓ Child entitlements created"
fi

# Sign frameworks and helpers first (inside-out signing)
echo ""
echo "📦 Signing frameworks and helpers..."

# Sign all frameworks
if [ -d "$APP_PATH/Contents/Frameworks" ]; then
    find "$APP_PATH/Contents/Frameworks" -type d -name "*.framework" -o -name "*.dylib" 2>/dev/null | while read framework; do
        echo "  Signing: $(basename "$framework")"
        codesign --force --sign "$APP_IDENTITY" \
            --entitlements "$CHILD_ENTITLEMENTS" \
            --timestamp \
            "$framework" 2>/dev/null || true
    done
else
    echo "  No frameworks found"
fi

# Sign XPC services if they exist
if [ -d "$APP_PATH/Contents/XPCServices" ]; then
    echo ""
    echo "🔌 Signing XPC services..."
    find "$APP_PATH/Contents/XPCServices" -type d -name "*.xpc" | while read xpc; do
        echo "  Signing XPC: $(basename "$xpc")"
        codesign --force --sign "$APP_IDENTITY" \
            --entitlements "$CHILD_ENTITLEMENTS" \
            --timestamp \
            "$xpc"
    done
fi

# Sign all helper executables in MacOS folder
echo ""
echo "🔧 Signing helper executables..."
if [ -d "$APP_PATH/Contents/MacOS" ]; then
    find "$APP_PATH/Contents/MacOS" -type f -perm +111 | while read executable; do
        # Skip the main app executable (we'll sign it separately)
        if [ "$(basename "$executable")" != "disk-analyser" ]; then
            helper_name=$(basename "$executable")
            echo "  Signing helper: $helper_name"
            codesign --force --sign "$APP_IDENTITY" \
                --entitlements "$CHILD_ENTITLEMENTS" \
                --identifier "com.dikrana.disk-analyser.$helper_name" \
                --timestamp \
                "$executable"
        fi
    done
else
    echo "  No helper executables found"
fi

# Embed provisioning profile
echo ""
echo "📄 Embedding provisioning profile..."
if [ -f "$PROVISIONING_PROFILE" ]; then
    cp "$PROVISIONING_PROFILE" "$APP_PATH/Contents/embedded.provisionprofile"
    echo "  ✓ Provisioning profile embedded"
else
    echo "  ⚠️  Warning: Provisioning profile not found at $PROVISIONING_PROFILE"
    echo "  Download it from https://developer.apple.com/account/resources/profiles/list"
    echo "  This is REQUIRED for Mac App Store submission"
fi

# Sign the main executable
echo ""
echo "🎯 Signing main application..."
codesign --force --sign "$APP_IDENTITY" \
    --entitlements "$ENTITLEMENTS" \
    --identifier "com.dikrana.disk-analyser" \
    --timestamp \
    "$APP_PATH"

# Verify signature
echo ""
echo "✅ Verifying signature..."
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

echo ""
echo "📋 Signature details:"
codesign -d -vvv --entitlements - "$APP_PATH" 2>&1 | grep -E "(Identifier|TeamIdentifier|Authority)"

echo ""
echo "✅ App signed successfully!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Next steps:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Create installer package:"
echo "   productbuild --component \"$APP_PATH\" /Applications \\"
echo "     --sign \"$INSTALLER_IDENTITY\" \\"
echo "     DiskAnalyser.pkg"
echo ""
echo "2. Verify package:"
echo "   pkgutil --check-signature DiskAnalyser.pkg"
echo ""
echo "3. Validate for App Store:"
echo "   xcrun altool --validate-app -f DiskAnalyser.pkg \\"
echo "     -t macos --username YOUR_APPLE_ID \\"
echo "     --password @keychain:AC_PASSWORD"
echo ""
echo "4. Upload to App Store Connect:"
echo "   - Use Transporter app (recommended), or"
echo "   - xcrun altool --upload-app -f DiskAnalyser.pkg \\"
echo "     -t macos --username YOUR_APPLE_ID \\"
echo "     --password @keychain:AC_PASSWORD"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
