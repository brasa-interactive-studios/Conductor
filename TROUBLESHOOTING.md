# Conductor - Troubleshooting & Setup Guide

**Current Status:** June 1, 2026  
**System:** Linux, VSCodium

---

## 🔴 Critical Issue: Claude Credit Balance

### Problem
```
$ echo "test" | claude -p --model sonnet
Credit balance is too low
```

### Why It Happens
Claude Code CLI requires API credits to run inference. Free trial has expired or credits exhausted.

### Solution - Choose One:

#### ✅ **Option A: Use Local Ollama (Recommended for development)**

1. **Ollama is already running:**
   ```bash
   ps aux | grep ollama  # Should show process
   ```

2. **Pull a model if needed:**
   ```bash
   ollama pull qwen2.5-coder:14b
   # OR
   ollama pull neural-chat
   ```

3. **Set Conductor to use local:**
   - Open VSCodium → AI Platform sidebar
   - Click "Set Provider Mode" → Select `local-ollama`
   - Start sending prompts (free, local, no API needed)

4. **Verify it works:**
   ```bash
   curl -s http://127.0.0.1:11434/api/tags | jq '.models[0].name'
   # Should show: qwen2.5-coder:14b or similar
   ```

#### ✅ **Option B: Use Hybrid Mode (Automatically handles both)**

1. **Set provider mode to `hybrid` (default)**
   - AI Platform sidebar → "Set Provider Mode" → `hybrid`
   - System will try Claude first, fallback to Ollama if credits fail

2. **How it works:**
   - Tries: Claude (if credits available)
   - Falls back to: Ollama (local)
   - Result: Always works, uses cheapest available model

#### ⚠️ **Option C: Add Claude Credits (If you want Claude)**

1. **Check account status:**
   ```bash
   claude auth status | jq '.subscriptionType'
   ```
   If output is `null`, you need credits.

2. **Add payment method:**
   - Go to [console.anthropic.com](https://console.anthropic.com)
   - Sign in with your Claude account email
   - Add credit card
   - Enable API usage
   - Wait 5-10 minutes for billing to activate

3. **Verify credits restored:**
   ```bash
   echo "test prompt" | claude -p --model sonnet
   # Should stream response, not error
   ```

---

## ✅ Current Working Configuration

### Infrastructure Status
```
✅ AI Server:       http://127.0.0.1:8080 (RUNNING)
✅ Control Panel:   http://127.0.0.1:5173 (RUNNING)
✅ Ollama Service:  http://127.0.0.1:11434 (RUNNING)
⚠️  Claude Code:    /home/usuario/.local/bin/claude (AUTH OK, NO CREDITS)
```

### Recommended Setup
- **Provider Mode:** `local-ollama` or `hybrid`
- **Local Model:** `qwen2.5-coder:14b` (or `neural-chat` if not available)
- **Cloud Model:** Blocked until credits added

### Test Commands
```bash
# 1. Check server is running
curl -s http://127.0.0.1:8080/health | jq '.service'

# 2. Check Ollama models available
curl -s http://127.0.0.1:11434/api/tags | jq '.models | length'

# 3. Test local inference (if Ollama has models)
curl -s http://127.0.0.1:11434/api/generate \
  -d '{"model":"qwen2.5-coder:14b","prompt":"say hello"}' \
  | jq '.response'

# 4. Check VSCodium extension connected
# (Open VSCodium, check AI Platform sidebar for "Connected" status)
```

---

## 📋 Complete Setup Checklist

### Phase 1: Core Setup ✅
- [x] Node 20 configured
- [x] pnpm installed
- [x] Repository cloned/initialized
- [x] AI Server running
- [x] Dependencies installed

### Phase 2: Local Development (Choose One) ⏳

**Path A: Local Only (Recommended)**
- [ ] Ollama running
- [ ] Pull model: `ollama pull qwen2.5-coder:14b`
- [ ] Set mode: `local-ollama`
- [ ] Test chat in VSCodium

**Path B: Hybrid (Local + Cloud)**
- [x] Ollama running
- [ ] Claude CLI installed (already done)
- [ ] Claude CLI authenticated (already done)
- [ ] ⚠️ Add Claude credits (REQUIRED)
- [ ] Set mode: `hybrid`
- [ ] Test chat

**Path C: Cloud Only**
- [ ] Claude CLI installed (already done)
- [ ] Claude CLI authenticated (already done)
- [ ] ⚠️ Add Claude credits (REQUIRED)
- [ ] Set mode: `copilot-managed`
- [ ] Test chat

### Phase 3: Extension Testing ⏳
- [ ] VSCodium extension installed
- [ ] Sidebar appears with AI Platform
- [ ] "Connect Server" button works
- [ ] "Ask AI" opens chat
- [ ] Can send test prompt
- [ ] Get response back
- [ ] All sidebar buttons work

### Phase 4: Production Ready 🚀
- [ ] Configuration tested
- [ ] Error handling verified
- [ ] Performance acceptable
- [ ] Documentation complete
- [ ] Ready to distribute

---

## 🔧 Quick Fix Commands

### "Credit balance is too low"
```bash
# Use local mode instead:
curl -s http://127.0.0.1:8080/api/config | jq '.'
# Then set providerMode to "local-ollama" in config
```

### Extension won't connect
```bash
# 1. Check server is running
curl http://127.0.0.1:8080/health

# 2. Check WebSocket is listening
lsof -i :8080

# 3. Restart server
./stop-all.sh && ./start-all.sh
```

### Ollama not responding
```bash
# 1. Start Ollama
ollama serve

# 2. In another terminal, pull a model
ollama pull qwen2.5-coder:14b

# 3. Verify
curl http://127.0.0.1:11434/api/tags
```

### Claude command fails
```bash
# 1. Check auth
claude auth status

# 2. If logged in but getting credit error, use local mode
# 3. If not logged in, run:
claude auth login --console
```

---

## 📊 Implementation Status

| Feature | Status | Note |
|---------|--------|------|
| AI Server | ✅ Ready | Running on port 8080 |
| Ollama Local | ✅ Ready | Running, needs model |
| Claude Cloud | ⚠️ Blocked | No credits - add payment |
| VSCodium Extension | ⏳ Ready to test | Built, needs integration test |
| Control Panel | ✅ Ready | Running on port 5173 |
| Hybrid Routing | ✅ Ready | Set provider mode to test |

---

## 🎯 Next Actions (In Order)

1. **Pick a path:**
   ```
   A) Local-only development (recommended)
   B) Hybrid with credits
   C) Cloud-only (need credits)
   ```

2. **Set provider mode:**
   - Open VSCodium
   - Sidebar → "Set Provider Mode" → choose above
   - Click "Ask AI"
   - Send test prompt

3. **Verify works:**
   - Should see response
   - No errors
   - Fast response (local is < 5sec)

4. **If issues, run:**
   ```bash
   bash test-conductor.sh
   ```

---

## 💡 Pro Tips

- **Local models are free:** Ollama runs everything locally, no API costs
- **Hybrid is smart:** Automatically falls back to local if cloud errors
- **No internet needed:** Local mode works completely offline
- **Fast iteration:** Local models faster for development than cloud

---

## Support

If issues persist:

1. **Check logs:**
   ```bash
   tail -f ~/.local/share/Ollama/logs/* 2>/dev/null
   ```

2. **Test components independently:**
   ```bash
   # Test Ollama
   curl http://127.0.0.1:11434/api/tags
   
   # Test Claude
   claude auth status
   
   # Test Server
   curl http://127.0.0.1:8080/health
   ```

3. **Update this file** if you find new issues!

