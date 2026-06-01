import { ContextEngine } from "@/ai/context/contextEngine";
import { RAGSearchResult } from "@/ai/embeddings/types";
import { PromptBuilder } from "@/ai/prompts/promptBuilder";
import { ModelRouter } from "@/ai/routing/modelRouter";
import { OrchestrationRequest, OrchestrationResult } from "@/types/contracts";
import { RAGPipeline } from "@/ai/embeddings/ragPipeline";

export interface RequestOrchestratorConfig {
  defaultSystemPrompt: string;
  toolInstructions?: string;
}

export class RequestOrchestrator {
  constructor(
    private readonly contextEngine: ContextEngine,
    private readonly promptBuilder: PromptBuilder,
    private readonly modelRouter: ModelRouter,
    private readonly ragPipeline: RAGPipeline,
    private readonly config: RequestOrchestratorConfig
  ) {}

  async orchestrate(request: OrchestrationRequest): Promise<OrchestrationResult> {
    let ragResults: RAGSearchResult[] = [];
    if (request.mode === "copilot-managed" || request.mode === "hybrid") {
      ragResults = await this.ragPipeline.search(request.userPrompt, 5);
    }

    const contextEngine =
      ragResults.length > 0
        ? new ContextEngine({ maxContextTokens: 12000, maxFiles: 8, includeDiagnostics: true }, ragResults)
        : this.contextEngine;

    const context = contextEngine.build({
      ...request.snapshot,
      userRequest: request.userPrompt
    });

    const sections = PromptBuilder.fromRelevantContext({
      systemPrompt: this.config.defaultSystemPrompt,
      userRequest: request.userPrompt,
      context,
      toolInstructions: this.config.toolInstructions
    });

    let usedFallback = false;
    if (!sections.fileSummaries.trim()) {
      usedFallback = true;
      sections.fileSummaries = "No relevant file context available.";
    }

    const prompt = this.promptBuilder.build(sections);
    const routed = await this.modelRouter.route({
      mode: request.mode,
      estimatedPromptTokens: prompt.estimatedTokens,
      requireLowLatency: request.preferLowLatency,
      preferCloudForQuality: request.preferQuality
    });

    return {
      route: routed.decision,
      prompt,
      trace: {
        mode: request.mode,
        includedFiles: [
          ...(context.activeFile ? [context.activeFile.path] : []),
          ...context.relatedFiles.map((f) => f.path)
        ],
        diagnosticsCount: context.diagnostics.length,
        estimatedPromptTokens: prompt.estimatedTokens,
        usedFallback
      }
    };
  }
}
