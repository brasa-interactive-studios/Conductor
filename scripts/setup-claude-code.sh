#!/usr/bin/env bash
set -euo pipefail

if command -v claude >/dev/null 2>&1; then
  echo "[claude-setup] Claude Code already installed: $(claude --version)"
else
  echo "[claude-setup] Installing Claude Code (Linux/macOS)..."
  curl -fsSL https://claude.ai/install.sh | bash
fi

echo "[claude-setup] Verifying installation..."
claude --version

echo ""
echo "[claude-setup] Next step (interactive):"
echo "  claude auth login --console"
echo ""
echo "After login, ai-server cloud route will auto-use Claude Code CLI."
