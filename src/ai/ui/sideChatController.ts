import { ContextEngine } from "@/ai/context/contextEngine";
import { GenerationEngine } from "@/ai/routing/generationEngine";
import { PromptBuilder } from "@/ai/prompts/promptBuilder";
import { EditorSnapshot, ProviderMode } from "@/types/contracts";
import { log } from "@/utils/logger";

export interface SideChatRequest {
  systemPrompt: string;
  userRequest: string;
  snapshot: EditorSnapshot;
  toolInstructions?: string;
  requireLowLatency?: boolean;
  preferCloudForQuality?: boolean;
  mode?: ProviderMode;
}

export interface SideChatCallbacks {
  onToken?: (token: string, aggregate: string) => void;
  onComplete?: (result: {
    text: string;
    provider: "local" | "cloud";
    model: string;
    reason: string;
    mode?: ProviderMode;
    estimatedPromptTokens: number;
  }) => void;
  onError?: (error: Error) => void;
}

export interface SideChatControllerConfig {
  defaultModel: string;
  temperature: number;
  topP: number;
  topK: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface SideChatStreamHandle {
  abort: () => void;
}

export class SideChatController {
  constructor(
    private readonly contextEngine: ContextEngine,
    private readonly promptBuilder: PromptBuilder,
    private readonly generationEngine: GenerationEngine,
    private readonly config: SideChatControllerConfig
  ) {}

  async generateReply(request: SideChatRequest, callbacks: SideChatCallbacks = {}): Promise<SideChatStreamHandle> {
    const relevantContext = this.contextEngine.build({
      ...request.snapshot,
      userRequest: request.userRequest
    });

    const sections = PromptBuilder.fromRelevantContext({
      systemPrompt: request.systemPrompt,
      userRequest: request.userRequest,
      context: relevantContext,
      toolInstructions: request.toolInstructions
    });

    const prompt = this.promptBuilder.build(sections);

    const streaming = await this.generationEngine.generateStreaming(
      prompt.messages,
      {
        model: this.config.defaultModel,
        temperature: this.config.temperature,
        topP: this.config.topP,
        topK: this.config.topK,
        maxTokens: this.config.maxTokens,
        timeoutMs: this.config.timeoutMs,
        stream: true
      },
      {
        estimatedPromptTokens: prompt.estimatedTokens,
        requireLowLatency: request.requireLowLatency,
        preferCloudForQuality: request.preferCloudForQuality,
        mode: request.mode
      }
    );

    let aggregate = "";

    const consume = async (): Promise<void> => {
      try {
        for await (const token of streaming.stream) {
          aggregate += token;
          callbacks.onToken?.(token, aggregate);
        }

        callbacks.onComplete?.({
          text: aggregate,
          provider: streaming.route.provider,
          model: streaming.route.model,
          reason: streaming.route.reason,
          mode: streaming.route.mode,
          estimatedPromptTokens: prompt.estimatedTokens
        });
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        log.error("Side chat streaming error", normalized.message);
        callbacks.onError?.(normalized);
      }
    };

    void consume();

    return {
      abort: () => streaming.abort()
    };
  }
}
