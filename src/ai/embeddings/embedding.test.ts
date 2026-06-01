import { describe, expect, it, vi } from "vitest";
import { EmbeddingService } from "@/ai/embeddings/embeddingService";
import { RAGPipeline } from "@/ai/embeddings/ragPipeline";

describe("EmbeddingService", () => {
  it("calls ollama embeddings API and returns vector", async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3] })
    }));
    global.fetch = mockFetch as never;

    const service = new EmbeddingService({
      ollamaUrl: "http://localhost:11434",
      model: "mxbai-embed-large"
    });

    const result = await service.embed("hello");

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("embeddings"), expect.any(Object));
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it("returns false for isHealthy on error", async () => {
    const mockFetch = vi.fn(async () => ({
      ok: false,
      status: 500
    }));
    global.fetch = mockFetch as never;

    const service = new EmbeddingService({
      ollamaUrl: "http://localhost:11434",
      model: "mxbai-embed-large"
    });

    const healthy = await service.isHealthy();
    expect(healthy).toBe(false);
  });
});

describe("RAGPipeline", () => {
  it("indexes files and ranks by cosine similarity", async () => {
    const embedService = {
      embed: vi.fn(async (text: string) => {
        const hashes = text.split("").map((c) => c.charCodeAt(0) % 10);
        return new Array(1024).fill(0).map((_, i) => hashes[i % hashes.length] / 10);
      }),
      embedBatch: vi.fn(),
      isHealthy: vi.fn(async () => true)
    };

    const pipeline = new RAGPipeline(embedService as never, { topK: 10, similarityThreshold: 0.1 });

    await pipeline.indexFiles([
      { filePath: "/file1.ts", content: "export function foo() {}" },
      { filePath: "/file2.ts", content: "export function bar() {}" }
    ]);

    const results = await pipeline.search("function foo", 2);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].filePath).toBeDefined();
    expect(results[0].similarity).toBeGreaterThan(0);
  });

  it("returns empty array when no embeddings indexed", async () => {
    const embedService = {
      embed: vi.fn(),
      embedBatch: vi.fn(),
      isHealthy: vi.fn()
    };

    const pipeline = new RAGPipeline(embedService as never);
    const results = await pipeline.search("test");

    expect(results).toEqual([]);
  });

  it("respects similarity threshold", async () => {
    const embedService = {
      embed: vi.fn(async (text: string) => {
        if (text === "query") return new Array(1024).fill(0);
        return new Array(1024).fill(0.1);
      }),
      embedBatch: vi.fn(),
      isHealthy: vi.fn()
    };

    const pipeline = new RAGPipeline(embedService as never, { similarityThreshold: 0.9 });

    await pipeline.indexFiles([{ filePath: "/file.ts", content: "code" }]);
    const results = await pipeline.search("query", 10);

    expect(results.length).toBe(0);
  });
});
