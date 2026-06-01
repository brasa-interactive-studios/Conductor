import { EmbeddingService } from "./embeddingService";
import { RAGSearchResult, WorkspaceEmbedding } from "./types";
import { estimateTokens } from "@/utils/tokens";

export interface RAGPipelineConfig {
  topK?: number;
  similarityThreshold?: number;
}

export class RAGPipeline {
  private embeddings: Map<string, WorkspaceEmbedding> = new Map();

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly config: RAGPipelineConfig = {}
  ) {}

  async indexFiles(files: Array<{ filePath: string; content: string }>): Promise<void> {
    const topK = this.config.topK ?? 10;

    for (const file of files.slice(0, topK * 2)) {
      const chunkId = `${file.filePath}#0`;
      const tokens = estimateTokens(file.content);

      if (tokens > 2000) continue;

      try {
        const embedding = await this.embeddingService.embed(file.content);
        this.embeddings.set(chunkId, {
          filePath: file.filePath,
          chunkId,
          content: file.content,
          embedding,
          tokens
        });
      } catch {
        continue;
      }
    }
  }

  async search(query: string, limit: number = 5): Promise<RAGSearchResult[]> {
    if (this.embeddings.size === 0) {
      return [];
    }

    try {
      const queryEmbedding = await this.embeddingService.embed(query);
      const threshold = this.config.similarityThreshold ?? 0.3;

      const ranked = [...this.embeddings.values()]
        .map((doc) => ({
          doc,
          similarity: this.cosineSimilarity(queryEmbedding, doc.embedding)
        }))
        .filter((r) => r.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      return ranked.map((r) => ({
        filePath: r.doc.filePath,
        content: r.doc.content,
        similarity: r.similarity,
        reason: `semantic-match (${(r.similarity * 100).toFixed(1)}%)`
      }));
    } catch {
      return [];
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, val, i) => sum + val * (b[i] ?? 0), 0);
    const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (normA * normB);
  }

  clear(): void {
    this.embeddings.clear();
  }
}
