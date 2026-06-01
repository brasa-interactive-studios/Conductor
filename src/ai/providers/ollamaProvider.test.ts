import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaProvider } from "@/ai/providers/ollamaProvider";
import { ChatMessage } from "@/types/contracts";

const messages: ChatMessage[] = [{ role: "user", content: "hello" }];

const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });

describe("OllamaProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("checks health from /api/tags", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ models: [] }, 200)));
    const provider = new OllamaProvider({
      baseUrl: "http://localhost:11434",
      timeoutMs: 10_000,
      retries: 0,
      retryDelayMs: 1,
      defaultContextWindow: 8192
    });

    await expect(provider.isHealthy()).resolves.toBe(true);
  });

  it("lists model names from ollama tags endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ models: [{ name: "qwen2.5-coder:14b" }, { name: "llama3.1:8b" }] }, 200))
    );

    const provider = new OllamaProvider({
      baseUrl: "http://localhost:11434",
      timeoutMs: 10_000,
      retries: 0,
      retryDelayMs: 1,
      defaultContextWindow: 8192
    });

    await expect(provider.listModels()).resolves.toEqual(["qwen2.5-coder:14b", "llama3.1:8b"]);
  });

  it("streams chat chunks and aggregates generate() output", async () => {
    const body = [
      JSON.stringify({ done: false, message: { role: "assistant", content: "Hel" } }),
      JSON.stringify({ done: false, message: { role: "assistant", content: "lo" } }),
      JSON.stringify({ done: true })
    ].join("\n");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (!init) return jsonResponse({ models: [] }, 200);
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(body + "\n"));
            controller.close();
          }
        });

        return new Response(stream, { status: 200 });
      })
    );

    const provider = new OllamaProvider({
      baseUrl: "http://localhost:11434",
      timeoutMs: 10_000,
      retries: 0,
      retryDelayMs: 1,
      defaultContextWindow: 8192
    });

    const stream = await provider.generateStreaming(messages, { model: "qwen2.5-coder:14b" });
    const chunks: string[] = [];
    for await (const token of stream.stream) {
      chunks.push(token);
    }

    expect(chunks.join("")).toBe("Hello");

    const result = await provider.generate(messages, { model: "qwen2.5-coder:14b" });
    expect(result.text).toBe("Hello");
    expect(result.stopReason).toBe("stop");
  });
});
