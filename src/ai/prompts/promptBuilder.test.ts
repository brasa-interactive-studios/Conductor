import { describe, expect, it } from "vitest";
import { PromptBuilder } from "@/ai/prompts/promptBuilder";
import { RelevantContext } from "@/types/contracts";

describe("PromptBuilder", () => {
  it("builds deterministic sections from relevant context", () => {
    const context: RelevantContext = {
      activeFile: {
        path: "/repo/src/active.ts",
        content: "const active = true;",
        language: "ts",
        priority: 1,
        reason: "editor"
      },
      relatedFiles: [
        {
          path: "/repo/src/b.ts",
          content: "export const b = 1",
          language: "ts",
          priority: 2,
          reason: "rank2"
        },
        {
          path: "/repo/src/a.ts",
          content: "export const a = 1",
          language: "ts",
          priority: 2,
          reason: "rank2"
        }
      ],
      diagnostics: [
        { filePath: "/repo/src/z.ts", line: 4, message: "warn", severity: "warning" },
        { filePath: "/repo/src/a.ts", line: 2, message: "err", severity: "error" }
      ],
      imports: ["z-lib", "a-lib", "a-lib"],
      totalEstimatedTokens: 100
    };

    const sections = PromptBuilder.fromRelevantContext({
      systemPrompt: "system",
      userRequest: "request",
      context,
      toolInstructions: "tools"
    });

    expect(sections.repositoryContext).toBe("Repository context\nimports: a-lib, z-lib");
    expect(sections.fileSummaries.indexOf("/repo/src/a.ts")).toBeLessThan(sections.fileSummaries.indexOf("/repo/src/b.ts"));
    expect(sections.fileSummaries).toContain("ERROR");
    expect(sections.fileSummaries).toContain("WARNING");
  });

  it("builds messages and token estimation", () => {
    const builder = new PromptBuilder();
    const result = builder.build({
      systemPrompt: "s",
      repositoryContext: "r",
      userRequest: "u",
      toolInstructions: "t",
      fileSummaries: "f"
    });

    expect(result.messages).toHaveLength(5);
    expect(result.messages[0]).toEqual({ role: "system", content: "s" });
    expect(result.messages.at(-1)).toEqual({ role: "user", content: "u" });
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });
});
