import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CommonConfig, createDefaultConfig, mergeCommonConfig } from "@vscode-ai/shared";

export class ConfigStore {
  private config: CommonConfig = createDefaultConfig();

  constructor(private readonly filePath: string) {}

  async load(): Promise<CommonConfig> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.config = JSON.parse(raw) as CommonConfig;
      return this.config;
    } catch {
      this.config = createDefaultConfig();
      await this.persist(this.config);
      return this.config;
    }
  }

  get(): CommonConfig {
    return this.config;
  }

  async patch(patch: Partial<CommonConfig>): Promise<CommonConfig> {
    this.config = mergeCommonConfig(this.config, patch);
    await this.persist(this.config);
    return this.config;
  }

  async set(config: CommonConfig): Promise<CommonConfig> {
    this.config = config;
    await this.persist(config);
    return this.config;
  }

  private async persist(config: CommonConfig): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(config, null, 2), "utf8");
  }
}
