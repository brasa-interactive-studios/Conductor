export type IndexingStatus = "idle" | "indexing" | "ready" | "error";
export type ProviderMode = "copilot-managed" | "local-ollama" | "hybrid";

export interface RepositoryWorkspace {
  id: string;
  name: string;
  path: string;
  indexing: {
    status: IndexingStatus;
    lastIndexedAt?: string;
  };
  localModel?: string;
  customPrompt?: string;
  contextRules: string[];
}

export interface ModelConfig {
  local: {
    provider: "ollama";
    model: string;
    contextWindow: number;
  };
  cloud: {
    provider: "copilot-managed";
    model: string;
    enabled: boolean;
  };
}

export interface RoutingPolicy {
  preferLocal: boolean;
  defaultMode: ProviderMode;
  lowLatencyTokenThreshold: number;
  promoteCloudFor: string[];
}

export interface ContextPolicy {
  maxFiles: number;
  maxTokens: number;
  enableCompression: boolean;
  includeDiagnostics: boolean;
}

export interface ObservabilityPolicy {
  promptTrace: boolean;
  tokenAnalytics: boolean;
  routingDiagnostics: boolean;
}

export interface CommonConfig {
  version: number;
  updatedAt: string;
  repositories: RepositoryWorkspace[];
  models: ModelConfig;
  routing: RoutingPolicy;
  context: ContextPolicy;
  observability: ObservabilityPolicy;
}

export interface PromptTraceRecord {
  id: string;
  createdAt: string;
  requestId: string;
  mode: ProviderMode;
  route: "local" | "cloud";
  model: string;
  includedFiles: string[];
  estimatedTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
  promptPreview: string;
}

export interface EditorSignal {
  workspaceId: string;
  workspaceFolders?: string[];
  activeFilePath?: string;
  selectedText?: string;
  cursorLine?: number;
  diagnostics: Array<{
    filePath: string;
    severity: "error" | "warning" | "info";
    message: string;
    line: number;
  }>;
  openFiles: string[];
  updatedAt: string;
}

export interface ChatRequest {
  requestId: string;
  workspaceId: string;
  prompt: string;
  mode?: ProviderMode;
  preferCloudForQuality?: boolean;
}

export type WsClientMessage =
  | { type: "editor.sync"; payload: EditorSignal }
  | { type: "chat.request"; payload: ChatRequest }
  | { type: "chat.cancel"; payload: { requestId: string } }
  | { type: "config.get"; payload: { requestId: string } };

export type WsServerMessage =
  | { type: "connected"; payload: { sessionId: string; now: string } }
  | { type: "config.snapshot"; payload: CommonConfig; sentAt: string }
  | { type: "telemetry.pulse"; payload: { connectedWsClients: number; vramMbEstimate: number; routingMode: string }; sentAt: string }
  | { type: "chat.started"; payload: { requestId: string; mode: ProviderMode; route: "local" | "cloud"; model: string; reason: string } }
  | { type: "chat.delta"; payload: { requestId: string; token: string } }
  | { type: "chat.completed"; payload: { requestId: string; text: string; latencyMs: number; traceId: string } }
  | { type: "chat.cancelled"; payload: { requestId: string } }
  | { type: "chat.error"; payload: { requestId: string; message: string } };

export const createDefaultConfig = (): CommonConfig => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  repositories: [
    {
      id: "ai-core",
      name: "VSCode AI Core",
      path: "/home/usuario/models/ai-core",
      indexing: { status: "idle" },
      localModel: "qwen2.5-coder:14b",
      contextRules: ["prioritize-active-file", "avoid-full-repo-dump", "deduplicate-context"]
    }
  ],
  models: {
    local: {
      provider: "ollama",
      model: "qwen2.5-coder:14b",
      contextWindow: 16384
    },
    cloud: {
      provider: "copilot-managed",
      model: "gpt-5.3-codex",
      enabled: false
    }
  },
  routing: {
    preferLocal: true,
    defaultMode: "copilot-managed",
    lowLatencyTokenThreshold: 24000,
    promoteCloudFor: ["architecture", "complex-debugging", "large-refactor"]
  },
  context: {
    maxFiles: 8,
    maxTokens: 12000,
    enableCompression: true,
    includeDiagnostics: true
  },
  observability: {
    promptTrace: true,
    tokenAnalytics: true,
    routingDiagnostics: true
  }
});

export const withUpdatedTimestamp = (config: CommonConfig): CommonConfig => ({
  ...config,
  updatedAt: new Date().toISOString()
});

export const mergeCommonConfig = (current: CommonConfig, patch: Partial<CommonConfig>): CommonConfig => {
  return withUpdatedTimestamp({
    ...current,
    ...patch,
    models: {
      ...current.models,
      ...(patch.models ?? {}),
      local: {
        ...current.models.local,
        ...(patch.models?.local ?? {})
      },
      cloud: {
        ...current.models.cloud,
        ...(patch.models?.cloud ?? {})
      }
    },
    routing: {
      ...current.routing,
      ...(patch.routing ?? {})
    },
    context: {
      ...current.context,
      ...(patch.context ?? {})
    },
    observability: {
      ...current.observability,
      ...(patch.observability ?? {})
    },
    repositories: patch.repositories ?? current.repositories
  });
};

export const createRequestId = (): string => {
  const random = Math.random().toString(36).slice(2, 10);
  return `req_${Date.now()}_${random}`;
};
