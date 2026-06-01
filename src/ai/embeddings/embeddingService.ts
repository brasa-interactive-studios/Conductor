import { EmbeddingResult } from "./types";

export interface EmbeddingServiceConfig {
  ollamaUrl: string;
  model: string;
  timeoutMs?: number;
}

export class EmbeddingService {
  constructor(private readonly config: EmbeddingServiceConfig) {}

  async embed(text: string): Promise<number[]> {
    const payload = {
      model: this.config.model,
      prompt: text
    };

    const timeoutMs = this.config.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.config.ollamaUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Embedding API error: ${response.status}`);
      }

      const data = (await response.json()) as { embedding: number[] };
      return data.embedding;
    } finally {
      clearTimeout(timeout);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }

  async isHealthy(): Promise<boolean> {
    try {
      const result = await this.embed("health-check");
      return Array.isArray(result) && result.length > 0;
    } catch {
      return false;
    }
  }
}
