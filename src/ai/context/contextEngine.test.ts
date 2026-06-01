import { describe, expect, it } from "vitest";
import { ContextEngine } from "@/ai/context/contextEngine";
import { EditorSnapshot, FileContext } from "@/types/contracts";

const baseFile = (overrides: Partial<FileContext>): FileContext => ({
  path: "/repo/src/default.ts",
  content: "export const value = 1;",
  language: "ts",
  priority: 1,
  reason: "default",
  ...overrides
});

describe("ContextEngine", () => {
  it("builds relevant context with imports, ranking and diagnostics", () => {
    const engine = new ContextEngine({
      maxContextTokens: 800,
      maxFiles: 3,
      includeDiagnostics: true
    });

    const active = baseFile({
      path: "/repo/src/active.ts",
      content: `import { helper } from "./utils/helper";\nconst x = require("@/shared")\n${"line\n".repeat(50)}`,
      reason: "active"
    });

    const duplicatePath = "/repo/src/utils/helper.ts";

    const snapshot: EditorSnapshot = {
      activeFile: active,
      openTabs: [
        active,
        baseFile({ path: duplicatePath, content: "export const helper = () => 1", priority: 1, reason: "tab1" }),
        baseFile({ path: duplicatePath, content: "export const helper = () => 2", priority: 5, reason: "tab2" }),
        baseFile({ path: "/repo/src/feature.ts", content: "new feature logic", priority: 2, reason: "changed" }),
        baseFile({ path: "/repo/src/feature.test.ts", content: "test content", priority: 6, reason: "test" })
      ],
      diagnostics: [
        { filePath: "/repo/src/feature.ts", line: 3, message: "warn", severity: "warning" },
        { filePath: "/repo/src/active.ts", line: 1, message: "err", severity: "error" },
        { filePath: "/repo/src/other.ts", line: 1, message: "info", severity: "info" }
      ],
      gitChangedFiles: ["/repo/src/feature.ts"],
      userRequest: "Refactor helper and feature implementation"
    };

    const result = engine.build(snapshot);

    expect(result.activeFile?.path).toBe("/repo/src/active.ts");
    expect(result.relatedFiles.map((f) => f.path)).not.toContain("/repo/src/active.ts");
    expect(result.relatedFiles.filter((f) => f.path === duplicatePath)).toHaveLength(1);
    expect(result.imports).toEqual(expect.arrayContaining(["./utils/helper", "@/shared"]));
    expect(result.diagnostics[0]).toMatchObject({ filePath: "/repo/src/active.ts", severity: "error" });
    expect(result.totalEstimatedTokens).toBeGreaterThan(0);
  });

  it("compresses oversized file content with deduplication", () => {
    const engine = new ContextEngine({
      maxContextTokens: 120,
      maxFiles: 1,
      includeDiagnostics: false
    });

    const hugeContent = `start\n${"middle line\n".repeat(1000)}end`;
    const snapshot: EditorSnapshot = {
      activeFile: baseFile({ path: "/repo/src/main.ts", content: hugeContent, reason: "active" }),
      openTabs: [baseFile({ path: "/repo/src/related.ts", content: hugeContent, reason: "related" })],
      diagnostics: [],
      gitChangedFiles: [],
      userRequest: "optimize middle lines"
    };

    const result = engine.build(snapshot);

    expect(result.activeFile?.content).toContain("start");
    expect(result.activeFile?.content).toContain("end");
    expect(result.activeFile?.content).not.toContain("middle line\nmiddle line");
    expect(result.relatedFiles[0].content).toContain("start");
    expect(result.relatedFiles[0].content).toContain("end");
  });
});
