#!/bin/bash

# Conductor - Automated Testing Script
# Usage: bash test-conductor.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
SKIPPED=0

# Test function
test_feature() {
    local name="$1"
    local command="$2"
    local expected="$3"
    
    echo -n "Testing: $name ... "
    
    if result=$(eval "$command" 2>&1); then
        if [[ -z "$expected" ]] || [[ "$result" == *"$expected"* ]]; then
            echo -e "${GREEN}✅ PASS${NC}"
            ((PASSED++))
            return 0
        else
            echo -e "${RED}❌ FAIL${NC}"
            echo "  Expected: $expected"
            echo "  Got: $result"
            ((FAILED++))
            return 1
        fi
    else
        echo -e "${RED}❌ ERROR${NC}"
        echo "  $result"
        ((FAILED++))
        return 1
    fi
}

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Conductor - Testing Suite              ║${NC}"
echo -e "${BLUE}║  $(date '+%Y-%m-%d %H:%M:%S')             ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# 1. Infrastructure Tests
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}1️⃣  INFRASTRUCTURE TESTS${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

test_feature "AI Server Health" \
    "curl -s http://127.0.0.1:8080/health" \
    "connectedWsClients"

test_feature "Control Panel Running" \
    "curl -s http://127.0.0.1:5173 | head -1" \
    "DOCTYPE|html"

test_feature "Get Config Endpoint" \
    "curl -s http://127.0.0.1:8080/api/config | jq '.providerMode'" \
    ""

echo ""

# 2. Ollama Tests
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}2️⃣  OLLAMA TESTS${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

test_feature "Ollama Service Running" \
    "curl -s http://127.0.0.1:11434/api/tags" \
    "models"

test_feature "Ollama Models Available" \
    "curl -s http://127.0.0.1:11434/api/tags | jq '.models | length'" \
    ""

echo ""

# 3. Claude Tests
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}3️⃣  CLAUDE CODE CLI TESTS${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

test_feature "Claude Binary Found" \
    "which claude || echo 'not found'" \
    "claude"

test_feature "Claude Authenticated" \
    "claude auth status | jq '.loggedIn'" \
    "true"

test_feature "Claude Version" \
    "claude --version" \
    ""

echo ""

# 4. Environment Tests
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}4️⃣  ENVIRONMENT TESTS${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

test_feature "Node.js Version 20" \
    "node --version | grep -o 'v20'" \
    "v20"

test_feature "pnpm Installed" \
    "pnpm --version | head -1" \
    ""

test_feature "Git Repository" \
    "cd /home/usuario/models/ai-core && git remote -v | head -1" \
    "origin"

echo ""

# 5. File System Tests
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}5️⃣  FILE SYSTEM TESTS${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

test_feature ".gitignore Exists" \
    "test -f /home/usuario/models/ai-core/.gitignore && echo 'yes'" \
    "yes"

test_feature "README.md Exists" \
    "test -f /home/usuario/models/ai-core/README.md && echo 'yes'" \
    "yes"

test_feature "Config Directory" \
    "test -d /home/usuario/models/ai-core/apps/ai-server/.data && echo 'yes'" \
    "yes"

echo ""

# 6. Process Tests
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}6️⃣  PROCESS TESTS${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

test_feature "AI Server Process" \
    "ps aux | grep -E 'ai-server|node.*src/server' | grep -v grep | wc -l" \
    ""

test_feature "Vite Dev Server" \
    "ps aux | grep -E 'vite|control-panel' | grep -v grep | wc -l" \
    ""

echo ""

# Summary
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📊 TEST SUMMARY${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "✅ ${GREEN}Passed${NC}: $PASSED"
echo -e "❌ ${RED}Failed${NC}: $FAILED"
echo -e "⏭️  ${YELLOW}Skipped${NC}: $SKIPPED"

TOTAL=$((PASSED + FAILED + SKIPPED))
if [ $TOTAL -gt 0 ]; then
    PERCENT=$((PASSED * 100 / TOTAL))
    echo -e ""
    echo -e "Overall Success Rate: ${GREEN}${PERCENT}%${NC} ($PASSED/$TOTAL)"
else
    echo "No tests run"
fi

echo ""

# Exit with appropriate code
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed! 🎉${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed. Check above for details.${NC}"
    exit 1
fi
