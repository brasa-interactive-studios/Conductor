import { PromptBuildResult, PromptSections, RelevantContext } from "@/types/contracts";
import { estimateTokens } from "@/utils/tokens";

export class PromptBuilder {
  build(sections: PromptSections): PromptBuildResult {
    const messages = [
      { role: "system" as const, content: sections.systemPrompt },
      { role: "system" as const, content: sections.repositoryContext },
      { role: "system" as const, content: sections.fileSummaries },
      ...(sections.toolInstructions ? [{ role: "system" as const, content: sections.toolInstructions }] : []),
      { role: "user" as const, content: sections.userRequest }
    ];

    const estimatedTokens = messages.reduce((acc, m) => acc + estimateTokens(m.content), 0);
    return { messages, estimatedTokens };
  }

  static fromRelevantContext(input: {
    systemPrompt: string;
    userRequest: string;
    context: RelevantContext;
    toolInstructions?: string;
  }): PromptSections {
    const relatedFiles = [...input.context.relatedFiles].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.path.localeCompare(b.path);
    });

    const diagnostics = [...input.context.diagnostics].sort((a, b) => {
      if (a.severity !== b.severity) return a.severity.localeCompare(b.severity);
      if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
      return a.line - b.line;
    });

    const fileSummaries = [
      input.context.activeFile ? this.formatFile(input.context.activeFile, "ACTIVE") : "",
      ...relatedFiles.map((f) => this.formatFile(f, "RELATED")),
      this.formatDiagnostics(diagnostics)
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      systemPrompt: input.systemPrompt,
      repositoryContext: this.buildRepositoryContext(input.context.imports),
      userRequest: input.userRequest,
      toolInstructions: input.toolInstructions,
      fileSummaries
    };
  }

  private static formatFile(file: { path: string; language: string; content: string; reason: string }, label: string): string {
    return `[${label}] ${file.path} (${file.reason})\n\`\`\`${file.language}\n${file.content}\n\`\`\``;
  }

  private static formatDiagnostics(diags: Array<{ filePath: string; line: number; severity: string; message: string }>): string {
    if (diags.length === 0) return "";
    return `Diagnostics:\n${diags.map((d) => `- ${d.severity.toUpperCase()} ${d.filePath}:${d.line} ${d.message}`).join("\n")}`;
  }

  private static buildRepositoryContext(imports: string[]): string {
    const unique = [...new Set(imports)].sort((a, b) => a.localeCompare(b));
    const importsLine = unique.length > 0 ? unique.join(", ") : "none";
    return ["Repository context", `imports: ${importsLine}`].join("\n");
  }
}
