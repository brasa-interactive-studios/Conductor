// NOTE: This workspace semantic index is intentionally lightweight.
// It indexes a bounded set of files and chunks for faster local lookup,
// but it is not yet a full-repo semantic index or native Copilot-style
// tool execution engine.

import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";

interface IndexedChunk {
  filePath: string;
  content: string;
  embedding?: number[];
}

interface IndexCacheEntry {
  repoPath: string;
  builtAt: number;
  chunks: IndexedChunk[];
}

export interface SemanticWorkspaceIndexConfig {
  ollamaBaseUrl: string;
  embeddingModel: string;
  maxFiles: number;
  maxChunkChars: number;
  reindexIntervalMs: number;
}

export class SemanticWorkspaceIndex {
  private readonly cache = new Map<string, IndexCacheEntry>();

  constructor(private readonly config: SemanticWorkspaceIndexConfig) {}

  async ensureIndexed(workspaceKey: string, repoPath: string): Promise<void> {
    // TODO: expand this from a sampled local workspace index into a full-repo
    // semantic index and tool-execution pipeline in the future.
    const current = this.cache.get(workspaceKey);
    const now = Date.now();

    if (
      current &&
      current.repoPath === repoPath &&
      now - current.builtAt < this.config.reindexIntervalMs &&
      current.chunks.length > 0
    ) {
      return;
    }

    const files = await this.collectCandidateFiles(repoPath);
    const chunks: IndexedChunk[] = [];

    for (const filePath of files.slice(0, this.config.maxFiles)) {
      const content = await this.readChunk(filePath);
      if (!content) continue;

      const embedding = await this.embed(content);
      chunks.push({ filePath, content, embedding });
    }

    this.cache.set(workspaceKey, {
      repoPath,
      builtAt: now,
      chunks
    });
  }

  async search(workspaceKey: string, query: string, limit: number): Promise<Array<{ filePath: string; content: string; similarity: number }>> {
    const entry = this.cache.get(workspaceKey);
    if (!entry || entry.chunks.length === 0) return [];

    const queryEmbedding = await this.embed(query);
    const queryKeywords = this.extractKeywords(query);

    return entry.chunks
      .map((chunk) => {
        const semantic = queryEmbedding && chunk.embedding && chunk.embedding.length > 0
          ? this.cosineSimilarity(queryEmbedding, chunk.embedding)
          : 0;
        const lexical = this.lexicalSimilarity(queryKeywords, chunk.filePath, chunk.content);

        const similarity = semantic > 0 ? semantic * 0.75 + lexical * 0.25 : lexical;
        return {
          filePath: chunk.filePath,
          content: chunk.content,
          similarity
        };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .filter((item) => item.similarity > 0.08);
  }

  private async collectCandidateFiles(repoPath: string): Promise<string[]> {
    const includeExt = new Set([
      ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".yml", ".yaml",
      ".py", ".go", ".rs", ".c", ".h", ".cpp", ".hpp", ".cs", ".lua", ".gd"
    ]);
    const ignoreDirs = new Set(["node_modules", ".git", "dist", ".turbo", ".next", "build", ".run", ".logs"]);

    const result: string[] = [];
    const stack: string[] = [repoPath];

    while (stack.length > 0 && result.length < this.config.maxFiles * 2) {
      const dir = stack.pop();
      if (!dir) continue;

      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!ignoreDirs.has(entry.name)) {
            stack.push(join(dir, entry.name));
          }
          continue;
        }

        const fullPath = join(dir, entry.name);
        const ext = extname(entry.name).toLowerCase();
        if (!includeExt.has(ext)) continue;
        result.push(fullPath);

        if (result.length >= this.config.maxFiles * 2) break;
      }
    }

    return result;
  }

  private async readChunk(filePath: string): Promise<string | undefined> {
    try {
      const raw = await readFile(filePath, "utf8");
      const cleaned = raw.trim();
      if (!cleaned) return undefined;
      return cleaned.slice(0, this.config.maxChunkChars);
    } catch {
      return undefined;
    }
  }

  private async embed(text: string): Promise<number[] | undefined> {
    try {
      const res = await fetch(`${this.config.ollamaBaseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.embeddingModel,
          prompt: text
        })
      });

      if (!res.ok) return undefined;
      const payload = (await res.json()) as { embedding?: number[] };
      return payload.embedding;
    } catch {
      return undefined;
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dot = a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);
    const normA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
    const normB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
    if (!normA || !normB) return 0;
    return dot / (normA * normB);
  }

  private lexicalSimilarity(queryKeywords: string[], filePath: string, content: string): number {
    if (queryKeywords.length === 0) return 0;

    const pathLower = filePath.toLowerCase();
    const head = content.slice(0, 2200).toLowerCase();
    let score = 0;

    for (const kw of queryKeywords) {
      if (pathLower.includes(kw)) score += 0.18;
      if (head.includes(kw)) score += 0.1;
    }

    if (pathLower.endsWith(".cpp") || pathLower.endsWith(".h") || pathLower.endsWith(".hpp")) score += 0.08;
    if (pathLower.endsWith(".ts") || pathLower.endsWith(".tsx")) score += 0.05;
    if (pathLower.includes("src/") || pathLower.includes("scripts/")) score += 0.04;

    return Math.min(1, score);
  }

  private extractKeywords(query: string): string[] {
    const stop = new Set(["the", "and", "for", "with", "from", "that", "this", "have", "will", "make", "using", "como", "para"]);
    return query
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2 && !stop.has(w))
      .slice(0, 14);
  }
}
