import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { resolve } from "node:path";
import { CommonConfig, RepositoryWorkspace } from "@vscode-ai/shared";
import { ConfigStore } from "./configStore";
import { WsOrchestrator } from "./wsOrchestrator";

interface ConfigWsEvent {
  type: "config.snapshot" | "config.updated" | "telemetry.pulse";
  payload: unknown;
  sentAt: string;
}

const PORT = Number(process.env.AI_SERVER_PORT ?? 8080);
const HOST = process.env.AI_SERVER_HOST ?? "0.0.0.0";

const store = new ConfigStore(resolve(process.cwd(), ".data/common-config.json"));
type LiveSocket = { readyState: number; OPEN: number; send: (data: string) => void; on: (event: "close", listener: () => void) => void };
const clients = new Set<LiveSocket>();
const orchestrator = new WsOrchestrator(() => store.get());

const app = Fastify({ logger: true });

const broadcast = (event: ConfigWsEvent): void => {
  const data = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(data);
    }
  }
};

async function main(): Promise<void> {
  await store.load();

  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get("/health", async () => ({
    ok: true,
    service: "ai-server",
    now: new Date().toISOString(),
    connectedWsClients: clients.size,
    connectedExtensionClients: orchestrator.getExtensionClientCount()
  }));

  app.get("/api/config", async () => store.get());

  app.patch("/api/config", async (request: FastifyRequest<{ Body: Partial<CommonConfig> }>) => {
    const next = await store.patch(request.body ?? {});
    broadcast({ type: "config.updated", payload: next, sentAt: new Date().toISOString() });
    return next;
  });

  app.get("/api/repositories", async () => store.get().repositories);
  app.get("/api/prompt-traces", async () => orchestrator.getPromptTraces());

  app.post(
    "/api/repositories",
    async (
      request: FastifyRequest<{ Body: RepositoryWorkspace }>,
      reply: FastifyReply
    ) => {
    const incoming = request.body;
    if (!incoming?.id || !incoming?.name || !incoming?.path) {
      return reply.status(400).send({ message: "id, name, and path are required" });
    }

    const current = store.get();
    const existingIndex = current.repositories.findIndex((repo: RepositoryWorkspace) => repo.id === incoming.id);
    const repositories = [...current.repositories];

    if (existingIndex >= 0) {
      repositories[existingIndex] = incoming;
    } else {
      repositories.push(incoming);
    }

    const next = await store.patch({ repositories });
    broadcast({ type: "config.updated", payload: next, sentAt: new Date().toISOString() });
    return incoming;
    }
  );

  app.get("/ws/config", { websocket: true }, (socket: LiveSocket) => {
    clients.add(socket);

    socket.send(
      JSON.stringify({
        type: "config.snapshot",
        payload: store.get(),
        sentAt: new Date().toISOString()
      } satisfies ConfigWsEvent)
    );

    socket.on("close", () => {
      clients.delete(socket);
    });
  });

  app.get("/ws/extension", { websocket: true }, (socket: unknown) => {
    orchestrator.attachClient(socket as Parameters<WsOrchestrator["attachClient"]>[0]);
  });

  setInterval(() => {
    broadcast({
      type: "telemetry.pulse",
      payload: {
        connectedWsClients: clients.size + orchestrator.getExtensionClientCount(),
        vramMbEstimate: 0,
        routingMode: store.get().routing.preferLocal ? "local-first" : "hybrid"
      },
      sentAt: new Date().toISOString()
    });
  }, 3000);

  await app.listen({ host: HOST, port: PORT });
}

main().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
