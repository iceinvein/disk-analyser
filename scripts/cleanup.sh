#!/bin/bash
# Cleanup script for Disk Analyser
# Removes build artifacts and backup files
# Usage: ./cleanup.sh

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Disk Analyser Cleanup Script        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Remove entitlements backups
if ls src-tauri/entitlements.plist.backup.* 1> /dev/null 2>&1; then
    echo -e "${YELLOW}Removing entitlements backup files...${NC}"
    rm -f src-tauri/entitlements.plist.backup.*
    echo -e "${GREEN}✓ Entitlements backups removed${NC}"
else
    echo -e "${GREEN}✓ No entitlements backups to remove${NC}"
fi

# Remove .pkg files
if ls *.pkg 1> /dev/null 2>&1; then
    echo -e "${YELLOW}Removing .pkg files...${NC}"
    rm -f *.pkg
    echo -e "${GREEN}✓ Package files removed${NC}"
else
    echo -e "${GREEN}✓ No package files to remove${NC}"
fi

# Remove build artifacts
if [ -d "src-tauri/target" ]; then
    echo -e "${YELLOW}Removing build artifacts...${NC}"
    read -p "Remove src-tauri/target directory? This will require a full rebuild. (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf src-tauri/target
        echo -e "${GREEN}✓ Build artifacts removed${NC}"
    else
        echo -e "${YELLOW}Skipped build artifacts${NC}"
    fi
else
    echo -e "${GREEN}✓ No build artifacts to remove${NC}"
fi

# Remove frontend build
if [ -d "dist" ]; then
    echo -e "${YELLOW}Removing frontend build...${NC}"
    rm -rf dist
    echo -e "${GREEN}✓ Frontend build removed${NC}"
else
    echo -e "${GREEN}✓ No frontend build to remove${NC}"
fi

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         Cleanup Complete! 🎉           ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
