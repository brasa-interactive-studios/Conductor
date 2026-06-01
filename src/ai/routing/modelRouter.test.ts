import { describe, expect, it } from "vitest";
import { ModelRouter } from "@/ai/routing/modelRouter";
import { AIProvider, GenerationOptions, StreamGenerationResult } from "@/types/contracts";

const streamEmpty = async function* (): AsyncGenerator<string, void, unknown> {
  return;
};

const provider = (healthy: boolean): AIProvider => ({
  name: healthy ? "healthy" : "unhealthy",
  isHealthy: async () => healthy,
  listModels: async () => [],
  generate: async (_messages, _options: GenerationOptions) => ({ text: "", stopReason: "stop" }),
  generateStreaming: async (): Promise<StreamGenerationResult> => ({ stream: streamEmpty(), abort: () => undefined })
});

describe("ModelRouter", () => {
  it("prefers local model when configured and local is healthy", async () => {
    const router = new ModelRouter(
      { defaultLocalModel: "qwen2.5-coder:14b", defaultCloudModel: "gpt-4.1", preferLocal: true },
      { local: provider(true), cloud: provider(true) }
    );

    const result = await router.route();

    expect(result.providerKey).toBe("local");
    expect(result.model).toBe("qwen2.5-coder:14b");
  });

  it("routes to cloud for very large prompt when cloud is healthy", async () => {
    const router = new ModelRouter(
      { defaultLocalModel: "qwen2.5-coder:14b", defaultCloudModel: "gpt-4.1", preferLocal: false },
      { local: provider(true), cloud: provider(true) }
    );

    const result = await router.route({ estimatedPromptTokens: 30_000 });

    expect(result.providerKey).toBe("cloud");
    expect(result.model).toBe("gpt-4.1");
    expect(result.decision.reason).toContain("estimatedPromptTokens=30000");
  });

  it("falls back to cloud when local is unhealthy", async () => {
    const router = new ModelRouter(
      { defaultLocalModel: "local", defaultCloudModel: "cloud", preferLocal: true },
      { local: provider(false), cloud: provider(true) }
    );

    const result = await router.route({ requireLowLatency: true });

    expect(result.providerKey).toBe("cloud");
    expect(result.decision.reason).toContain("selected=cloud");
  });

  it("uses cloud for copilot-managed mode when cloud is healthy", async () => {
    const router = new ModelRouter(
      { defaultLocalModel: "local", defaultCloudModel: "cloud", preferLocal: true },
      { local: provider(true), cloud: provider(true) }
    );

    const result = await router.route({ mode: "copilot-managed" });

    expect(result.providerKey).toBe("cloud");
    expect(result.decision.mode).toBe("copilot-managed");
  });

  it("uses local first for local-ollama mode", async () => {
    const router = new ModelRouter(
      { defaultLocalModel: "local", defaultCloudModel: "cloud", preferLocal: false },
      { local: provider(true), cloud: provider(true) }
    );

    const result = await router.route({ mode: "local-ollama" });

    expect(result.providerKey).toBe("local");
    expect(result.decision.mode).toBe("local-ollama");
  });

  it("falls back to local for hybrid mode when cloud is unhealthy", async () => {
    const router = new ModelRouter(
      { defaultLocalModel: "local", defaultCloudModel: "cloud", preferLocal: false },
      { local: provider(true), cloud: provider(false) }
    );

    const result = await router.route({ mode: "hybrid" });

    expect(result.providerKey).toBe("local");
    expect(result.decision.reason).toContain("mode=hybrid");
  });
});
