#!/bin/bash
# Switch between Mac App Store and Direct Distribution entitlements
# Usage: ./switch_entitlements.sh [mas|direct]

set -e

MODE=$1

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

ENTITLEMENTS_FILE="src-tauri/entitlements.plist"
MAS_ENTITLEMENTS="src-tauri/entitlements.mas.plist"
DIRECT_ENTITLEMENTS="src-tauri/entitlements.direct.plist"

# Show usage if no argument
if [ -z "$MODE" ]; then
    echo -e "${BLUE}Usage: ./switch_entitlements.sh [mas|direct]${NC}"
    echo ""
    echo "Modes:"
    echo "  mas    - Switch to Mac App Store entitlements (sandboxed)"
    echo "  direct - Switch to Direct Distribution entitlements (full disk access)"
    echo ""
    
    # Show current mode
    if [ -f "$ENTITLEMENTS_FILE" ]; then
        if grep -q "com.apple.security.app-sandbox.*true" "$ENTITLEMENTS_FILE"; then
            echo -e "Current mode: ${GREEN}Mac App Store (sandboxed)${NC}"
        else
            echo -e "Current mode: ${GREEN}Direct Distribution (full access)${NC}"
        fi
    fi
    exit 0
fi

# Validate mode
if [[ ! "$MODE" =~ ^(mas|direct)$ ]]; then
    echo -e "${RED}Error: Invalid mode. Use 'mas' or 'direct'${NC}"
    exit 1
fi

# Check if source files exist
if [ ! -f "$MAS_ENTITLEMENTS" ]; then
    echo -e "${RED}Error: $MAS_ENTITLEMENTS not found${NC}"
    exit 1
fi

if [ ! -f "$DIRECT_ENTITLEMENTS" ]; then
    echo -e "${YELLOW}Warning: $DIRECT_ENTITLEMENTS not found${NC}"
    echo "Creating from current entitlements.plist..."
    if [ -f "$ENTITLEMENTS_FILE" ]; then
        cp "$ENTITLEMENTS_FILE" "$DIRECT_ENTITLEMENTS"
        echo -e "${GREEN}✓ Created $DIRECT_ENTITLEMENTS${NC}"
    else
        echo -e "${RED}Error: No entitlements files found${NC}"
        exit 1
    fi
fi

# Backup current entitlements (only if switching, not if already in correct mode)
if [ -f "$ENTITLEMENTS_FILE" ]; then
    # Check if we're already in the target mode
    ALREADY_IN_MODE=false
    if [ "$MODE" = "mas" ] && grep -q "com.apple.security.app-sandbox.*true" "$ENTITLEMENTS_FILE"; then
        ALREADY_IN_MODE=true
    elif [ "$MODE" = "direct" ] && grep -q "com.apple.security.app-sandbox.*false" "$ENTITLEMENTS_FILE"; then
        ALREADY_IN_MODE=true
    fi
    
    if [ "$ALREADY_IN_MODE" = true ]; then
        echo -e "${GREEN}Already in $MODE mode, no changes needed${NC}"
        exit 0
    fi
    
    BACKUP_FILE="${ENTITLEMENTS_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$ENTITLEMENTS_FILE" "$BACKUP_FILE"
    echo -e "${YELLOW}Backed up current entitlements to: $(basename $BACKUP_FILE)${NC}"
fi

# Switch entitlements
case $MODE in
    mas)
        cp "$MAS_ENTITLEMENTS" "$ENTITLEMENTS_FILE"
        echo -e "${GREEN}✓ Switched to Mac App Store entitlements${NC}"
        echo ""
        echo "App Sandbox: ENABLED"
        echo "File Access: User-selected files only"
        echo "Distribution: Mac App Store"
        ;;
    direct)
        cp "$DIRECT_ENTITLEMENTS" "$ENTITLEMENTS_FILE"
        echo -e "${GREEN}✓ Switched to Direct Distribution entitlements${NC}"
        echo ""
        echo "App Sandbox: DISABLED"
        echo "File Access: Full disk access (with user permission)"
        echo "Distribution: Direct download / Outside App Store"
        ;;
esac

echo ""
echo -e "${BLUE}Next steps:${NC}"
if [ "$MODE" = "mas" ]; then
    echo "  1. Build: bun run tauri build"
    echo "  2. Sign: ./sign_for_mas.sh"
    echo "  3. Package: ./create_mas_package.sh"
    echo "  4. Upload via Transporter app"
    echo ""
    echo "Or use automated script: ./build_for_mas.sh"
else
    echo "  1. Build: bun run tauri build"
    echo "  2. Distribute directly to users"
fi
