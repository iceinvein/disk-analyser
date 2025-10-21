#!/bin/bash
# Build Universal Binary for Disk Analyser (Intel + Apple Silicon)
# Usage: ./scripts/build_universal.sh

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Universal Binary Build for Disk Analyser            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${RED}Error: This script must run on macOS${NC}"
    exit 1
fi

# Install targets if not already installed
echo -e "${YELLOW}Checking Rust targets...${NC}"
rustup target add aarch64-apple-darwin
rustup target add x86_64-apple-darwin
echo ""

# Build frontend
echo -e "${YELLOW}[1/4]${NC} Building frontend..."
bun run build
echo ""

# Build for Apple Silicon (arm64)
echo -e "${YELLOW}[2/4]${NC} Building for Apple Silicon (arm64)..."
bun run tauri build -- --target aarch64-apple-darwin
echo ""

# Build for Intel (x86_64)
echo -e "${YELLOW}[3/4]${NC} Building for Intel (x86_64)..."
bun run tauri build -- --target x86_64-apple-darwin
echo ""

# Create universal binary
echo -e "${YELLOW}[4/4]${NC} Creating universal binary..."

APP_NAME="Disk Analyser"
ARM64_APP="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/${APP_NAME}.app"
X86_64_APP="src-tauri/target/x86_64-apple-darwin/release/bundle/macos/${APP_NAME}.app"
UNIVERSAL_APP="src-tauri/target/universal-apple-darwin/release/bundle/macos/${APP_NAME}.app"

# Create universal directory
mkdir -p "src-tauri/target/universal-apple-darwin/release/bundle/macos"

# Copy arm64 app as base
cp -R "$ARM64_APP" "$UNIVERSAL_APP"

# Create universal binary with lipo
ARM64_BIN="$ARM64_APP/Contents/MacOS/disk-analyser"
X86_64_BIN="$X86_64_APP/Contents/MacOS/disk-analyser"
UNIVERSAL_BIN="$UNIVERSAL_APP/Contents/MacOS/disk-analyser"

lipo -create "$ARM64_BIN" "$X86_64_BIN" -output "$UNIVERSAL_BIN"

# Verify universal binary
echo ""
echo -e "${GREEN}✓ Universal binary created!${NC}"
echo ""
echo "Architectures:"
lipo -info "$UNIVERSAL_BIN"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Build Complete! 🎉                        ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Universal app location:"
echo -e "${BLUE}$UNIVERSAL_APP${NC}"
