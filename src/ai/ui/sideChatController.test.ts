import { describe, expect, it, vi } from "vitest";
import { SideChatController } from "@/ai/ui/sideChatController";
import { RelevantContext, PromptBuildResult, PromptSections, EditorSnapshot } from "@/types/contracts";
import { log } from "@/utils/logger";

const waitForMicrotasks = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const snapshot: EditorSnapshot = {
  activeFile: {
    path: "/repo/src/active.ts",
    content: "const value = 1;",
    language: "ts",
    priority: 1,
    reason: "active"
  },
  openTabs: [],
  diagnostics: [],
  gitChangedFiles: [],
  userRequest: ""
};

describe("SideChatController", () => {
  it("streams tokens and calls completion callback", async () => {
    const context = {
      build: vi.fn(
        (): RelevantContext => ({
          activeFile: snapshot.activeFile,
          relatedFiles: [],
          diagnostics: [],
          imports: [],
          totalEstimatedTokens: 10
        })
      )
    };

    const promptBuilder = {
      build: vi.fn(
        (): PromptBuildResult => ({
          messages: [{ role: "user", content: "hello" }],
          estimatedTokens: 8
        })
      )
    };

    const abort = vi.fn();
    const generation = {
      generateStreaming: vi.fn(async () => ({
        route: { provider: "local" as const, model: "qwen", reason: "test" },
        stream: (async function* () {
          yield "hel";
          yield "lo";
        })(),
        abort
      }))
    };

    const controller = new SideChatController(context as never, promptBuilder as never, generation as never, {
      defaultModel: "qwen2.5-coder:14b",
      temperature: 0.1,
      topP: 0.9,
      topK: 40,
      maxTokens: 512,
      timeoutMs: 20_000
    });

    const tokens: string[] = [];
    const done = vi.fn();

    const handle = await controller.generateReply(
      {
        systemPrompt: "system",
        userRequest: "make change",
        snapshot
      },
      {
        onToken: (token, aggregate) => tokens.push(`${token}:${aggregate}`),
        onComplete: done
      }
    );

    await waitForMicrotasks();

    expect(context.build).toHaveBeenCalled();
    expect(promptBuilder.build).toHaveBeenCalled();
    expect(generation.generateStreaming).toHaveBeenCalled();
    expect(tokens).toEqual(["hel:hel", "lo:hello"]);
    expect(done).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "hello",
        provider: "local",
        model: "qwen",
        estimatedPromptTokens: 8
      })
    );

    handle.abort();
    expect(abort).toHaveBeenCalled();
  });

  it("reports stream errors via callback", async () => {
    const logSpy = vi.spyOn(log, "error").mockImplementation(() => undefined);

    const controller = new SideChatController(
      {
        build: () => ({ activeFile: snapshot.activeFile, relatedFiles: [], diagnostics: [], imports: [], totalEstimatedTokens: 1 })
      } as never,
      {
        build: (_sections: PromptSections): PromptBuildResult => ({
          messages: [{ role: "user", content: "x" }],
          estimatedTokens: 1
        })
      } as never,
      {
        generateStreaming: async () => ({
          route: { provider: "local" as const, model: "qwen", reason: "reason" },
          stream: (async function* () {
            throw new Error("stream broken");
          })(),
          abort: () => undefined
        })
      } as never,
      {
        defaultModel: "qwen2.5-coder:14b",
        temperature: 0.1,
        topP: 0.9,
        topK: 40,
        maxTokens: 512,
        timeoutMs: 20_000
      }
    );

    const onError = vi.fn();

    await controller.generateReply(
      {
        systemPrompt: "system",
        userRequest: "request",
        snapshot
      },
      { onError }
    );

    await waitForMicrotasks();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "stream broken" }));
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
