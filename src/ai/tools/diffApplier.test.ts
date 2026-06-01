import { describe, expect, it } from "vitest";
import { DiffApplier } from "@/ai/tools/diffApplier";

describe("DiffApplier", () => {
  it("applies patch when old text matches", async () => {
    let current = "const a = 1;";
    const applier = new DiffApplier({
      readFile: async () => current,
      writeFile: async (_path, content) => {
        current = content;
      }
    });

    const result = await applier.applyPatches([
      { filePath: "/repo/a.ts", oldText: "const a = 1;", newText: "const a = 2;" }
    ]);

    expect(result[0]).toEqual({ filePath: "/repo/a.ts", applied: true });
    expect(current).toBe("const a = 2;");
  });

  it("fails in strict mode if old text does not match", async () => {
    const applier = new DiffApplier({
      readFile: async () => "const a = 1;",
      writeFile: async () => undefined
    });

    const result = await applier.applyPatches(
      [{ filePath: "/repo/a.ts", oldText: "const a = 999;", newText: "const a = 2;" }],
      { strictOldTextMatch: true }
    );

    expect(result[0].applied).toBe(false);
    expect(result[0].reason).toContain("Old text does not match");
  });

  it("applies full replacement in non-strict mode", async () => {
    let current = "const a = 1;";
    const applier = new DiffApplier({
      readFile: async () => current,
      writeFile: async (_path, content) => {
        current = content;
      }
    });

    const result = await applier.applyPatches(
      [{ filePath: "/repo/a.ts", oldText: "does-not-exist", newText: "updated" }],
      { strictOldTextMatch: false }
    );

    expect(result[0].applied).toBe(true);
    expect(current).toBe("const a = 1;");
  });

  it("captures IO errors and returns failed result", async () => {
    const applier = new DiffApplier({
      readFile: async () => "const a = 1;",
      writeFile: async () => {
        throw new Error("disk unavailable");
      }
    });

    const result = await applier.applyPatches([
      { filePath: "/repo/a.ts", oldText: "const a = 1;", newText: "const a = 2;" }
    ]);

    expect(result[0].applied).toBe(false);
    expect(result[0].reason).toContain("disk unavailable");
  });
});
