# Conductor - Feature Testing Checklist

**Last Updated:** June 1, 2026  
**Overall Status:** 35% Working

---

## 🔧 Core Infrastructure

### Server Setup
- [ ] **AI Server starts** — `./start-all.sh` launches without errors
- [ ] **Control Panel starts** — React UI loads on port 5173
- [ ] **WebSocket connection** — Extension connects to ws://127.0.0.1:8080/ws/extension
- [ ] **Health endpoint** — `GET /health` returns JSON with client count

### Configuration
- [ ] **Config persistence** — Changes saved to `.data/common-config.json`
- [ ] **Config API** — `GET /api/config` and `PATCH /api/config` work
- [ ] **Provider mode switching** — Can switch between `copilot-managed`, `local-ollama`, `hybrid`

---

## 🤖 AI Features

### Local Ollama Route
- [ ] **Ollama detection** — Server detects running Ollama service
- [ ] **Model listing** — Can list available Ollama models
- [ ] **Local inference** — Can send prompt to Ollama and get response
- [ ] **Qwen model** — `qwen2.5-coder:14b` works for coding tasks
- [ ] **Fallback models** — Can use llama2 or other alternatives

### Claude Code CLI Route
- [ ] **Claude binary detection** — Server finds Claude CLI executable
- [ ] **Auth check** — `claude auth status` returns logged-in
- [ ] **Claude inference** — Can send prompt to Claude Code CLI
- [ ] **Model selection** — Can use `sonnet`, `opus`, `haiku` models
- [ ] **Timeout handling** — Long requests timeout gracefully

### Hybrid Routing
- [ ] **Smart fallback** — Switches to Ollama if Claude fails
- [ ] **Error recovery** — Auto-retries with different model on error
- [ ] **Mode override** — Can force local or cloud even in hybrid mode

---

## 🧠 Context & Reasoning

### Context Engine
- [ ] **File indexing** — Reads and indexes workspace files
- [ ] **Semantic search** — Finds relevant code snippets by meaning
- [ ] **Diff tracking** — Tracks changes and maintains diff history
- [ ] **Token estimation** — Accurately estimates context token count

### Prompt Building
- [ ] **Context injection** — Includes relevant code in prompt
- [ ] **Tool descriptions** — Formats tool/API descriptions for models
- [ ] **System message** — Includes appropriate system prompt based on task
- [ ] **Token limiting** — Respects max token limits per model

---

## 🔌 VS Code Extension

### Connection & UI
- [ ] **Extension loads** — VSCodium/VSCode recognizes extension
- [ ] **Sidebar appears** — AI Platform tree view shows in activity bar
- [ ] **Chat participant** — Can use `@ai-platform` in chat
- [ ] **Icons load** — Sidebar buttons display correctly

### Sidebar Commands
- [ ] **Ask AI** — Opens chat interface
- [ ] **Connect Server** — Manually connects to WebSocket
- [ ] **Start Server** — Terminal command starts services
- [ ] **Stop Server** — Cleanly shuts down services
- [ ] **Claude Auth Login** — Opens terminal for auth flow
- [ ] **Claude Auth Status** — Shows current auth state
- [ ] **Set Provider Mode** — Can change routing mode
- [ ] **Cancel Active Request** — Stops current chat

### Chat Interface
- [ ] **Message sending** — Can type and send prompts
- [ ] **Response streaming** — Responses appear incrementally
- [ ] **Error display** — Shows meaningful error messages
- [ ] **Context awareness** — Uses current file context
- [ ] **Diagnostics display** — Shows code problems if needed

### Editor Integration
- [ ] **File sync** — Extension knows current file
- [ ] **Cursor position** — Knows cursor location
- [ ] **Diagnostics sync** — Knows errors/warnings
- [ ] **Selection context** — Can use selected code as context

---

## 💾 Persistence & Data

### Config Storage
- [ ] **Save config** — Settings persist across restarts
- [ ] **Load config** — Settings loaded on startup
- [ ] **Merge configs** — Multiple config sources merge correctly
- [ ] **Validation** — Invalid config rejected with error

### Prompt Traces
- [ ] **Record traces** — `GET /api/prompt-traces` returns history
- [ ] **Token counts** — Logs token usage per request
- [ ] **Latency tracking** — Records response times
- [ ] **Model selection** — Logs which model was used

### Repositories Registry
- [ ] **Add repo** — Can register new repository
- [ ] **List repos** — `GET /api/repositories` shows all
- [ ] **Update repo** — Can modify existing repo settings
- [ ] **Remove repo** — Can delete repo entry

---

## 📊 Control Panel UI

### Dashboard
- [ ] **Connection status** — Shows live server connection
- [ ] **Model overview** — Lists available local & cloud models
- [ ] **Config panel** — Can view and edit configuration
- [ ] **Routes panel** — Shows last used model routes

### Monitoring
- [ ] **Live telemetry** — Receives config change pulses
- [ ] **Client count** — Shows connected extension count
- [ ] **Error display** — Shows any service errors
- [ ] **Logs panel** — Recent activity logs visible

---

## 🔐 Authentication & Security

### Claude Auth
- [ ] **Auth prompt** — Can trigger `claude auth login --console`
- [ ] **Auth detection** — Detects when user is authenticated
- [ ] **Error recovery** — Prompts to auth when 401 errors occur
- [ ] **Re-auth** — Can log in again without restarting

### SSH Keys
- [ ] **SSH agent** — SSH key properly configured for GitHub
- [ ] **Git push** — Can push changes without password
- [ ] **Multi-account** — Supports separate keys per GitHub account

---

## 🧪 Testing & Validation

### Build System
- [ ] **Typecheck** — `pnpm typecheck:all` passes
- [ ] **Build server** — `pnpm --filter @apps/ai-server build` succeeds
- [ ] **Build extension** — `pnpm --filter @apps/vscode-extension build` succeeds
- [ ] **Build panel** — `pnpm --filter @apps/control-panel build` succeeds

### Unit Tests
- [ ] **Core tests pass** — `pnpm test:all` succeeds
- [ ] **No errors** — Zero TypeScript errors in workspace
- [ ] **No warnings** — Build has no warnings

---

## 📝 Documentation

### README
- [ ] **Setup instructions** — Clear, follow-able steps
- [ ] **Troubleshooting** — Common issues covered
- [ ] **Architecture** — System design documented
- [ ] **Configuration** — All options explained

### Code Comments
- [ ] **Function docs** — Complex functions have JSDoc
- [ ] **Type definitions** — Types documented and clear
- [ ] **README files** — Each package has overview

---

## 🚀 Deployment Readiness

### Distribution
- [ ] **.gitignore** — Correct files excluded
- [ ] **LICENSE** — License file present
- [ ] **package.json** — All metadata correct
- [ ] **CI/CD** — GitHub Actions configured (if needed)

### Performance
- [ ] **Startup time** — Server starts < 5 seconds
- [ ] **Memory usage** — Reasonable memory footprint
- [ ] **Response time** — API calls respond < 500ms
- [ ] **WebSocket stability** — Long-lived connections stable

---

## Summary Table

| Category | Tested | Working | % Complete |
|----------|--------|---------|-----------|
| Infrastructure | ❓ | ❓ | ? |
| AI Routes | ❓ | ❓ | ? |
| Context | ❓ | ❓ | ? |
| Extension UI | ❓ | ❓ | ? |
| Chat | ❓ | ❓ | ? |
| Config | ❓ | ❓ | ? |
| Auth | ❓ | ❓ | ? |
| Docs | ❓ | ❓ | ? |
| **TOTAL** | | | **35%** |

---

## How to Use This Checklist

1. **Run each test** in the terminal and VSCodium
2. **Mark boxes** with:
   - ✅ = Working perfectly
   - ⚠️ = Partially working / has issues
   - ❌ = Not working / blocked
3. **Note issues** in a comment after each item
4. **Update % Complete** as you test

Example:
```
- ✅ AI Server starts — Fast, no errors
- ⚠️ Claude inference — Works but slow (~30s timeout)
- ❌ Claude Auth Login — Terminal not opening
```

---

## Quick Test Commands

```bash
# Server health
curl -s http://127.0.0.1:8080/health | jq .

# Get config
curl -s http://127.0.0.1:8080/api/config | jq .

# List Ollama models
curl -s http://127.0.0.1:11434/api/tags | jq .

# Check Claude CLI
which claude && claude auth status

# Check processes
ps aux | grep -E "node|pnpm" | grep -v grep

# Extension logs (in VSCodium console)
# Press F12 or Help → Toggle Developer Tools
```

