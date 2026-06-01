import { DiffPatch } from "@/types/contracts";

export interface DiffApplyResult {
  filePath: string;
  applied: boolean;
  reason?: string;
}

export interface DiffApplyOptions {
  strictOldTextMatch?: boolean;
}

export interface DiffApplierIO {
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;
}

export class DiffApplier {
  constructor(private readonly io: DiffApplierIO) {}

  async applyPatches(patches: DiffPatch[], options: DiffApplyOptions = {}): Promise<DiffApplyResult[]> {
    const results: DiffApplyResult[] = [];

    for (const patch of patches) {
      try {
        const result = await this.applySinglePatch(patch, options);
        results.push(result);
      } catch (error) {
        results.push({
          filePath: patch.filePath,
          applied: false,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return results;
  }

  private async applySinglePatch(patch: DiffPatch, options: DiffApplyOptions): Promise<DiffApplyResult> {
    const strictOldTextMatch = options.strictOldTextMatch ?? true;

    let current = "";
    try {
      current = await this.io.readFile(patch.filePath);
    } catch {
      current = "";
    }

    if (strictOldTextMatch && patch.oldText && !current.includes(patch.oldText)) {
      return {
        filePath: patch.filePath,
        applied: false,
        reason: "Old text does not match target file"
      };
    }

    const next = patch.oldText ? current.replace(patch.oldText, patch.newText) : patch.newText;

    await this.io.writeFile(patch.filePath, next);

    return {
      filePath: patch.filePath,
      applied: true
    };
  }
}
