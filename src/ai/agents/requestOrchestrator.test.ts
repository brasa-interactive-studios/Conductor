import { describe, expect, it, vi } from "vitest";
import { RequestOrchestrator } from "@/ai/agents/requestOrchestrator";
import { EditorSnapshot, PromptBuildResult, PromptSections, RelevantContext } from "@/types/contracts";

const snapshot: EditorSnapshot = {
  activeFile: {
    path: "/repo/src/main.ts",
    content: "export const value = 1;",
    language: "ts",
    priority: 10,
    reason: "active"
  },
  openTabs: [],
  diagnostics: [],
  gitChangedFiles: [],
  userRequest: ""
};

describe("RequestOrchestrator", () => {
  it("builds prompt, routes with mode, and returns trace", async () => {
    const context: RelevantContext = {
      activeFile: snapshot.activeFile,
      relatedFiles: [
        {
          path: "/repo/src/helper.ts",
          content: "export function helper() {}",
          language: "ts",
          priority: 5,
          reason: "import"
        }
      ],
      diagnostics: [{ filePath: "/repo/src/main.ts", line: 2, message: "x", severity: "warning" }],
      imports: ["./helper"],
      totalEstimatedTokens: 40
    };

    const contextEngine = {
      build: vi.fn(() => context)
    };

    const promptBuilder = {
      build: vi.fn(
        (_sections: PromptSections): PromptBuildResult => ({
          messages: [{ role: "user", content: "hello" }],
          estimatedTokens: 123
        })
      )
    };

    const modelRouter = {
      route: vi.fn(async () => ({
        providerKey: "cloud" as const,
        model: "gpt-5.3-codex",
        decision: {
          provider: "cloud" as const,
          model: "gpt-5.3-codex",
          reason: "mode=hybrid, selected=cloud",
          mode: "hybrid" as const
        }
      }))
    };

    const ragPipeline = {
      search: vi.fn(async () => []),
      indexFiles: vi.fn(),
      clear: vi.fn()
    };

    const orchestrator = new RequestOrchestrator(
      contextEngine as never,
      promptBuilder as never,
      modelRouter as never,
      ragPipeline as never,
      { defaultSystemPrompt: "system" }
    );

    const result = await orchestrator.orchestrate({
      workspaceId: "ws-1",
      userPrompt: "Fix failing tests",
      mode: "hybrid",
      snapshot
    });

    expect(contextEngine.build).toHaveBeenCalled();
    expect(modelRouter.route).toHaveBeenCalledWith(expect.objectContaining({ mode: "hybrid", estimatedPromptTokens: 123 }));
    expect(result.route.mode).toBe("hybrid");
    expect(result.trace.mode).toBe("hybrid");
    expect(result.trace.includedFiles).toEqual(["/repo/src/main.ts", "/repo/src/helper.ts"]);
    expect(result.trace.usedFallback).toBe(false);
  });
});
