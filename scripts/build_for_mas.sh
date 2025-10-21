#!/bin/bash
# Automated Mac App Store Build Script for Disk Analyser
# This script handles the complete MAS build process
# Usage: ./build_for_mas.sh

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Mac App Store Build Script for Disk Analyser        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if required scripts exist
REQUIRED_SCRIPTS=("switch_entitlements.sh" "sign_for_mas.sh" "create_mas_package.sh")
for script in "${REQUIRED_SCRIPTS[@]}"; do
    if [ ! -f "$SCRIPT_DIR/$script" ]; then
        echo -e "${RED}Error: Required script $script not found${NC}"
        exit 1
    fi
    chmod +x "$SCRIPT_DIR/$script"
done

# Step 1: Switch to MAS entitlements
echo -e "${YELLOW}[1/4]${NC} Switching to Mac App Store entitlements..."
"$SCRIPT_DIR/switch_entitlements.sh" mas
echo ""

# Step 2: Build Tauri app
echo -e "${YELLOW}[2/4]${NC} Building Tauri app for Apple Silicon..."
bun run tauri build -- --target aarch64-apple-darwin
echo ""

# Step 2.5: Add LSApplicationCategoryType to Info.plist
echo -e "${YELLOW}Adding LSApplicationCategoryType to Info.plist...${NC}"
APP_PATH="src-tauri/target/release/bundle/macos/Disk Analyser.app"
INFO_PLIST="$APP_PATH/Contents/Info.plist"

if [ -f "$INFO_PLIST" ]; then
    /usr/libexec/PlistBuddy -c "Add :LSApplicationCategoryType string public.app-category.utilities" "$INFO_PLIST" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Set :LSApplicationCategoryType public.app-category.utilities" "$INFO_PLIST"
    echo -e "${GREEN}✓ LSApplicationCategoryType added to Info.plist${NC}"
else
    echo -e "${RED}Error: Info.plist not found at $INFO_PLIST${NC}"
    echo -e "${YELLOW}Build may have failed or app bundle is in a different location${NC}"
    exit 1
fi
echo ""

# Step 3: Sign for Mac App Store
echo -e "${YELLOW}[3/4]${NC} Signing for Mac App Store..."
"$SCRIPT_DIR/sign_for_mas.sh"
echo ""

# Step 4: Create installer package
echo -e "${YELLOW}[4/4]${NC} Creating installer package..."
"$SCRIPT_DIR/create_mas_package.sh"
echo ""

# Switch back to direct distribution entitlements
echo -e "${YELLOW}Restoring direct distribution entitlements...${NC}"
"$SCRIPT_DIR/switch_entitlements.sh" direct
echo ""

# Clean up backup files
echo -e "${YELLOW}Cleaning up backup files...${NC}"
rm -f src-tauri/entitlements.plist.backup.*
echo -e "${GREEN}✓ Backup files removed${NC}"
echo ""

echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Build Complete! 🎉                        ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Package ready: ${GREEN}DiskAnalyser.pkg${NC}"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Next Step: Upload to App Store Connect${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "1. Open Transporter app"
echo "   Download: https://apps.apple.com/app/transporter/id1450874784"
echo ""
echo "2. Sign in with your Apple ID"
echo ""
echo "3. Drag and drop: DiskAnalyser.pkg"
echo ""
echo "4. Click 'Deliver' to upload"
echo ""
echo "5. Monitor status in App Store Connect"
echo "   https://appstoreconnect.apple.com"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
