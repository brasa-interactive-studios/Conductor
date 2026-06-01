# AI Core — Hybrid AI Engineering Platform

Local-first modular AI system for VSCodium/VSCode with server orchestration, web control panel, and integrated Claude Code CLI support.

## What is now included

- Existing AI core modules (context, prompt, routing, generation, provider abstraction)
- New **monorepo scaffolding** with pnpm + turborepo
- New **ai-server** (Fastify + WebSocket) for centralized config and streaming updates
- New **control-panel** (React + Tailwind + Vite) for live visibility into shared/common config
- New **vscode-extension** lightweight bridge for editor sync + streamed chat over WebSocket
- New **shared package** for strongly typed cross-app contracts and defaults

## Monorepo Layout

```text
apps/
  ai-server/
  control-panel/
  vscode-extension/          # scaffold placeholder

packages/
  shared/
  core/                      # transition placeholder
  sdk/                       # scaffold placeholder

src/                         # current core runtime (pre-extraction)
```

## New Components

### 1) AI Server (`apps/ai-server`)

Responsibilities currently implemented:

- `GET /health` basic service health and websocket client count
- `GET /api/config` retrieve common orchestration config
- `PATCH /api/config` patch and persist config
- `GET /api/repositories` list repository registry
- `POST /api/repositories` create/update repository entries
- `GET /ws/config` websocket stream for config snapshots/updates + telemetry pulses
- `GET /ws/extension` websocket endpoint for VSCode extension messages (`editor.sync`, `chat.request`, `chat.cancel`)
- `GET /api/prompt-traces` prompt trace records for observability/prompt inspection

Persistence:

- Config is stored in `apps/ai-server/.data/common-config.json`

### 2) Control Panel (`apps/control-panel`)

Web UI features currently implemented:

- Live connection status
- Local/cloud model overview
- Repository registry panel
- Routing diagnostics panel
- Live telemetry pulse panel
- Prompt trace panel (recent routes, model, latency, token estimates)
- Full JSON config inspection panel

### 3) Shared Package (`packages/shared`)

Provides typed contracts used by both server and frontend:

- `CommonConfig`
- `RepositoryWorkspace`
- `createDefaultConfig()`
- `mergeCommonConfig()`

## Core AI Runtime (existing)

Current runtime remains in `src/` and is already unit-tested.

Main modules:

- Context engine
- Prompt builder
- Ollama provider
- Model router
- Generation engine
- Diff applier
- Side chat controller

## Tech Stack

- TypeScript
- Node.js 20+
- Fastify + WebSocket
- React + Vite + Tailwind
- pnpm workspaces + Turborepo
- Ollama local inference (primary local model: `qwen2.5-coder:14b`)

## Setup

### Prerequisites

- **Node.js 20+** (via nvm recommended)
- **Ollama** (for local models, optional for cloud-only mode)
- **Claude Code CLI** (for cloud Claude route, optional for local-only mode)
- **pnpm 9+** (Node package manager)

### 1) Node 20 via nvm

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 20
```

### 2) Install dependencies

```bash
pnpm install
```

### 3) Claude Code CLI setup (optional, for cloud Claude route)

If you want to use Claude Code as a cloud backend:

```bash
pnpm setup:claude
```

This will:
- Install Claude Code CLI to `~/.local/bin/claude`
- Prompt you to authenticate: `claude auth login --console`
- Auto-detect and export the binary path to ai-server

**Note:** Authentication code must be copied from the browser link and pasted into the terminal.

To check auth status anytime:

```bash
claude auth status
```

### 4) Start the full stack

Local server + web panel:

```bash
./start-all.sh
```

This will:
- Start `ai-server` on `http://127.0.0.1:8080/health`
- Start `control-panel` on `http://127.0.0.1:5173`
- Auto-detect Claude CLI binary and export `CLAUDE_CODE_BIN`

To stop:

```bash
./stop-all.sh
```

### 5) Integrate with VSCodium/VSCode Extension

The extension is located in `apps/vscode-extension/` and provides:

- Real-time editor sync (file, cursor, diagnostics)
- Chat participant for integrated AI requests
- Sidebar commands for server control and Claude auth
- Automatic Claude auth recovery on errors

#### For VSCodium:

1. **Build the extension:**

```bash
pnpm --filter @apps/vscode-extension build
```

2. **Install in VSCodium:**

```bash
cp -r apps/vscode-extension ~/.config/VSCodium/extensions/ai-platform-extension
# or symlink for development:
ln -s $(pwd)/apps/vscode-extension ~/.config/VSCodium/extensions/ai-platform-extension
```

3. **Enable extension in VSCodium:**

Open VSCodium, go to Extensions sidebar → Install from VSIX → select `apps/vscode-extension/dist/` or reload if symlinked.

#### For VSCode:

```bash
# Package as VSIX
pnpm --filter @apps/vscode-extension build
# Then drag .vsix file into VSCode Extensions sidebar, or:
code --install-extension apps/vscode-extension/*.vsix
```

### 6) Use the extension (sidebar commands)

Open the **AI Platform** sidebar (left activity bar):

- **Ask AI** — send prompt via chat participant
- **Connect Server** — manually connect to WebSocket
- **Start Server** — run `./start-all.sh`
- **Stop Server** — run `./stop-all.sh`
- **Claude Auth Login** — open terminal for `claude auth login --console`
- **Claude Auth Status** — check current auth status
- **Set Provider Mode** — switch between `copilot-managed`, `local-ollama`, `hybrid`
- **Cancel Active Request** — abort current chat

### 7) Development workflow

Build all packages:

```bash
pnpm build:all
```

Type-check:

```bash
pnpm typecheck:all
```

Watch mode (local dev):

```bash
pnpm --filter @apps/ai-server dev
pnpm --filter @apps/control-panel dev
pnpm --filter @apps/vscode-extension dev
```

Run tests:

```bash
pnpm test:all
```



## Observability Direction

The platform now supports an inspectable control-plane baseline and is prepared for:

- Prompt trace persistence
- Token analytics dashboards
- Routing decision diagnostics
- Indexing/telemetry visibility
- Local/cloud orchestration transparency

## Current Status

- Core AI unit tests passing (21 tests)
- Server/control-panel scaffolding implemented
- Shared config contracts established
- VSCode extension and SDK packages scaffolded for next phase
- Claude Code CLI integration complete with hybrid routing
- VSCodium extension fully functional with sidebar commands
- Terminal-based auth flow with automatic error recovery

## Architecture

### Routing Modes

The system supports three provider routing modes:

1. **copilot-managed** — Use Claude Code CLI for all requests (default)
   - Requires: `claude` binary installed and authenticated
   - Fallback: Automatic local Ollama if Claude unavailable
   - Models: Configurable via `CLAUDE_CODE_MODEL` (default: `sonnet`)

2. **local-ollama** — Use local Ollama-only routing
   - Requires: Ollama service running
   - Models: `qwen2.5-coder:14b`, `llama2`, etc.
   - No cloud API keys needed

3. **hybrid** — Smart routing based on model capabilities
   - Attempts Claude Code first
   - Falls back to Ollama if Claude errors or unavailable
   - Best for development/testing with max coverage

### Component Communication

```
VSCodium/VSCode (Extension)
         ↓
    WebSocket (WS)
         ↓
   ai-server (Fastify)
   ├→ ws/extension (chat, editor sync)
   ├→ ws/config (config changes + telemetry)
   ├→ api/config (REST config access)
   └→ Model Router (Ollama or Claude)
         ↓
    Local Ollama OR Claude Code CLI
```

### Environment Variable Resolution

Claude Code CLI path is resolved in this order:

1. `CLAUDE_CODE_BIN` — explicit path (set by `start-all.sh`)
2. `command -v claude` — system PATH lookup
3. Fallback candidates:
   - `~/.local/bin/claude` (Linux pip install)
   - `/opt/homebrew/bin/claude` (macOS Homebrew)
   - `/usr/local/bin/claude` (manual install)

The `start-all.sh` script auto-detects and exports the path for child processes.

## Configuration

### Common Config (`apps/ai-server/.data/common-config.json`)

```json
{
  "providerMode": "hybrid",
  "defaultLocalModel": "qwen2.5-coder:14b",
  "claudeCodeModel": "sonnet",
  "claudeCodeTimeout": 30000,
  "repositories": []
}
```

### Extension Settings (`settings.json` in VSCodium)

```json
{
  "aiPlatform.serverUrl": "ws://127.0.0.1:8080/ws/extension",
  "aiPlatform.providerMode": "hybrid",
  "aiPlatform.claudeBinPath": "/home/usuario/.local/bin/claude"
}
```

### Environment Variables

- `CLAUDE_CODE_BIN` — Path to Claude CLI executable
- `CLAUDE_CODE_MODEL` — Model name (sonnet, opus, haiku)
- `CLAUDE_CODE_DEFAULT_MODEL` — Fallback if not set
- `CLAUDE_CODE_TIMEOUT_MS` — Request timeout in milliseconds

Example:

```bash
export CLAUDE_CODE_BIN="/home/usuario/.local/bin/claude"
export CLAUDE_CODE_MODEL="opus"
export CLAUDE_CODE_TIMEOUT_MS="60000"
```

## Troubleshooting

### Claude CLI: "Not logged in"

**Symptom:** Extension shows error "Claude: not logged in"

**Solution:**

1. Open the AI Platform sidebar in the extension
2. Click **Claude Auth Login** (opens terminal)
3. Run the suggested auth command:
   ```bash
   claude auth login --console
   ```
4. Copy the browser link and paste it into the terminal
5. Complete the auth flow, then retry your chat request

**Alternative:** Manual auth in system terminal:

```bash
claude auth login --console
```

### Claude CLI: "Command not found"

**Symptom:** "claude: command not found" or "Cannot find Claude executable"

**Solution:**

1. Install Claude Code CLI:
   ```bash
   pnpm setup:claude
   ```

2. Verify installation:
   ```bash
   which claude
   ```

3. If not found, manually install:
   ```bash
   pip install claude-code
   # then verify:
   claude --version
   ```

4. Export the binary path manually:
   ```bash
   export CLAUDE_CODE_BIN=$(which claude)
   ```

### Server won't start

**Symptom:** `./start-all.sh` fails or port 8080 already in use

**Solution:**

```bash
# Kill existing process on port 8080
lsof -i :8080 | grep LISTEN | awk '{print $2}' | xargs kill -9

# Or explicitly stop:
./stop-all.sh

# Then restart:
./start-all.sh
```

### Extension won't connect

**Symptom:** "Failed to connect to server" message in sidebar

**Solution:**

1. Verify server is running:
   ```bash
   curl -s http://127.0.0.1:8080/health | jq .
   ```

2. Check extension settings (`Ctrl+,` → search "AI Platform"):
   - `serverUrl` should be `ws://127.0.0.1:8080/ws/extension`
   - `serverUrl` must be `ws://` or `wss://` (WebSocket)

3. Click **Connect Server** in sidebar to retry

4. Check browser console (F12 in extension dev tools) for WebSocket errors

### Slow Claude responses

**Symptom:** Chat takes >30 seconds or times out

**Solution:**

1. Increase timeout:
   ```bash
   export CLAUDE_CODE_TIMEOUT_MS="60000"
   ./stop-all.sh && ./start-all.sh
   ```

2. Check model:
   ```bash
   export CLAUDE_CODE_MODEL="haiku"  # faster, less capable
   ```

3. Check Claude CLI directly:
   ```bash
   echo "test prompt" | claude -p --model sonnet
   ```

### Local Ollama not responding

**Symptom:** "Ollama service unreachable" when using local-ollama mode

**Solution:**

1. Start Ollama:
   ```bash
   ollama serve
   ```

2. In another terminal, pull a model:
   ```bash
   ollama pull qwen2.5-coder:14b
   ```

3. Switch to local mode in extension:
   - Sidebar → **Set Provider Mode** → select `local-ollama`

4. Verify connection:
   ```bash
   curl -s http://127.0.0.1:11434/api/tags | jq .
   ```
