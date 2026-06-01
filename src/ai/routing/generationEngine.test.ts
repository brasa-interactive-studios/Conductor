import { describe, expect, it, vi } from "vitest";
import { GenerationEngine } from "@/ai/routing/generationEngine";
import { AIProvider, ChatMessage, GenerationOptions, GenerationResult, StreamGenerationResult } from "@/types/contracts";

const messages: ChatMessage[] = [{ role: "user", content: "hello" }];

const providerFactory = (text: string): AIProvider => ({
  name: `provider-${text}`,
  isHealthy: async () => true,
  listModels: async () => ["model"],
  generate: async (_messages: ChatMessage[], _options: GenerationOptions): Promise<GenerationResult> => ({
    text,
    stopReason: "stop"
  }),
  generateStreaming: async (): Promise<StreamGenerationResult> => ({
    stream: (async function* () {
      yield text;
    })(),
    abort: () => undefined
  })
});

describe("GenerationEngine", () => {
  it("uses routed provider and model for non-stream generation", async () => {
    const route = vi.fn(async () => ({
      providerKey: "local" as const,
      model: "qwen2.5-coder:14b",
      decision: { provider: "local" as const, model: "qwen2.5-coder:14b", reason: "local healthy" }
    }));

    const engine = new GenerationEngine(
      { route } as never,
      { local: providerFactory("local-output") },
      { fallbackModel: "fallback" }
    );

    const result = await engine.generate(messages, { model: "" });

    expect(route).toHaveBeenCalled();
    expect(result.route.provider).toBe("local");
    expect(result.result.text).toBe("local-output");
  });

  it("uses fallback provider when routed provider is missing", async () => {
    const engine = new GenerationEngine(
      {
        route: async () => ({
          providerKey: "cloud" as const,
          model: "cloud-model",
          decision: { provider: "cloud" as const, model: "cloud-model", reason: "cloud selected" }
        })
      } as never,
      { local: providerFactory("fallback-local") },
      { fallbackModel: "fallback-model" }
    );

    const result = await engine.generate(messages, { model: "" });

    expect(result.route.provider).toBe("local");
    expect(result.route.reason).toContain("fallback-provider-used");
    expect(result.result.text).toBe("fallback-local");
  });

  it("throws when no providers are configured", async () => {
    const engine = new GenerationEngine(
      {
        route: async () => ({
          providerKey: "cloud" as const,
          model: "cloud-model",
          decision: { provider: "cloud" as const, model: "cloud-model", reason: "cloud selected" }
        })
      } as never,
      {}
    );

    await expect(engine.generate(messages, { model: "" })).rejects.toThrow("No AI provider configured");
  });

  it("returns stream and forwards abort for streaming generation", async () => {
    const abort = vi.fn();
    const engine = new GenerationEngine(
      {
        route: async () => ({
          providerKey: "local" as const,
          model: "qwen-model",
          decision: { provider: "local" as const, model: "qwen-model", reason: "local" }
        })
      } as never,
      {
        local: {
          ...providerFactory("ignored"),
          generateStreaming: async () => ({
            stream: (async function* () {
              yield "a";
              yield "b";
            })(),
            abort
          })
        }
      }
    );

    const result = await engine.generateStreaming(messages, { model: "" });
    const tokens: string[] = [];

    for await (const t of result.stream) {
      tokens.push(t);
    }

    result.abort();

    expect(result.route.provider).toBe("local");
    expect(tokens.join("")).toBe("ab");
    expect(abort).toHaveBeenCalled();
  });

  it("passes computed estimated tokens to router hints", async () => {
    const route = vi.fn(async () => ({
      providerKey: "local" as const,
      model: "qwen",
      decision: { provider: "local" as const, model: "qwen", reason: "ok" }
    }));

    const engine = new GenerationEngine({ route } as never, { local: providerFactory("ok") });
    await engine.generate([{ role: "user", content: "12345678" }], { model: "" });

    expect(route).toHaveBeenCalledWith(expect.objectContaining({ estimatedPromptTokens: 2 }));
  });
});
