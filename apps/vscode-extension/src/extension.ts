import * as vscode from "vscode";
import WebSocket, { RawData } from "ws";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ChatRequest, EditorSignal, ProviderMode, WsClientMessage, WsServerMessage, createRequestId } from "@vscode-ai/shared";

interface ExtensionState {
  socket?: WebSocket;
  activeRequestId?: string;
}

interface PendingChatRequest {
  aggregate: string;
  onDelta?: (token: string) => void;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

class AiPlatformTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<vscode.TreeItem[]> {
    const currentMode = getProviderMode();

    const ask = new vscode.TreeItem("Ask AI", vscode.TreeItemCollapsibleState.None);
    ask.command = { command: "aiPlatform.ask", title: "Ask AI" };
    ask.description = `Mode: ${currentMode}`;

    const connect = new vscode.TreeItem("Connect Server", vscode.TreeItemCollapsibleState.None);
    connect.command = { command: "aiPlatform.connect", title: "Connect Server" };
    connect.description = "Connect websocket";

    const startServer = new vscode.TreeItem("Start Server", vscode.TreeItemCollapsibleState.None);
    startServer.command = { command: "aiPlatform.startServer", title: "Start Server" };
    startServer.description = "Run ./start-all.sh";

    const stopServer = new vscode.TreeItem("Stop Server", vscode.TreeItemCollapsibleState.None);
    stopServer.command = { command: "aiPlatform.stopServer", title: "Stop Server" };
    stopServer.description = "Run ./stop-all.sh";

    const authClaude = new vscode.TreeItem("Claude Auth Login", vscode.TreeItemCollapsibleState.None);
    authClaude.command = { command: "aiPlatform.claudeAuthLogin", title: "Claude Auth Login" };
    authClaude.description = "Open auth login in terminal";

    const cancel = new vscode.TreeItem("Cancel Active Request", vscode.TreeItemCollapsibleState.None);
    cancel.command = { command: "aiPlatform.cancel", title: "Cancel Active Request" };
    cancel.description = "Abort current request";

    const setMode = new vscode.TreeItem("Set Provider Mode", vscode.TreeItemCollapsibleState.None);
    setMode.command = { command: "aiPlatform.setProviderMode", title: "Set Provider Mode" };
    setMode.description = "Switch copilot/local/hybrid";

    return [ask, connect, startServer, stopServer, authClaude, cancel, setMode];
  }
}

const state: ExtensionState = {};
const output = vscode.window.createOutputChannel("AI Platform");
let extensionContext: vscode.ExtensionContext | undefined;
const pendingChatRequests = new Map<string, PendingChatRequest>();
let lastClaudeAuthPromptAt = 0;

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  context.subscriptions.push(output);

  registerChatParticipant(context);

  const treeProvider = new AiPlatformTreeProvider();
  context.subscriptions.push(vscode.window.registerTreeDataProvider("aiPlatform.sidebar", treeProvider));

  context.subscriptions.push(
    vscode.commands.registerCommand("aiPlatform.connect", async () => {
      await connect(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aiPlatform.ask", async () => {
      await askAI();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aiPlatform.startServer", async () => {
      await runServerScript("./start-all.sh", "AI Platform Server");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aiPlatform.stopServer", async () => {
      await runServerScript("./stop-all.sh", "AI Platform Server");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aiPlatform.claudeAuthLogin", async () => {
      await runClaudeAuthLogin();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aiPlatform.claudeAuthStatus", async () => {
      await runClaudeAuthStatus();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aiPlatform.cancel", () => {
      cancelActiveRequest();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aiPlatform.setProviderMode", async () => {
      await setProviderMode();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      pushEditorSync();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(() => {
      pushEditorSync();
    })
  );

  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics(() => {
      pushEditorSync();
    })
  );

  const autoConnect = vscode.workspace.getConfiguration("aiPlatform").get<boolean>("autoConnect", true);
  if (autoConnect) {
    void connect(context);
  }
}

function registerChatParticipant(context: vscode.ExtensionContext): void {
  const chatApi = (vscode as unknown as { chat?: { createChatParticipant: (id: string, handler: (...args: any[]) => any) => vscode.Disposable } }).chat;
  if (!chatApi?.createChatParticipant) {
    output.appendLine("[chat] Chat participant API unavailable in this VS Code version.");
    return;
  }

  const participant = chatApi.createChatParticipant("aiPlatform.assistant", async (request: any, _chatContext: any, stream: any, token: vscode.CancellationToken) => {
    await ensureConnected();
    pushEditorSync();

    const prompt = typeof request?.prompt === "string" ? request.prompt : "";
    if (!prompt.trim()) {
      stream.markdown?.("No prompt provided.");
      return;
    }

    const mode = getProviderMode();
    try {
      const responseText = await requestChat(prompt, mode, token, (delta) => {
        stream.markdown?.(delta);
      });

      if (!responseText) {
        stream.markdown?.("No response from AI server.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stream.markdown?.(`AI Platform error: ${message}`);
    }
  });

  context.subscriptions.push(participant);
}

export function deactivate(): void {
  state.socket?.close();
}

async function connect(context: vscode.ExtensionContext): Promise<void> {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    return;
  }

  const configured = vscode.workspace.getConfiguration("aiPlatform").get<string>("serverUrl");
  const serverUrl = configured ?? "ws://127.0.0.1:8080/ws/extension";

  const socket = new WebSocket(serverUrl);
  state.socket = socket;

  socket.on("open", () => {
    output.appendLine(`[connected] ${serverUrl}`);
    vscode.window.setStatusBarMessage("AI Platform connected", 3000);
    pushEditorSync();
    send({ type: "config.get", payload: { requestId: createRequestId() } });
  });

  socket.on("message", (raw: RawData) => {
    try {
      const parsed = JSON.parse(raw.toString("utf8")) as WsServerMessage;
      handleServerMessage(parsed, context);
    } catch (error) {
      output.appendLine(`[parse-error] ${String(error)}`);
    }
  });

  socket.on("error", (error: unknown) => {
    output.appendLine(`[socket-error] ${String(error)}`);
  });

  socket.on("close", () => {
    output.appendLine("[disconnected]");
    vscode.window.setStatusBarMessage("AI Platform disconnected", 3000);
  });
}

function handleServerMessage(message: WsServerMessage, context: vscode.ExtensionContext): void {
  switch (message.type) {
    case "connected":
      output.appendLine(`[session] ${message.payload.sessionId}`);
      return;
    case "config.snapshot":
      output.appendLine(`[config] repositories=${message.payload.repositories.length}`);
      return;
    case "chat.started":
      output.appendLine(
          `[chat-started] ${message.payload.requestId} mode=${message.payload.mode} route=${message.payload.route} model=${message.payload.model}`
      );
      return;
    case "chat.delta":
      {
        const pending = pendingChatRequests.get(message.payload.requestId);
        if (pending) {
          pending.aggregate += message.payload.token;
          pending.onDelta?.(message.payload.token);
        }
      }
      output.append(message.payload.token);
      return;
    case "chat.completed": {
      const pending = pendingChatRequests.get(message.payload.requestId);
      if (pending) {
        pending.resolve(message.payload.text || pending.aggregate);
        pendingChatRequests.delete(message.payload.requestId);
      }
      output.appendLine(`\n[chat-completed] ${message.payload.requestId} latency=${message.payload.latencyMs}ms trace=${message.payload.traceId}`);
      state.activeRequestId = undefined;
      return;
    }
    case "chat.cancelled":
      {
        const pending = pendingChatRequests.get(message.payload.requestId);
        if (pending) {
          pending.reject(new Error("Request cancelled"));
          pendingChatRequests.delete(message.payload.requestId);
        }
      }
      output.appendLine(`[chat-cancelled] ${message.payload.requestId}`);
      state.activeRequestId = undefined;
      return;
    case "chat.error":
      {
        const pending = pendingChatRequests.get(message.payload.requestId);
        if (pending) {
          pending.reject(new Error(message.payload.message));
          pendingChatRequests.delete(message.payload.requestId);
        }

        if (isClaudeAuthError(message.payload.message)) {
          void promptClaudeAuthRecovery();
        }
      }
      output.appendLine(`[chat-error] ${message.payload.requestId} ${message.payload.message}`);
      state.activeRequestId = undefined;
      return;
    case "telemetry.pulse":
      context.workspaceState.update("aiPlatform.telemetry", message.payload).then(undefined, () => undefined);
      return;
  }
}

async function requestChat(
  prompt: string,
  mode: ProviderMode,
  cancellationToken?: vscode.CancellationToken,
  onDelta?: (token: string) => void
): Promise<string> {
  await ensureConnected();

  const workspaceId = vscode.workspace.name ?? "default-workspace";
  const requestId = createRequestId();
  const request: ChatRequest = {
    requestId,
    workspaceId,
    prompt,
    mode
  };

  return await new Promise<string>((resolve, reject) => {
    pendingChatRequests.set(requestId, {
      aggregate: "",
      onDelta,
      resolve,
      reject
    });

    if (cancellationToken) {
      const cancellationDisposable = cancellationToken.onCancellationRequested(() => {
        send({ type: "chat.cancel", payload: { requestId } });
      });

      const wrappedResolve = (value: string): void => {
        cancellationDisposable.dispose();
        resolve(value);
      };

      const wrappedReject = (error: Error): void => {
        cancellationDisposable.dispose();
        reject(error);
      };

      pendingChatRequests.set(requestId, {
        aggregate: "",
        onDelta,
        resolve: wrappedResolve,
        reject: wrappedReject
      });
    }

    send({ type: "chat.request", payload: request });
  });
}

async function askAI(): Promise<void> {
  await ensureConnected();

  const prompt = await vscode.window.showInputBox({
    prompt: "Ask AI server",
    placeHolder: "Explain this code, propose diff, or debug issue"
  });

  if (!prompt) return;

  const workspaceId = vscode.workspace.name ?? "default-workspace";
  const configuredMode = getProviderMode();
  const request: ChatRequest = {
    requestId: createRequestId(),
    workspaceId,
    prompt,
    mode: configuredMode
  };

  state.activeRequestId = request.requestId;
  output.appendLine(`\n[chat-request] ${request.requestId}`);
  send({ type: "chat.request", payload: request });
}

function getProviderMode(): ProviderMode {
  return vscode.workspace.getConfiguration("aiPlatform").get<ProviderMode>("providerMode", "copilot-managed");
}

async function setProviderMode(): Promise<void> {
  const modes: readonly ProviderMode[] = ["copilot-managed", "local-ollama", "hybrid"];
  const picked = await vscode.window.showQuickPick(
    [...modes],
    {
      placeHolder: "Select AI provider mode"
    }
  );

  if (!picked) return;

  await vscode.workspace
    .getConfiguration("aiPlatform")
    .update("providerMode", picked, vscode.ConfigurationTarget.Workspace);
  vscode.window.setStatusBarMessage(`AI Platform mode: ${picked}`, 3000);
}

function cancelActiveRequest(): void {
  if (!state.activeRequestId) {
    vscode.window.showInformationMessage("No active AI request.");
    return;
  }

  send({
    type: "chat.cancel",
    payload: {
      requestId: state.activeRequestId
    }
  });
}

async function ensureConnected(): Promise<void> {
  if (state.socket?.readyState === WebSocket.OPEN) return;
  if (!extensionContext) return;
  await connect(extensionContext);
}

function pushEditorSync(): void {
  const editor = vscode.window.activeTextEditor;
  const workspaceId = vscode.workspace.name ?? "default-workspace";
  const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);

  const isWorkspaceFileUri = (uri: vscode.Uri): boolean => {
    if (uri.scheme !== "file") return false;
    if (workspaceFolders.length === 0) return true;
    return workspaceFolders.some((root) => uri.fsPath.startsWith(root));
  };

  const activeFilePath = editor?.document?.uri && isWorkspaceFileUri(editor.document.uri)
    ? editor.document.uri.fsPath
    : undefined;
  const selectedText = activeFilePath ? editor?.document.getText(editor.selection) : undefined;

  const openFiles = vscode.workspace.textDocuments
    .map((d: vscode.TextDocument) => d.uri)
    .filter((uri) => isWorkspaceFileUri(uri))
    .map((uri) => uri.fsPath)
    .slice(0, 30);

  const diagnostics = vscode.languages
    .getDiagnostics()
    .filter(([uri]) => isWorkspaceFileUri(uri))
    .flatMap(([uri, diags]: readonly [vscode.Uri, readonly vscode.Diagnostic[]]) =>
      diags.slice(0, 15).map((diag: vscode.Diagnostic) => ({
        filePath: uri.fsPath,
        severity: toSeverity(diag.severity),
        message: diag.message,
        line: diag.range.start.line + 1
      }))
    );

  const signal: EditorSignal = {
    workspaceId,
    workspaceFolders,
    activeFilePath,
    selectedText: selectedText?.slice(0, 2000),
    cursorLine: editor?.selection.active.line,
    diagnostics,
    openFiles,
    updatedAt: new Date().toISOString()
  };

  send({ type: "editor.sync", payload: signal });
}

function send(message: WsClientMessage): void {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  state.socket.send(JSON.stringify(message));
}

function getWorkspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function runTerminalCommand(command: string, terminalName: string): void {
  const terminal = vscode.window.createTerminal({
    name: terminalName,
    cwd: getWorkspaceRoot()
  });
  terminal.show(true);
  terminal.sendText(command, true);
}

async function runServerScript(script: "./start-all.sh" | "./stop-all.sh", terminalName: string): Promise<void> {
  runTerminalCommand(`cd ${shellQuote(getWorkspaceRoot())} && ${script}`, terminalName);
}

function resolveClaudeExecutable(): string {
  const configured = vscode.workspace.getConfiguration("aiPlatform").get<string>("claudeBinPath", "").trim();
  const candidates = [
    configured,
    join(homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude"
  ].filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return "claude";
}

async function runClaudeAuthLogin(): Promise<void> {
  const claudeBin = resolveClaudeExecutable();
  runTerminalCommand(
    `cd ${shellQuote(getWorkspaceRoot())} && ${shellQuote(claudeBin)} auth login --console`,
    "AI Platform Claude Auth"
  );
}

async function runClaudeAuthStatus(): Promise<void> {
  const claudeBin = resolveClaudeExecutable();
  await new Promise<void>((resolve) => {
    execFile(claudeBin, ["auth", "status"], { cwd: getWorkspaceRoot() }, (error, stdout, stderr) => {
      if (error) {
        const details = stderr?.trim() || error.message;
        void vscode.window.showErrorMessage(`Claude auth status failed: ${details}`);
        resolve();
        return;
      }

      output.appendLine(`[claude-auth-status]\n${stdout.trim()}`);
      void vscode.window.showInformationMessage("Claude auth status printed in AI Platform output channel.");
      resolve();
    });
  });
}

function isClaudeAuthError(message: string): boolean {
  const text = (message ?? "").toLowerCase();
  if (!text.includes("claude")) {
    return false;
  }

  return ["auth", "login", "unauthorized", "not logged", "api key", "permission", "401"].some((token) =>
    text.includes(token)
  );
}

async function promptClaudeAuthRecovery(): Promise<void> {
  const now = Date.now();
  if (now - lastClaudeAuthPromptAt < 15_000) {
    return;
  }
  lastClaudeAuthPromptAt = now;

  const action = await vscode.window.showErrorMessage(
    "Claude auth seems invalid for ai-server. Run login in terminal and paste the code manually.",
    "Run Claude Auth Login",
    "Claude Auth Status"
  );

  if (action === "Run Claude Auth Login") {
    await runClaudeAuthLogin();
  } else if (action === "Claude Auth Status") {
    await runClaudeAuthStatus();
  }
}

function toSeverity(severity: vscode.DiagnosticSeverity): "error" | "warning" | "info" {
  if (severity === vscode.DiagnosticSeverity.Error) return "error";
  if (severity === vscode.DiagnosticSeverity.Warning) return "warning";
  return "info";
}
