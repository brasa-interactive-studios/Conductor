# VSCode Extension Adapter

Lightweight VSCode extension bridge for the AI platform.

## Responsibilities

- Connects to AI server over WebSocket (`/ws/extension`)
- Sends editor synchronization payloads (active file, selection, diagnostics, open files)
- Sends chat requests and cancellation events
- Renders streamed tokens to an output channel (`AI Platform`)

## Commands

- `AI Platform: Connect Server` (`aiPlatform.connect`)
- `AI Platform: Ask` (`aiPlatform.ask`)
- `AI Platform: Cancel Active Request` (`aiPlatform.cancel`)

## Notes

- Heavy orchestration remains in `apps/ai-server`.
- Extension stays thin and event-driven by design.

## Development Configuration

- Workspace debug config is available in [.vscode/launch.json](../../../.vscode/launch.json).
- Build/watch tasks are available in [.vscode/tasks.json](../../../.vscode/tasks.json).

Extension settings:

- `aiPlatform.serverUrl` (default: `ws://127.0.0.1:8080/ws/extension`)
- `aiPlatform.autoConnect` (default: `true`)

## Troubleshooting

If activation fails with `Unexpected token 'export'`:

1. Build shared package first:
	- `pnpm --filter @vscode-ai/shared build`
2. Rebuild extension package:
	- `pnpm --filter @apps/vscode-extension build`
3. Reload VS Code window.
