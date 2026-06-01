# CLAUDE.md

Project guidance for Claude Code in this repository.

## Project overview
- Monorepo: `vscode-ai-core`
- Package manager: `pnpm`
- Build system: `turbo` + `tsc`
- Main apps:
  - `apps/ai-server` (Fastify + WebSocket orchestrator)
  - `apps/vscode-extension` (VS Code extension client)
  - `apps/control-panel` (UI)
  - `packages/shared` (shared types/contracts)

## What to do before proposing code changes
1. Read affected files end-to-end.
2. Check related shared contracts in `packages/shared/src/index.ts`.
3. Keep backward compatibility for WS payloads when possible.
4. Prefer minimal diffs.

## Useful commands
- Install deps: `pnpm install`
- Build all: `pnpm build:all`
- Typecheck all: `pnpm typecheck:all`
- Run tests: `pnpm test:all`
- Start local stack: `./start-all.sh`
- Stop local stack: `./stop-all.sh`
- Build ai-server only: `pnpm --filter @apps/ai-server build`
- Build extension only: `pnpm --filter @apps/vscode-extension build`

## Claude Code integration
- Cloud/hybrid route can execute through local Claude Code CLI when installed/authenticated.
- Model selection precedence:
  1. `CLAUDE_CODE_MODEL` (explicit env override)
  2. `config.models.cloud.model` (project config)
  3. `CLAUDE_CODE_DEFAULT_MODEL` (default: `sonnet`)
- Optional fallback model: `CLAUDE_CODE_FALLBACK_MODEL` (passed as `--fallback-model`).
- Example:
  - `CLAUDE_CODE_MODEL=opus`
  - or set `models.cloud.model = "claude-sonnet-4-6"` in common config.

## Expectations for answers
- Ground analysis in real files and code snippets from the workspace.
- When suggesting edits, include exact file paths.
- Avoid generic “create README” style responses unless user explicitly asks.
- If context is incomplete, state assumptions clearly.

## High-impact files
- `apps/ai-server/src/wsOrchestrator.ts`
- `apps/ai-server/src/semanticWorkspaceIndex.ts`
- `apps/vscode-extension/src/extension.ts`
- `packages/shared/src/index.ts`

## Validation checklist after edits
- Build changed package(s).
- Run typecheck/tests if change touches shared contracts.
- Restart local services if server behavior changed.
