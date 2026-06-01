import { AIProvider, ChatMessage, GenerationOptions, GenerationResult, StreamGenerationResult } from "@/types/contracts";
import { withRetry } from "@/utils/retry";

interface OllamaChatChunk {
  done: boolean;
  message?: { role: "assistant"; content: string };
}

export interface OllamaProviderConfig {
  baseUrl: string;
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
  defaultContextWindow: number;
}

export class OllamaProvider implements AIProvider {
  public readonly name = "ollama";

  constructor(private readonly config: OllamaProviderConfig) {}

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.config.baseUrl}/api/tags`);
    if (!response.ok) return [];
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  }

  async generate(messages: ChatMessage[], options: GenerationOptions): Promise<GenerationResult> {
    const streamResult = await this.generateStreaming(messages, options);
    let text = "";
    for await (const token of streamResult.stream) {
      text += token;
    }
    return { text, stopReason: "stop" };
  }

  async generateStreaming(messages: ChatMessage[], options: GenerationOptions): Promise<StreamGenerationResult> {
    const controller = new AbortController();

    if (options.abortSignal) {
      options.abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    const requestBody = {
      model: options.model,
      messages,
      stream: true,
      options: {
        temperature: options.temperature,
        top_p: options.topP,
        top_k: options.topK,
        num_predict: options.maxTokens,
        num_ctx: options.contextWindow ?? this.config.defaultContextWindow
      }
    };

    const response = await withRetry(
      async () => {
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.config.timeoutMs);
        try {
          const res = await fetch(`${this.config.baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          });
          if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
          return res;
        } finally {
          clearTimeout(timeout);
        }
      },
      { retries: this.config.retries, baseDelayMs: this.config.retryDelayMs }
    );

    const stream = this.parseStream(response);
    return {
      stream,
      abort: () => controller.abort()
    };
  }

  private async *parseStream(response: Response): AsyncGenerator<string, void, unknown> {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line) as OllamaChatChunk;
        if (chunk.message?.content) {
          yield chunk.message.content;
        }
        if (chunk.done) {
          return;
        }
      }
    }
  }
}
