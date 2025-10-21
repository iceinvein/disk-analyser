#!/bin/bash
# Version Bump and Build Script for Disk Analyser
# Usage: ./bump_version.sh [major|minor|patch]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default to patch if no argument provided
BUMP_TYPE=${1:-patch}

# Validate bump type
if [[ ! "$BUMP_TYPE" =~ ^(major|minor|patch)$ ]]; then
    echo -e "${RED}Error: Invalid bump type. Use 'major', 'minor', or 'patch'${NC}"
    exit 1
fi

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Disk Analyser Version Bump Script   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Get current version from package.json
CURRENT_VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
echo -e "Current version: ${YELLOW}${CURRENT_VERSION}${NC}"

# Calculate new version
IFS='.' read -r -a VERSION_PARTS <<< "$CURRENT_VERSION"
MAJOR="${VERSION_PARTS[0]}"
MINOR="${VERSION_PARTS[1]}"
PATCH="${VERSION_PARTS[2]}"

case $BUMP_TYPE in
    major)
        MAJOR=$((MAJOR + 1))
        MINOR=0
        PATCH=0
        ;;
    minor)
        MINOR=$((MINOR + 1))
        PATCH=0
        ;;
    patch)
        PATCH=$((PATCH + 1))
        ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
echo -e "New version:     ${GREEN}${NEW_VERSION}${NC}"
echo ""

# Update package.json
echo -e "${YELLOW}[1/3]${NC} Updating package.json..."
sed -i '' "s/\"version\": \".*\"/\"version\": \"${NEW_VERSION}\"/" package.json

# Update src-tauri/Cargo.toml
echo -e "${YELLOW}[2/3]${NC} Updating src-tauri/Cargo.toml..."
sed -i '' "s/^version = \".*\"/version = \"${NEW_VERSION}\"/" src-tauri/Cargo.toml

# Update src-tauri/tauri.conf.json
echo -e "${YELLOW}[3/3]${NC} Updating src-tauri/tauri.conf.json..."
sed -i '' "s/\"version\": \".*\"/\"version\": \"${NEW_VERSION}\"/" src-tauri/tauri.conf.json

# Update Cargo.lock
echo -e "${YELLOW}Updating Cargo.lock...${NC}"
cd src-tauri && cargo update -p disk-analyser && cd ..

echo ""
echo -e "${GREEN}✓ Version bumped to ${NEW_VERSION}${NC}"
echo ""

# Ask if user wants to build
echo ""
echo "Build options:"
echo "  1) Skip build"
echo "  2) Build for direct distribution (Apple Silicon)"
echo "  3) Build for Mac App Store (Apple Silicon)"
echo "  4) Build universal binary (Intel + Apple Silicon)"
echo ""
read -p "Select build option (1-4): " -n 1 -r
echo
echo

case $REPLY in
    2)
        echo -e "${BLUE}Building for direct distribution (Apple Silicon)...${NC}"
        bun run build
        bun run tauri build -- --target aarch64-apple-darwin
        echo -e "\n${GREEN}✓ Build complete!${NC}"
        echo -e "${YELLOW}Build output: src-tauri/target/aarch64-apple-darwin/release/bundle/${NC}"
        ;;
    3)
        echo -e "${BLUE}Building for Mac App Store...${NC}"
        SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        if [ -f "$SCRIPT_DIR/build_for_mas.sh" ]; then
            "$SCRIPT_DIR/build_for_mas.sh"
        else
            echo -e "${RED}Error: build_for_mas.sh not found${NC}"
            echo "Building manually..."
            bun run build
            bun run tauri build -- --target aarch64-apple-darwin
        fi
        ;;
    4)
        echo -e "${BLUE}Building universal binary...${NC}"
        SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        if [ -f "$SCRIPT_DIR/build_universal.sh" ]; then
            "$SCRIPT_DIR/build_universal.sh"
        else
            echo -e "${RED}Error: build_universal.sh not found${NC}"
            echo "Install targets and build manually:"
            echo "  rustup target add aarch64-apple-darwin x86_64-apple-darwin"
        fi
        ;;
    1|*)
        echo -e "${YELLOW}Skipping build${NC}"
        ;;
esac

# Ask if user wants to commit
echo ""
read -p "Do you want to commit the version bump? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock
    git commit -m "chore: bump version to ${NEW_VERSION}"
    echo -e "${GREEN}✓ Changes committed!${NC}"
    
    read -p "Do you want to create a git tag? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"
        echo -e "${GREEN}✓ Tag v${NEW_VERSION} created!${NC}"
        echo -e "${YELLOW}Don't forget to push: git push && git push --tags${NC}"
    fi
fi

echo ""
echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║            All Done! 🎉                ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Version: ${GREEN}${NEW_VERSION}${NC}"

if [[ $REPLY == "3" ]] && [ -f "DiskAnalyser.pkg" ]; then
    echo ""
    echo -e "${YELLOW}Next step: Upload DiskAnalyser.pkg to App Store Connect${NC}"
    echo "Use Transporter app or run: open -a Transporter DiskAnalyser.pkg"
fi
