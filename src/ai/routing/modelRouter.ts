import { ModelRouteDecision, ModelRoutingConfig, ProviderMode, ProviderRegistry } from "@/types/contracts";

export interface ModelRoutingHints {
	estimatedPromptTokens?: number;
	requireLowLatency?: boolean;
	preferCloudForQuality?: boolean;
	mode?: ProviderMode;
}

export interface RoutingTarget {
	providerKey: "local" | "cloud";
	model: string;
}

export class ModelRouter {
	constructor(
		private readonly config: ModelRoutingConfig,
		private readonly registry: ProviderRegistry
	) {}

	async route(hints: ModelRoutingHints = {}): Promise<RoutingTarget & { decision: ModelRouteDecision }> {
		const localHealthy = await this.isProviderHealthy("local");
		const cloudHealthy = await this.isProviderHealthy("cloud");

		const providerKey = this.pickProvider({ ...hints, localHealthy, cloudHealthy });
		const model = this.pickModel(providerKey);

		return {
			providerKey,
			model,
			decision: {
				provider: providerKey,
				model,
				reason: this.reason(providerKey, { ...hints, localHealthy, cloudHealthy }),
				mode: hints.mode
			}
		};
	}

	private pickProvider(input: ModelRoutingHints & { localHealthy: boolean; cloudHealthy: boolean }): "local" | "cloud" {
		if (input.mode === "local-ollama") {
			if (input.localHealthy) return "local";
			if (input.cloudHealthy) return "cloud";
		}

		if (input.mode === "copilot-managed" || input.mode === "hybrid") {
			if (input.cloudHealthy) return "cloud";
			if (input.localHealthy) return "local";
		}

		if (this.config.preferLocal && input.localHealthy) return "local";

		if (input.preferCloudForQuality && input.cloudHealthy) return "cloud";

		if ((input.estimatedPromptTokens ?? 0) > 24_000 && input.cloudHealthy) {
			return "cloud";
		}

		if (input.requireLowLatency && input.localHealthy) return "local";
		if (input.localHealthy) return "local";
		if (input.cloudHealthy) return "cloud";

		return this.config.defaultCloudModel ? "cloud" : "local";
	}

	private pickModel(provider: "local" | "cloud"): string {
		if (provider === "local") return this.config.defaultLocalModel;
		return this.config.defaultCloudModel ?? this.config.defaultLocalModel;
	}

	private async isProviderHealthy(provider: "local" | "cloud"): Promise<boolean> {
		const p = provider === "local" ? this.registry.local : this.registry.cloud;
		if (!p) return false;
		try {
			return await p.isHealthy();
		} catch {
			return false;
		}
	}

	private reason(
		provider: "local" | "cloud",
		input: ModelRoutingHints & { localHealthy: boolean; cloudHealthy: boolean }
	): string {
		const reasonChunks: string[] = [];
		reasonChunks.push(`localHealthy=${String(input.localHealthy)}`);
		reasonChunks.push(`cloudHealthy=${String(input.cloudHealthy)}`);

		if (input.estimatedPromptTokens) {
			reasonChunks.push(`estimatedPromptTokens=${input.estimatedPromptTokens}`);
		}

		if (input.mode) reasonChunks.push(`mode=${input.mode}`);
		if (input.requireLowLatency) reasonChunks.push("low-latency-priority");
		if (input.preferCloudForQuality) reasonChunks.push("quality-priority");
		reasonChunks.push(`selected=${provider}`);
		return reasonChunks.join(", ");
	}
}
