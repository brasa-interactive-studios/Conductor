export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface GenerationOptions {
  model: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  contextWindow?: number;
  stream?: boolean;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}

export interface StreamGenerationResult {
  stream: AsyncGenerator<string, void, unknown>;
  abort: () => void;
}

export interface GenerationResult {
  text: string;
  stopReason: "stop" | "length" | "error";
}

export interface AIProvider {
  readonly name: string;
  isHealthy(): Promise<boolean>;
  listModels(): Promise<string[]>;
  generateStreaming(messages: ChatMessage[], options: GenerationOptions): Promise<StreamGenerationResult>;
  generate(messages: ChatMessage[], options: GenerationOptions): Promise<GenerationResult>;
}

export interface FileContext {
  path: string;
  content: string;
  language: string;
  priority: number;
  reason: string;
}

export interface DiagnosticInfo {
  filePath: string;
  line: number;
  message: string;
  severity: "error" | "warning" | "info";
}

export interface EditorSnapshot {
  activeFile?: FileContext;
  openTabs: FileContext[];
  diagnostics: DiagnosticInfo[];
  gitChangedFiles: string[];
  userRequest: string;
}

export interface RelevantContext {
  activeFile?: FileContext;
  relatedFiles: FileContext[];
  diagnostics: DiagnosticInfo[];
  imports: string[];
  totalEstimatedTokens: number;
}

export interface PromptSections {
  systemPrompt: string;
  repositoryContext: string;
  userRequest: string;
  toolInstructions?: string;
  fileSummaries: string;
}

export interface PromptBuildResult {
  messages: ChatMessage[];
  estimatedTokens: number;
}

export type ProviderMode = "copilot-managed" | "local-ollama" | "hybrid";

export interface OrchestrationRequest {
  workspaceId: string;
  userPrompt: string;
  mode: ProviderMode;
  snapshot: EditorSnapshot;
  preferLowLatency?: boolean;
  preferQuality?: boolean;
}

export interface OrchestrationContextTrace {
  mode: ProviderMode;
  includedFiles: string[];
  diagnosticsCount: number;
  estimatedPromptTokens: number;
  usedFallback: boolean;
}

export interface OrchestrationResult {
  route: ModelRouteDecision;
  prompt: PromptBuildResult;
  trace: OrchestrationContextTrace;
}

export interface ModelRouteDecision {
  provider: "local" | "cloud";
  model: string;
  reason: string;
  mode?: ProviderMode;
}

export interface ModelRoutingConfig {
  defaultLocalModel: string;
  defaultCloudModel?: string;
  preferLocal: boolean;
}

export interface ProviderRegistry {
  local?: AIProvider;
  cloud?: AIProvider;
}

export interface DiffPatch {
  filePath: string;
  oldText: string;
  newText: string;
}
