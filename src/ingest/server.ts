import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { buildAnalytics } from "./analytics";
import { loadConfig } from "./config";
import { LobbyIngestService } from "./ingestService";
import { JsonStore } from "./store";
import { BucketMode, bucketForConfig } from "../shared/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const toBucketMode = (value: unknown): BucketMode => {
  switch (value) {
    case "game_mode":
    case "game_mode_team":
    case "map":
    case "map_size":
    case "modifiers":
      return value;
    default:
      return "game_mode_team";
  }
};

async function main() {
  const config = loadConfig();
  const store = await JsonStore.open(config);
  const ingest = new LobbyIngestService(config, store);
  ingest.start();

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const staticDir = path.resolve(__dirname, "../../static");
  app.use(express.static(staticDir));

  app.get("/api/health", (_req, res) => {
    const db = store.getDb();
    res.json({
      status: "ok",
      now: Date.now(),
      messagesReceived: db.messagesReceived,
      reconnectCount: db.reconnectCount,
      lobbiesTracked: Object.keys(db.lobbies).length,
      target: db.environment,
      lastUpdatedAt: db.lastUpdatedAt,
      systemNotes: db.systemNotes.slice(-10),
    });
  });

  app.get("/api/lobbies", (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const bucketMode = toBucketMode(req.query.bucketMode);
    const lookbackHours =
      typeof req.query.lookbackHours === "string"
        ? Number(req.query.lookbackHours)
        : 24 * 7;
    const since = Date.now() - Math.max(1, lookbackHours) * 60 * 60 * 1000;

    const lobbies = store
      .values()
      .filter((lobby) => lobby.firstSeenAt >= since)
      .filter((lobby) => (status ? lobby.status === status : true))
      .map((lobby) => ({
        ...lobby,
        bucket: bucketForConfig(lobby.gameConfig, bucketMode),
      }))
      .sort((a, b) => b.firstSeenAt - a.firstSeenAt);

    res.json({ count: lobbies.length, lobbies });
  });

  app.get("/api/lobbies/:id", (req, res) => {
    const record = store.getLobby(req.params.id);
    if (!record) {
      res.status(404).json({ error: "Lobby not found" });
      return;
    }
    res.json(record);
  });

  app.get("/api/analytics", (req, res) => {
    const bucketMode = toBucketMode(req.query.bucketMode);
    const lookbackHours =
      typeof req.query.lookbackHours === "string"
        ? Number(req.query.lookbackHours)
        : 24 * 7;
    const payload = buildAnalytics(store.values(), bucketMode, lookbackHours);
    res.json(payload);
  });

  app.get("*", (_req, res) => {
    res.sendFile(path.resolve(staticDir, "index.html"));
  });

  const server = app.listen(config.port, () => {
    console.log(`[lobbystatistics] ingest server listening on :${config.port}`);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[lobbystatistics] unhandledRejection", reason);
  });

  process.on("uncaughtException", (error) => {
    console.error("[lobbystatistics] uncaughtException", error);
  });

  const shutdown = async () => {
    ingest.stop();
    await store.close();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((error) => {
  console.error("[lobbystatistics] fatal startup error", error);
  process.exit(1);
});
