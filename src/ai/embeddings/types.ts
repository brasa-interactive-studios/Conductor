export interface EmbeddingResult {
  text: string;
  embedding: number[];
}

export interface WorkspaceEmbedding {
  filePath: string;
  chunkId: string;
  content: string;
  embedding: number[];
  tokens: number;
}

export interface RAGSearchResult {
  filePath: string;
  content: string;
  similarity: number;
  reason: string;
}
