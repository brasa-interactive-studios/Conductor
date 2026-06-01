import {
  ChatMessage,
  GenerationOptions,
  GenerationResult,
  ProviderRegistry,
  StreamGenerationResult
} from "@/types/contracts";
import { estimateTokens } from "@/utils/tokens";
import { ModelRouter, ModelRoutingHints } from "@/ai/routing/modelRouter";

export interface GenerationEngineResult {
  route: {
    provider: "local" | "cloud";
    model: string;
    reason: string;
    mode?: "copilot-managed" | "local-ollama" | "hybrid";
  };
  result: GenerationResult;
}

export interface GenerationEngineStreamResult {
  route: {
    provider: "local" | "cloud";
    model: string;
    reason: string;
    mode?: "copilot-managed" | "local-ollama" | "hybrid";
  };
  stream: AsyncGenerator<string, void, unknown>;
  abort: () => void;
}

export interface GenerationEngineConfig {
  fallbackModel?: string;
}

export class GenerationEngine {
  constructor(
    private readonly router: ModelRouter,
    private readonly providers: ProviderRegistry,
    private readonly config: GenerationEngineConfig = {}
  ) {}

  async generate(messages: ChatMessage[], options: GenerationOptions, hints: ModelRoutingHints = {}): Promise<GenerationEngineResult> {
    const routed = await this.resolveProviderAndModel(messages, options, hints);
    const result = await routed.provider.generate(messages, { ...options, model: routed.model });

    return {
      route: {
        provider: routed.providerKey,
        model: routed.model,
        reason: routed.reason,
        mode: routed.mode
      },
      result
    };
  }

  async generateStreaming(
    messages: ChatMessage[],
    options: GenerationOptions,
    hints: ModelRoutingHints = {}
  ): Promise<GenerationEngineStreamResult> {
    const routed = await this.resolveProviderAndModel(messages, options, hints);
    const streamResult: StreamGenerationResult = await routed.provider.generateStreaming(messages, {
      ...options,
      model: routed.model,
      stream: true
    });

    return {
      route: {
        provider: routed.providerKey,
        model: routed.model,
        reason: routed.reason,
        mode: routed.mode
      },
      stream: streamResult.stream,
      abort: streamResult.abort
    };
  }

  private async resolveProviderAndModel(messages: ChatMessage[], options: GenerationOptions, hints: ModelRoutingHints) {
    const estimatedPromptTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    const route = await this.router.route({
      ...hints,
      estimatedPromptTokens: hints.estimatedPromptTokens ?? estimatedPromptTokens
    });

    const provider = route.providerKey === "local" ? this.providers.local : this.providers.cloud;
    if (provider) {
      return {
        provider,
        providerKey: route.providerKey,
        model: options.model || route.model,
        reason: route.decision.reason,
        mode: route.decision.mode
      };
    }

    const fallbackProvider = this.providers.local ?? this.providers.cloud;
    if (!fallbackProvider) {
      throw new Error("No AI provider configured");
    }

    return {
      provider: fallbackProvider,
      providerKey: this.providers.local ? "local" as const : "cloud" as const,
      model: options.model || this.config.fallbackModel || route.model,
      reason: `${route.decision.reason}, fallback-provider-used`,
      mode: route.decision.mode
    };
  }
}
