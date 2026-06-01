import { DiagnosticInfo, EditorSnapshot, FileContext, RelevantContext } from "@/types/contracts";
import { RAGSearchResult } from "@/ai/embeddings/types";
import { clipToTokenBudget, estimateTokens } from "@/utils/tokens";

export interface ContextEngineConfig {
  maxContextTokens: number;
  maxFiles: number;
  includeDiagnostics: boolean;
}

export class ContextEngine {
  constructor(private readonly config: ContextEngineConfig, private readonly ragResults?: RAGSearchResult[]) {}

  build(snapshot: EditorSnapshot): RelevantContext {
    const imports = this.extractImports(snapshot.activeFile?.content ?? "");
    const candidates = this.deduplicateFiles(snapshot.openTabs);
    const ragFiles = this.ragResults?.map((r) => ({
      path: r.filePath,
      content: r.content,
      language: this.inferLanguage(r.filePath),
      priority: 8 + Math.round(r.similarity * 2),
      reason: r.reason
    })) ?? [];
    const allCandidates = this.deduplicateFiles([...candidates, ...ragFiles]);
    const ranked = this.rankFiles(allCandidates, snapshot.gitChangedFiles, imports, snapshot.userRequest);

    const selected: FileContext[] = [];
    let used = 0;
    const activePath = snapshot.activeFile?.path;

    for (const file of ranked) {
      if (activePath && file.path === activePath) continue;
      if (selected.length >= this.config.maxFiles) break;
      const budgetLeft = this.config.maxContextTokens - used;
      if (budgetLeft <= 0) break;
      const content = this.compressContent(file.content, budgetLeft);
      const tokens = estimateTokens(content);
      used += tokens;
      selected.push({ ...file, content });
    }

    const activeFile = snapshot.activeFile
      ? {
          ...snapshot.activeFile,
          content: this.compressContent(
            snapshot.activeFile.content,
            Math.max(256, Math.floor(this.config.maxContextTokens * 0.35))
          )
        }
      : undefined;

    if (activeFile) {
      used += estimateTokens(activeFile.content);
    }

    const diagnostics = this.config.includeDiagnostics
      ? this.rankDiagnostics(snapshot.diagnostics, snapshot.activeFile?.path)
      : [];

    return {
      activeFile,
      relatedFiles: selected,
      diagnostics,
      imports,
      totalEstimatedTokens: used
    };
  }

  private extractImports(content: string): string[] {
    const matches = new Set<string>();
    const regex = /from\s+['\"]([^'\"]+)['\"]|require\(['\"]([^'\"]+)['\"]\)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content)) !== null) {
      const ref = m[1] ?? m[2];
      if (ref) matches.add(ref);
    }
    return [...matches];
  }

  private rankFiles(files: FileContext[], changed: string[], imports: string[], request: string): FileContext[] {
    const changedSet = new Set(changed);
    const importSet = new Set(imports);
    const words = this.extractKeywords(request);

    return [...files]
      .map((f) => {
        let score = f.priority;
        if (changedSet.has(f.path)) score += 4;
        if ([...importSet].some((i) => f.path.includes(i))) score += 3;
        if (words.some((w) => f.path.toLowerCase().includes(w))) score += 2;
        if (words.some((w) => f.content.toLowerCase().includes(w))) score += 2;
        if (f.path.endsWith(".test.ts") || f.path.endsWith(".spec.ts")) score -= 1;
        return { ...f, priority: score };
      })
      .sort((a, b) => b.priority - a.priority);
  }

  private rankDiagnostics(diags: DiagnosticInfo[], activeFilePath?: string): DiagnosticInfo[] {
    return [...diags]
      .sort((a, b) => this.diagWeight(b, activeFilePath) - this.diagWeight(a, activeFilePath))
      .slice(0, 20);
  }

  private diagWeight(diag: DiagnosticInfo, activeFilePath?: string): number {
    let score = 0;
    if (diag.severity === "error") score += 3;
    if (diag.severity === "warning") score += 2;
    if (activeFilePath && diag.filePath === activeFilePath) score += 3;
    return score;
  }

  private deduplicateFiles(files: FileContext[]): FileContext[] {
    const byPath = new Map<string, FileContext>();
    for (const file of files) {
      const existing = byPath.get(file.path);
      if (!existing || file.priority > existing.priority) {
        byPath.set(file.path, file);
      }
    }
    return [...byPath.values()];
  }

  private extractKeywords(request: string): string[] {
    const stopWords = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "como", "para"]);
    return request
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > 2 && !stopWords.has(word));
  }

  private compressContent(content: string, budget: number): string {
    const normalized = this.removeConsecutiveDuplicateLines(content);
    if (estimateTokens(normalized) <= budget) {
      return clipToTokenBudget(normalized, budget);
    }

    const charBudget = Math.max(0, budget * 4);
    const head = Math.floor(charBudget * 0.65);
    const tail = Math.max(0, charBudget - head);
    const compact = `${normalized.slice(0, head)}\n... [middle omitted for relevance]\n${normalized.slice(-tail)}`;
    return clipToTokenBudget(compact, budget);
  }

  private removeConsecutiveDuplicateLines(content: string): string {
    const lines = content.split("\n");
    const compact: string[] = [];
    let previous = "";
    for (const line of lines) {
      if (line === previous && line.trim() !== "") continue;
      compact.push(line);
      previous = line;
    }
    return compact.join("\n");
  }

  private inferLanguage(filePath: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const langMap: Record<string, string> = {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      py: "python",
      go: "go",
      rs: "rust",
      java: "java",
      cpp: "cpp",
      c: "c",
      h: "c",
      hpp: "cpp"
    };
    return langMap[ext] ?? ext;
  }
}
