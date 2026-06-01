import { ReactNode, useEffect, useMemo, useState } from "react";
import { CommonConfig, PromptTraceRecord, RepositoryWorkspace } from "@vscode-ai/shared";

interface WsEvent {
  type: "config.snapshot" | "config.updated" | "telemetry.pulse";
  payload: unknown;
  sentAt: string;
}

interface TelemetryPulse {
  connectedWsClients: number;
  vramMbEstimate: number;
  routingMode: string;
}

const API_BASE = import.meta.env.VITE_AI_SERVER_URL ?? "";
const API_URL = `${API_BASE}/api/config`;
const TRACE_API_URL = `${API_BASE}/api/prompt-traces`;
const WS_URL = (import.meta.env.VITE_AI_SERVER_WS_URL as string | undefined) ??
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/config`;

export function App(): JSX.Element {
  const [config, setConfig] = useState<CommonConfig | null>(null);
  const [traces, setTraces] = useState<PromptTraceRecord[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryPulse | null>(null);
  const [status, setStatus] = useState<"connecting" | "online" | "offline">("connecting");

  useEffect(() => {
    const load = async (): Promise<void> => {
      const response = await fetch(API_URL);
      if (!response.ok) throw new Error(`Config request failed: ${response.status}`);
      const data = (await response.json()) as CommonConfig;
      setConfig(data);

      await refreshTraces();
    };

    load().catch(() => setStatus("offline"));
  }, []);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => setStatus("online");
    ws.onclose = () => setStatus("offline");

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as WsEvent;
      if (message.type === "config.snapshot" || message.type === "config.updated") {
        setConfig(message.payload as CommonConfig);
        void refreshTraces();
      }
      if (message.type === "telemetry.pulse") {
        setTelemetry(message.payload as TelemetryPulse);
        void refreshTraces();
      }
    };

    return () => ws.close();
  }, []);

  const repositories = useMemo<RepositoryWorkspace[]>(() => config?.repositories ?? [], [config]);

  async function refreshTraces(): Promise<void> {
    const traceResponse = await fetch(TRACE_API_URL);
    if (!traceResponse.ok) return;
    setTraces((await traceResponse.json()) as PromptTraceRecord[]);
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-6">
        <header className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
          <h1 className="text-2xl font-semibold">AI Control Panel</h1>
          <p className="mt-2 text-sm text-slate-400">
            Local-first orchestration visibility for routing, repositories, and common configuration.
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-xs">
            <StatusBadge label="Server" value={status} />
            <StatusBadge label="Local model" value={config?.models.local.model ?? "-"} />
            <StatusBadge label="Cloud model" value={config?.models.cloud.model ?? "-"} />
            <StatusBadge label="Routing" value={config?.routing.preferLocal ? "local-first" : "hybrid"} />
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-3">
          <Card title="Repositories" subtitle="Named workspace registry">
            <ul className="space-y-3">
              {repositories.map((repo) => (
                <li key={repo.id} className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm">
                  <div className="font-medium">{repo.name}</div>
                  <div className="text-slate-400">{repo.path}</div>
                  <div className="mt-1 text-xs text-emerald-400">index: {repo.indexing.status}</div>
                </li>
              ))}
              {repositories.length === 0 && <li className="text-sm text-slate-500">No repositories registered.</li>}
            </ul>
          </Card>

          <Card title="Routing Diagnostics" subtitle="Deterministic routing policy">
            <dl className="space-y-2 text-sm">
              <Diagnostic term="Prefer local" value={String(config?.routing.preferLocal ?? false)} />
              <Diagnostic term="Token threshold" value={String(config?.routing.lowLatencyTokenThreshold ?? "-")} />
              <Diagnostic term="Cloud triggers" value={(config?.routing.promoteCloudFor ?? []).join(", ") || "-"} />
              <Diagnostic term="Prompt trace" value={String(config?.observability.promptTrace ?? false)} />
            </dl>
          </Card>

          <Card title="Telemetry" subtitle="Live pulse from ai-server">
            <dl className="space-y-2 text-sm">
              <Diagnostic term="WS clients" value={String(telemetry?.connectedWsClients ?? 0)} />
              <Diagnostic term="VRAM estimate (MB)" value={String(telemetry?.vramMbEstimate ?? 0)} />
              <Diagnostic term="Routing mode" value={telemetry?.routingMode ?? "-"} />
              <Diagnostic term="Last update" value={config?.updatedAt ?? "-"} />
            </dl>
          </Card>
        </section>

        <Card title="Common Configuration" subtitle="Inspectable config snapshot (JSON)">
          <pre className="max-h-[420px] overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-slate-300">
            {JSON.stringify(config, null, 2)}
          </pre>
        </Card>

        <Card title="Prompt Traces" subtitle="Recent orchestration traces">
          <div className="space-y-2 text-xs">
            {traces.slice(0, 20).map((trace) => (
              <div key={trace.id} className="rounded-md border border-slate-800 bg-slate-950 p-3">
                <div className="font-semibold text-slate-200">{trace.requestId}</div>
                <div className="text-slate-400">{trace.createdAt}</div>
                <div className="text-slate-300">
                  route={trace.route} model={trace.model} latency={trace.latencyMs}ms tokens={trace.estimatedTokens}
                </div>
              </div>
            ))}
            {traces.length === 0 && <div className="text-slate-500">No traces yet. Trigger a chat request from extension.</div>}
          </div>
        </Card>
      </div>
    </main>
  );
}

function Card(props: { title: string; subtitle: string; children: ReactNode }): JSX.Element {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
      <h2 className="text-base font-semibold">{props.title}</h2>
      <p className="mb-4 text-xs text-slate-400">{props.subtitle}</p>
      {props.children}
    </section>
  );
}

function Diagnostic(props: { term: string; value: string }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2">
      <dt className="text-slate-400">{props.term}</dt>
      <dd className="text-right font-medium text-slate-100">{props.value}</dd>
    </div>
  );
}

function StatusBadge(props: { label: string; value: string }): JSX.Element {
  return (
    <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-slate-200">
      <strong>{props.label}:</strong> {props.value}
    </span>
  );
}
