import {
  ChatRequest,
  CommonConfig,
  EditorSignal,
  PromptTraceRecord,
  RepositoryWorkspace,
  WsClientMessage,
  WsServerMessage,
  createRequestId
} from "@vscode-ai/shared";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { SemanticWorkspaceIndex } from "./semanticWorkspaceIndex";

export interface ExtensionSocket {
  readyState: number;
  OPEN: number;
  send: (data: string) => void;
  on: (event: "message" | "close", listener: (payload?: unknown) => void) => void;
}

interface InFlightRequest {
  requestId: string;
  cancelled: boolean;
  startedAt: number;
}

export class WsOrchestrator {
  private readonly extensionClients = new Set<ExtensionSocket>();
  private readonly editorSignals = new Map<string, EditorSignal>();
  private readonly inFlight = new Map<string, InFlightRequest>();
  private readonly traces: PromptTraceRecord[] = [];
  private readonly ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  private readonly configuredClaudeCommand = process.env.CLAUDE_CODE_BIN ?? "claude";
  private readonly claudeTimeoutMs = Number(process.env.CLAUDE_CODE_TIMEOUT_MS ?? 1000 * 120);
  private readonly claudeDefaultModel = process.env.CLAUDE_CODE_DEFAULT_MODEL ?? "sonnet";
  private readonly claudeFallbackModel = process.env.CLAUDE_CODE_FALLBACK_MODEL;
  private resolvedClaudeCommand?: string | null;
  private claudeAvailabilityCache?: { checkedAt: number; available: boolean };
  private readonly semanticIndex = new SemanticWorkspaceIndex({
    ollamaBaseUrl: this.ollamaBaseUrl,
    embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text",
    maxFiles: Number(process.env.WORKSPACE_INDEX_MAX_FILES ?? 350),
    maxChunkChars: Number(process.env.WORKSPACE_INDEX_MAX_CHARS ?? 2600),
    reindexIntervalMs: Number(process.env.WORKSPACE_INDEX_REINDEX_MS ?? 1000 * 60 * 12)
  });

  constructor(private readonly getConfig: () => CommonConfig) {}

  getExtensionClientCount(): number {
    return this.extensionClients.size;
  }

  getPromptTraces(): PromptTraceRecord[] {
    return [...this.traces].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  attachClient(socket: ExtensionSocket): void {
    this.extensionClients.add(socket);
    this.send(socket, {
      type: "connected",
      payload: {
        sessionId: createRequestId(),
        now: new Date().toISOString()
      }
    });

    socket.on("message", (payload) => {
      const raw = typeof payload === "string" ? payload : String(payload ?? "");
      this.onMessage(socket, raw).catch((error) => {
        this.send(socket, {
          type: "chat.error",
          payload: {
            requestId: "unknown",
            message: error instanceof Error ? error.message : String(error)
          }
        });
      });
    });

    socket.on("close", () => {
      this.extensionClients.delete(socket);
    });
  }

  private async onMessage(socket: ExtensionSocket, raw: string): Promise<void> {
    let message: WsClientMessage;
    try {
      message = JSON.parse(raw) as WsClientMessage;
    } catch {
      return;
    }

    if (message.type === "editor.sync") {
      this.editorSignals.set(message.payload.workspaceId, message.payload);
      return;
    }

    if (message.type === "config.get") {
      this.send(socket, {
        type: "config.snapshot",
        payload: this.getConfig(),
        sentAt: new Date().toISOString()
      });
      return;
    }

    if (message.type === "chat.cancel") {
      const active = this.inFlight.get(message.payload.requestId);
      if (active) {
        active.cancelled = true;
      }
      this.send(socket, {
        type: "chat.cancelled",
        payload: { requestId: message.payload.requestId }
      });
      return;
    }

    if (message.type === "chat.request") {
      await this.handleChat(socket, message.payload);
    }
  }

  private async handleChat(socket: ExtensionSocket, request: ChatRequest): Promise<void> {
    const config = this.getConfig();
    const signal = this.editorSignals.get(request.workspaceId);
    const hasClaudeCode = await this.hasClaudeCodeCli();
    const claudeModel = this.resolveClaudeModel(config.models.cloud.model);

    const mode = request.mode ?? config.routing.defaultMode;
    const cloudCapable = config.models.cloud.enabled || hasClaudeCode;
    const route = this.pickRoute(mode, cloudCapable, request.preferCloudForQuality);
    const preferredLocalModel = config.models.local.model;
    const model =
      route === "local"
        ? await this.resolveLocalModel(preferredLocalModel)
        : hasClaudeCode
          ? `claude-code:${claudeModel}`
          : config.models.cloud.model;
    const reason = this.buildRoutingReason(mode, route, Boolean(request.preferCloudForQuality));
    const effectiveReason =
      route === "local" && model !== preferredLocalModel
        ? `${reason}, fallback-model=${model}`
        : reason;

    this.send(socket, {
      type: "chat.started",
      payload: {
        requestId: request.requestId,
        mode,
        route,
        model,
        reason: effectiveReason
      }
    });

    const startedAt = Date.now();
    const inFlight: InFlightRequest = {
      requestId: request.requestId,
      startedAt,
      cancelled: false
    };
    this.inFlight.set(request.requestId, inFlight);

    const responseText = await this.generateResponse({
      request,
      model,
      route,
      signal,
      hasClaudeCode,
      claudeModel
    });
    const tokens = this.tokenize(responseText);

    let aggregate = "";
    for (const token of tokens) {
      const active = this.inFlight.get(request.requestId);
      if (!active || active.cancelled) {
        this.inFlight.delete(request.requestId);
        return;
      }

      aggregate += token;
      this.send(socket, {
        type: "chat.delta",
        payload: {
          requestId: request.requestId,
          token
        }
      });

      await this.delay(18);
    }

    const latencyMs = Date.now() - startedAt;
    const traceId = createRequestId();
    this.traces.unshift({
      id: traceId,
      createdAt: new Date().toISOString(),
      requestId: request.requestId,
      mode,
      route,
      model,
      includedFiles: signal?.openFiles ?? [],
      estimatedTokens: Math.ceil(responseText.length / 4),
      latencyMs,
      estimatedCostUsd: route === "local" ? 0 : 0.002,
      promptPreview: request.prompt.slice(0, 500)
    });
    this.traces.splice(100);

    this.send(socket, {
      type: "chat.completed",
      payload: {
        requestId: request.requestId,
        text: aggregate,
        latencyMs,
        traceId
      }
    });

    this.inFlight.delete(request.requestId);
  }

  private tokenize(text: string): string[] {
    const words = text.split(/(\s+)/).filter(Boolean);
    if (words.length === 0) return [text];
    return words;
  }

  private send(socket: ExtensionSocket, message: WsServerMessage): void {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify(message));
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async generateResponse(input: {
    request: ChatRequest;
    model: string;
    route: "local" | "cloud";
    signal?: EditorSignal;
    hasClaudeCode: boolean;
    claudeModel: string;
  }): Promise<string> {
    if (input.route === "local") {
      return await this.generateLocalResponse(input.request.prompt, input.model, input.signal);
    }

    if (input.hasClaudeCode) {
      return await this.generateClaudeCodeResponse(input.request.prompt, input.signal, input.claudeModel);
    }

    return [
      "Cloud route selected but direct cloud execution is not configured in ai-server.",
      "Use Copilot-managed mode in VS Code Chat, or disable cloud route in config.",
      "Falling back to local model is recommended for this path."
    ].join(" ");
  }

  private async generateClaudeCodeResponse(prompt: string, signal: EditorSignal | undefined, claudeModel: string): Promise<string> {
    const workspaceId = signal?.workspaceId;
    const context = await this.buildContextBlock(prompt, workspaceId, signal);
    const configuredRepo = this.resolveRepository(workspaceId, signal);
    const repoPath = configuredRepo?.path ?? await this.inferRepositoryPath(signal);

    const fullPrompt = [
      "You are working inside a local VS Code project.",
      "Use the provided workspace context and snippets as primary grounding.",
      "Answer concretely with file paths when possible.",
      "",
      context.slice(0, 15000),
      "",
      "User request:",
      prompt
    ].join("\n");

    try {
      const output = await this.executeClaudeCode(fullPrompt, claudeModel, repoPath);
      const text = output.trim();
      return text.length > 0 ? text : "Claude Code returned an empty response.";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return [
        "Claude Code integration failed for this request.",
        `Details: ${message}`,
        "Check `claude` auth in terminal and retry."
      ].join(" ");
    }
  }

  private async hasClaudeCodeCli(): Promise<boolean> {
    const cached = this.claudeAvailabilityCache;
    const now = Date.now();
    if (cached && now - cached.checkedAt < 30_000) {
      return cached.available;
    }

    const command = await this.resolveClaudeCommand();
    const available = Boolean(command);

    this.claudeAvailabilityCache = { checkedAt: now, available };
    return available;
  }

  private async resolveClaudeCommand(): Promise<string | undefined> {
    if (this.resolvedClaudeCommand !== undefined) {
      return this.resolvedClaudeCommand ?? undefined;
    }

    const candidates = [
      this.configuredClaudeCommand,
      "claude",
      join(homedir(), ".local", "bin", "claude"),
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude"
    ]
      .map((value) => value.trim())
      .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);

    for (const candidate of candidates) {
      const available = await new Promise<boolean>((resolve) => {
        const child = spawn(candidate, ["--version"], {
          stdio: ["ignore", "pipe", "pipe"]
        });

        child.on("error", () => resolve(false));
        child.on("close", (code) => resolve(code === 0));
      });

      if (available) {
        this.resolvedClaudeCommand = candidate;
        return candidate;
      }
    }

    this.resolvedClaudeCommand = null;
    return undefined;
  }

  private async executeClaudeCode(prompt: string, claudeModel: string, cwd?: string): Promise<string> {
    const command = await this.resolveClaudeCommand();
    if (!command) {
      throw new Error(
        "Claude CLI not found. Export CLAUDE_CODE_BIN=/home/usuario/.local/bin/claude (or your `which claude` path) and restart ai-server."
      );
    }

    return await new Promise<string>((resolve, reject) => {
      const args = ["-p", "--model", claudeModel] as string[];
      if (this.claudeFallbackModel && this.claudeFallbackModel.trim().length > 0) {
        args.push("--fallback-model", this.claudeFallbackModel.trim());
      }
      args.push(prompt);

      const child = spawn(command, args, {
        cwd: cwd ?? process.cwd(),
        env: {
          ...process.env
        },
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
      }, this.claudeTimeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      child.on("close", (code, signal) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve(stdout.trim());
          return;
        }

        const err = stderr.trim() || `Claude process failed (code=${code ?? "unknown"}, signal=${signal ?? "none"})`;
        reject(new Error(err));
      });
    });
  }

  private resolveClaudeModel(configuredCloudModel: string): string {
    const explicit = (process.env.CLAUDE_CODE_MODEL ?? "").trim();
    if (explicit) return explicit;

    const input = (configuredCloudModel ?? "").trim().toLowerCase();
    if (!input) return this.claudeDefaultModel;

    const aliasMap: Record<string, string> = {
      "claude-code": this.claudeDefaultModel,
      "claude": this.claudeDefaultModel,
      "sonnet": "sonnet",
      "opus": "opus",
      "haiku": "haiku",
      "claude-sonnet": "sonnet",
      "claude-opus": "opus",
      "claude-haiku": "haiku"
    };

    if (aliasMap[input]) return aliasMap[input];
    if (input.startsWith("claude-")) return input;

    if (input.includes("gpt") || input.includes("copilot") || input.includes("codex")) {
      return this.claudeDefaultModel;
    }

    return input;
  }

  private async generateLocalResponse(prompt: string, model: string, signal?: EditorSignal): Promise<string> {
    const context = await this.buildContextBlock(prompt, signal?.workspaceId, signal);

    const body = {
      model,
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You are an expert coding assistant working inside VS Code. Use provided workspace context, repository facts, indexed search results, and file snippets to answer concretely. Treat this context as tool output from workspace index + read-file calls, and ground your answer in it. Never ask the user for basic project info that can be inferred from context. Never suggest commands like 'read-file' or claim you will inspect files later. If context is thin, state assumptions and still provide a concrete first-pass analysis based on available snippets. If code changes are requested, provide exact edits with file paths and minimal diffs. Avoid generic promises like 'I will gather information'."
        },
        {
          role: "user",
          content: `${context}\n\nUser request:\n${prompt}`
        }
      ],
      options: {
        num_ctx: 8192,
        temperature: 0.2,
        top_p: 0.9
      }
    };

    const res = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error(`Ollama request failed: ${res.status}`);
    }

    const payload = (await res.json()) as { message?: { content?: string } };
    const text = payload.message?.content?.trim();
    return text && text.length > 0 ? text : "No response produced by model.";
  }

  private async resolveLocalModel(preferredModel: string): Promise<string> {
    const models = await this.listLocalModels();
    if (models.includes(preferredModel)) return preferredModel;

    const preferredCandidates = [
      "qwen2.5-coder:7b",
      "qwen3:8b",
      "qwen2.5:7b-instruct",
      "llama3.1:8b"
    ];

    for (const candidate of preferredCandidates) {
      if (models.includes(candidate)) return candidate;
    }

    return models[0] ?? preferredModel;
  }

  private async listLocalModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.ollamaBaseUrl}/api/tags`);
      if (!res.ok) return [];
      const payload = (await res.json()) as { models?: Array<{ name?: string }> };
      return (payload.models ?? [])
        .map((m) => m.name)
        .filter((name): name is string => Boolean(name));
    } catch {
      return [];
    }
  }

  private async buildContextBlock(prompt: string, workspaceId?: string, signal?: EditorSignal): Promise<string> {
    const configuredRepo = this.resolveRepository(workspaceId, signal);
    const repoPath = configuredRepo?.path ?? await this.inferRepositoryPath(signal);
    const repoName = configuredRepo?.name ?? this.deriveRepoName(repoPath);

    const diagnosticsPreview = signal
      ? signal.diagnostics
          .slice(0, 6)
          .map((d) => `${d.severity.toUpperCase()} ${d.filePath}:${d.line} ${d.message}`)
          .join("\n")
      : "";

    const openFiles = signal?.openFiles.slice(0, 10).join(", ") ?? "";
    const selectedText = signal?.selectedText?.slice(0, 1200) ?? "";
    const snippets = await this.collectRelevantFileSnippets(prompt, signal, repoPath);
    const semanticSnippets = await this.collectSemanticWorkspaceSnippets(prompt, workspaceId, repoPath, repoName);
    const workspaceFacts = await this.buildWorkspaceFacts(configuredRepo, repoPath, repoName);

    return [
      `Workspace ID: ${workspaceId ?? "unknown"}`,
      `Active file: ${signal?.activeFilePath ?? "none"}`,
      `Cursor line: ${signal?.cursorLine ?? "n/a"}`,
      `Open files: ${openFiles || "none"}`,
      signal ? "Editor sync: present" : "Editor sync: unavailable, using repository index fallback",
      workspaceFacts,
      diagnosticsPreview ? `Diagnostics:\n${diagnosticsPreview}` : "Diagnostics: none",
      selectedText ? `Selected text:\n${selectedText}` : "",
      snippets,
      semanticSnippets
    ]
      .filter(Boolean)
      .join("\n");
  }

  private async buildWorkspaceFacts(
    repo: RepositoryWorkspace | undefined,
    repoPath: string | undefined,
    repoName?: string
  ): Promise<string> {
    const effectiveRepoPath = repo?.path ?? repoPath;
    if (!effectiveRepoPath) return "";

    const packageJsonPath = join(effectiveRepoPath, "package.json");
    let packageFacts = "";
    try {
      await access(packageJsonPath, constants.R_OK);
      const raw = await readFile(packageJsonPath, "utf8");
      const parsed = JSON.parse(raw) as { name?: string; scripts?: Record<string, string> };
      const scripts = Object.keys(parsed.scripts ?? {}).slice(0, 8).join(", ");
      packageFacts = [`Package: ${parsed.name ?? "unknown"}`, `Scripts: ${scripts || "none"}`].join("\n");
    } catch {
      packageFacts = "";
    }

    const topLevel = await this.listTopLevel(effectiveRepoPath);
    return [
      `Repository: ${repo?.name ?? repoName ?? "inferred-workspace"}`,
      `Repository path: ${effectiveRepoPath}`,
      repo ? "Repository source: configured" : "Repository source: inferred from open files",
      topLevel ? `Top-level entries: ${topLevel}` : "",
      packageFacts
    ]
      .filter(Boolean)
      .join("\n");
  }

  private resolveRepository(workspaceId: string | undefined, signal?: EditorSignal): RepositoryWorkspace | undefined {
    const repositories = this.getConfig().repositories;
    return repositories.find((r) => {
      if (workspaceId && (r.id === workspaceId || r.name === workspaceId)) return true;
      if (signal?.workspaceFolders?.some((folder) => this.isWithin(folder, r.path) || this.isWithin(r.path, folder))) return true;
      if (signal?.activeFilePath && signal.activeFilePath.startsWith(r.path)) return true;
      if (signal?.openFiles.some((p) => p.startsWith(r.path))) return true;
      return false;
    });
  }

  private async listTopLevel(repoPath: string): Promise<string> {
    try {
      const fs = await import("node:fs/promises");
      const entries = await fs.readdir(repoPath, { withFileTypes: true });
      const filtered = entries
        .filter((e) => !["node_modules", ".git", "dist", ".turbo"].includes(e.name))
        .slice(0, 20)
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      return filtered.join(", ");
    } catch {
      return "";
    }
  }

  private async collectRelevantFileSnippets(
    prompt: string,
    signal: EditorSignal | undefined,
    repoPath: string | undefined
  ): Promise<string> {
    if (!signal && !repoPath) return "";

    const candidatePaths = Array.from(
      new Set([
        signal?.activeFilePath,
        ...(signal?.openFiles ?? []),
        ...this.extractPromptFileCandidates(prompt, repoPath)
      ].filter((p): p is string => Boolean(p)))
    ).slice(0, 20);

    const keywords = this.extractKeywords(prompt);
    const rankedPaths = candidatePaths
      .map((filePath) => ({
        filePath,
        score: this.pathRelevanceScore(filePath, keywords)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((x) => x.filePath);

    const snippets: string[] = [];
    for (const filePath of rankedPaths) {
      const snippet = await this.readSnippet(filePath);
      if (!snippet) continue;
      snippets.push(`File snippet (${filePath}):\n${snippet}`);
    }

    if (snippets.length === 0 && repoPath) {
      const fallbackPaths = await this.collectRepresentativeFiles(repoPath);
      for (const filePath of fallbackPaths) {
        const snippet = await this.readSnippet(filePath);
        if (!snippet) continue;
        snippets.push(`File snippet (${filePath}):\n${snippet}`);
        if (snippets.length >= 4) break;
      }
    }

    if (snippets.length === 0) return "";
    return `Relevant file snippets:\n${snippets.join("\n\n")}`;
  }

  private async readSnippet(filePath: string): Promise<string | undefined> {
    try {
      await access(filePath, constants.R_OK);
      const content = await readFile(filePath, "utf8");
      if (!content.trim()) return undefined;
      const clipped = content.slice(0, 5000);
      return "```\n" + clipped + "\n```";
    } catch {
      return undefined;
    }
  }

  private async collectSemanticWorkspaceSnippets(
    prompt: string,
    workspaceId: string | undefined,
    repoPath: string | undefined,
    repoName?: string
  ): Promise<string> {
    if (!repoPath) return "";

    const workspaceKey = workspaceId ?? repoName ?? repoPath;

    try {
      await this.semanticIndex.ensureIndexed(workspaceKey, repoPath);
      const hits = await this.semanticIndex.search(workspaceKey, prompt, 4);
      if (hits.length === 0) return "";

      const blocks: string[] = [];
      for (const hit of hits) {
        const snippet = await this.readSnippet(hit.filePath);
        if (!snippet) continue;
        const relPath = relative(repoPath, hit.filePath);
        blocks.push(`- ${relPath} (similarity=${hit.similarity.toFixed(2)})\n${snippet}`);
      }

      if (blocks.length === 0) return "";
      return `Indexed workspace matches (semantic search + read file):\n${blocks.join("\n\n")}`;
    } catch {
      return "";
    }
  }

  private extractPromptFileCandidates(prompt: string, repoPath?: string): string[] {
    if (!repoPath) return [];

    const matches = prompt.match(/[\w./-]+\.(ts|tsx|js|jsx|json|md|yml|yaml|py|go|rs|c|h|cpp|hpp|cs|lua|gd)/gi) ?? [];
    const candidates: string[] = [];

    for (const raw of matches.slice(0, 8)) {
      const normalized = raw.replace(/^\.?\//, "");
      candidates.push(join(repoPath, normalized));
    }

    return candidates;
  }

  private async collectRepresentativeFiles(repoPath: string): Promise<string[]> {
    const fs = await import("node:fs/promises");
    const extPriority = [
      ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".cpp", ".hpp", ".h", ".c", ".cs", ".lua", ".gd"
    ];
    const exactPriority = ["cmakelists.txt", "package.json", "project.godot", "main.ts", "main.cpp", "game.cpp"];
    const ignore = new Set(["node_modules", ".git", "dist", "build", ".logs", ".run", ".turbo", ".next"]);

    const queue: string[] = [repoPath];
    const found: string[] = [];

    while (queue.length > 0 && found.length < 40) {
      const dir = queue.shift();
      if (!dir) continue;

      let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!ignore.has(entry.name)) {
            queue.push(join(dir, entry.name));
          }
          continue;
        }

        if (!entry.isFile()) continue;
        const lowerName = entry.name.toLowerCase();
        const fullPath = join(dir, entry.name);

        if (exactPriority.includes(lowerName)) {
          found.unshift(fullPath);
          continue;
        }

        if (extPriority.some((ext) => lowerName.endsWith(ext))) {
          found.push(fullPath);
        }
      }
    }

    const unique = Array.from(new Set(found));
    unique.sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const ai = this.representativePathScore(aLower, exactPriority, extPriority);
      const bi = this.representativePathScore(bLower, exactPriority, extPriority);
      return bi - ai;
    });

    return unique.slice(0, 8);
  }

  private representativePathScore(pathLower: string, exactPriority: string[], extPriority: string[]): number {
    let score = 0;
    for (let i = 0; i < exactPriority.length; i += 1) {
      if (pathLower.endsWith("/" + exactPriority[i]) || pathLower.endsWith("\\" + exactPriority[i])) {
        score += 200 - i * 10;
      }
    }

    for (let i = 0; i < extPriority.length; i += 1) {
      if (pathLower.endsWith(extPriority[i])) {
        score += 80 - i * 3;
      }
    }

    if (pathLower.includes("/src/") || pathLower.includes("\\src\\")) score += 20;
    if (pathLower.includes("/game") || pathLower.includes("\\game")) score += 12;
    return score;
  }

  private async inferRepositoryPath(signal?: EditorSignal): Promise<string | undefined> {
    if (!signal) return undefined;

    const workspaceFolderCandidates = (signal.workspaceFolders ?? [])
      .filter((p) => this.isLikelyAbsolutePath(p) && !this.isIgnoredContextPath(p));

    for (const folder of workspaceFolderCandidates) {
      const root = await this.findRepositoryRoot(folder, true);
      if (root) return root;
    }

    const candidates = [signal.activeFilePath, ...signal.openFiles]
      .filter((p): p is string => Boolean(p && this.isLikelyAbsolutePath(p) && !this.isIgnoredContextPath(p)))
      .slice(0, 20);

    for (const filePath of candidates) {
      const root = await this.findRepositoryRoot(filePath);
      if (root) return root;
    }

    return undefined;
  }

  private async findRepositoryRoot(filePath: string, treatAsDirectory = false): Promise<string | undefined> {
    let current = treatAsDirectory ? filePath : dirname(filePath);

    for (let depth = 0; depth < 14; depth += 1) {
      if (current === "/" || current.length < 2) break;
      if (this.isIgnoredContextPath(current)) return undefined;

      if (await this.pathExists(join(current, ".git"))) return current;
      if (await this.pathExists(join(current, "package.json"))) return current;

      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }

    return undefined;
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private isLikelyAbsolutePath(value: string): boolean {
    if (!value) return false;
    if (value.startsWith("/")) return true;
    return /^[A-Za-z]:\\/.test(value);
  }

  private isIgnoredContextPath(value: string): boolean {
    const lower = value.toLowerCase();
    return (
      lower.includes("/response_") ||
      lower.includes("/extension-output") ||
      lower.includes("/workspace-storage/") ||
      lower.includes("/scm0/") ||
      lower.includes("/.vscode-server/")
    );
  }

  private isWithin(pathValue: string, root: string): boolean {
    if (!pathValue || !root) return false;
    return pathValue === root || pathValue.startsWith(root + "/") || pathValue.startsWith(root + "\\");
  }

  private deriveRepoName(repoPath?: string): string | undefined {
    if (!repoPath) return undefined;
    const normalized = repoPath.replace(/\\/g, "/").replace(/\/+$/, "");
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1];
  }

  private extractKeywords(prompt: string): string[] {
    const stop = new Set(["the", "and", "for", "with", "from", "that", "this", "have", "will", "make", "using"]);
    return prompt
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2 && !stop.has(w))
      .slice(0, 12);
  }

  private pathRelevanceScore(filePath: string, keywords: string[]): number {
    const lower = filePath.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += 3;
    }
    if (lower.endsWith(".ts") || lower.endsWith(".tsx")) score += 1;
    if (lower.includes("extension") || lower.includes("server") || lower.includes("orchestrator")) score += 1;
    return score;
  }

  private pickRoute(mode: "copilot-managed" | "local-ollama" | "hybrid", cloudEnabled: boolean, preferCloudForQuality?: boolean): "local" | "cloud" {
    if (mode === "local-ollama") {
      if (preferCloudForQuality && cloudEnabled) return "cloud";
      return "local";
    }

    if (mode === "copilot-managed" || mode === "hybrid") {
      if (cloudEnabled) return "cloud";
      return "local";
    }

    return "local";
  }

  private buildRoutingReason(mode: "copilot-managed" | "local-ollama" | "hybrid", route: "local" | "cloud", preferCloudForQuality: boolean): string {
    const parts = [
      `mode=${mode}`,
      `selected=${route}`,
      preferCloudForQuality ? "quality-priority" : "default-priority"
    ];
    return parts.join(", ");
  }
}
