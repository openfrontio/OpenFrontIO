import cluster from "cluster";
import crypto from "crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { GameEnv } from "../core/configuration/Config";
import { fetchSiteColor } from "./ActiveDeployment";
import {
  applyCheckinState,
  CHECKIN_INTERVAL_MS,
  checkinBody,
  sendCheckin,
} from "./ClusterCheckin";
import { getDescriptor } from "./DesktopRelease";
import { logger } from "./Logger";
import { MapPlaylist } from "./MapPlaylist";
import { MasterLobbyService } from "./MasterLobbyService";
import { setNoStoreHeaders } from "./NoStoreHeaders";
import { startPolling } from "./PollingLoop";
import { renderAppShell } from "./RenderHtml";
import { ServerEnv } from "./ServerEnv";
import { applyStaticAssetCacheControl } from "./StaticAssetCache";

const playlist = new MapPlaylist();
let lobbyService: MasterLobbyService;

const app = express();
const server = http.createServer(app);

const log = logger.child({ comp: "m" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());

// Serve the shared app shell for the root document.
app.use(async (req, res, next) => {
  if (req.path === "/") {
    try {
      await renderAppShell(
        res,
        path.join(__dirname, "../../static/index.html"),
      );
    } catch (error) {
      log.error("Error rendering index.html:", error);
      res.status(500).send("Internal Server Error");
    }
  } else {
    next();
  }
});

// Desktop (Steam) shell release descriptor. See openfront-desktop's
// docs/superpowers/specs/2026-08-20-runtime-asset-updating-design.md.
//
// version.json is polled once a minute by every running desktop client, so it
// is deliberately tiny and separately cacheable; release.json is fetched only
// when that pointer changes. Both must be reachable without a bot challenge --
// see OPE-192.
const staticDir = path.join(__dirname, "../../static");
const descriptorOpts = () => ({
  clientVersion: ServerEnv.gitCommit(),
  cdnBase: ServerEnv.cdnBase(),
  // Production must have a CDN: without one this descriptor would point every
  // Steam client at this app server for ~570MB of assets. Dev and preprod have
  // no CDN, and same-origin is what the web client already does there.
  requireCdnBase: ServerEnv.env() === GameEnv.Prod,
});

app.get("/desktop/version.json", async (_req, res) => {
  try {
    const d = await getDescriptor(staticDir, descriptorOpts());
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30");
    res.json({ clientVersion: d.clientVersion, coreVersion: d.coreVersion });
  } catch (error) {
    log.error("Error building desktop version pointer:", error);
    res.status(500).json({ error: "unavailable" });
  }
});

app.get("/desktop/release.json", async (_req, res) => {
  try {
    const d = await getDescriptor(staticDir, descriptorOpts());
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30");
    res.json(d);
  } catch (error) {
    log.error("Error building desktop release descriptor:", error);
    res.status(500).json({ error: "unavailable" });
  }
});

app.use(
  express.static(path.join(__dirname, "../../static"), {
    maxAge: "1y", // Set max-age to 1 year for all static assets
    setHeaders: (res) => {
      applyStaticAssetCacheControl(
        res.setHeader.bind(res),
        res.req.originalUrl,
      );
    },
  }),
);

app.set("trust proxy", 3);
app.use(
  rateLimit({
    windowMs: 1000, // 1 second
    max: 20, // 20 requests per IP per second
  }),
);

app.use("/api", (_req, res, next) => {
  setNoStoreHeaders(res);
  next();
});

// Start the master process
export async function startMaster() {
  if (!cluster.isPrimary) {
    throw new Error(
      "startMaster() should only be called in the primary process",
    );
  }

  log.info(`Primary ${process.pid} is running`);
  log.info(`Setting up ${ServerEnv.numWorkers()} workers...`);

  lobbyService = new MasterLobbyService(playlist, log);

  const INSTANCE_ID =
    ServerEnv.env() === GameEnv.Dev
      ? "DEV_ID"
      : crypto.randomBytes(4).toString("hex");
  process.env.INSTANCE_ID = INSTANCE_ID;

  log.info(`Instance ID: ${INSTANCE_ID}`);

  // Fork workers
  for (let i = 0; i < ServerEnv.numWorkers(); i++) {
    const worker = cluster.fork({
      WORKER_ID: i,
      INSTANCE_ID,
    });

    lobbyService.registerWorker(i, worker);
    log.info(`Started worker ${i} (PID: ${worker.process.pid})`);
  }

  // Handle worker crashes
  cluster.on("exit", (worker, code, signal) => {
    const workerId = (worker as any).process?.env?.WORKER_ID;
    if (workerId === undefined) {
      log.error(`worker crashed could not find id`);
      return;
    }

    const workerIdNum = parseInt(workerId);
    lobbyService.removeWorker(workerIdNum);

    log.warn(
      `Worker ${workerId} (PID: ${worker.process.pid}) died with code: ${code} and signal: ${signal}`,
    );
    log.info(`Restarting worker ${workerId}...`);

    // Restart the worker with the same ID
    const newWorker = cluster.fork({
      WORKER_ID: workerId,
      INSTANCE_ID,
    });

    lobbyService.registerWorker(workerIdNum, newWorker);
    log.info(
      `Restarted worker ${workerId} (New PID: ${newWorker.process.pid})`,
    );
  });

  const PORT = 3000;
  server.listen(PORT, () => {
    log.info(`Master HTTP server listening on port ${PORT}`);
  });

  // Register with the API and keep checking in (docs/MultiServer.md,
  // "Server list v2"): the API's list is what clients read to find a
  // server, so a server that isn't checking in isn't offered to anyone.
  // The reply carries this server's state; it is obeyed only when
  // CLUSTER_STATE_SOURCE=api, otherwise the apex colour poll below still
  // decides. Local development (`npm run dev`, no SUBDOMAIN) has no public
  // host and registers nowhere; every deployed host registers under its own
  // site.
  const stateSource = ServerEnv.clusterStateSource();
  if (checkinBody(0) !== null) {
    log.info(
      `Checking in with ${ServerEnv.jwtIssuer()}/cluster/checkin every ${CHECKIN_INTERVAL_MS / 1000}s (state source: ${stateSource})`,
    );
    startPolling(async () => {
      const body = checkinBody(lobbyService.liveGames());
      if (body === null) return;
      const state = await sendCheckin(body);
      applyCheckinState(state, stateSource, (active) =>
        lobbyService.setActive(active),
      );
    }, CHECKIN_INTERVAL_MS);
  }

  // Behind a load balancer (blue/green), only the color the balancer
  // currently routes to should schedule public lobbies. The balancer's
  // /api/health reports the COLOR of whichever deployment answered; colors
  // are deployment-wide, so with several machines per color the poll
  // reaching a sibling — same color, different instanceId — still counts as
  // "the live color is mine". A standalone deployment (no SITE_HOST, or
  // SITE_HOST is our own host) is always active. Not started when the API
  // is the state source: two deciders would fight over setActive.
  const siteHost = ServerEnv.siteHost();
  if (
    stateSource === "apex" &&
    siteHost !== undefined &&
    siteHost !== ServerEnv.publicHost()
  ) {
    log.info(`Polling https://${siteHost}/api/health for active deployment`);
    // 5s: this latency is the window after a flip where the newly-active
    // deployment isn't creating public lobbies yet (and the draining one
    // still is). startPolling serializes runs, so the fetch's 10s timeout
    // can't pile requests up.
    startPolling(async () => {
      const siteColor = await fetchSiteColor(siteHost);
      if (siteColor === null) return;
      lobbyService.setActive(siteColor === ServerEnv.color());
    }, 5 * 1000);
  }
}

// The fleet topology map, verbatim from this server's own config. Web
// clients get it baked into BOOTSTRAP_CONFIG; this endpoint is for the
// desktop shell, which loads its renderer from app:// and discovers the
// cluster from its configured serverHost at boot instead.
app.get("/cluster.json", (_req, res) => {
  setNoStoreHeaders(res);
  res.json(ServerEnv.cluster());
});

app.get("/api/health", (_req, res) => {
  const ready = lobbyService?.isHealthy() ?? false;
  const instanceId = ServerEnv.instanceId();
  // The drain check (ActiveDeployment) compares colors: deployment-wide,
  // where instanceId is per-machine and would false-drain siblings behind
  // the same apex. instanceId stays for diagnostics.
  const color = ServerEnv.color();
  if (ready) {
    res.json({ status: "ok", instanceId, color });
  } else {
    res.status(503).json({ status: "unavailable", instanceId, color });
  }
});

// SPA fallback route
app.get("/{*splat}", async function (_req, res) {
  try {
    const htmlPath = path.join(__dirname, "../../static/index.html");
    await renderAppShell(res, htmlPath);
  } catch (error) {
    log.error("Error rendering SPA fallback:", error);
    res.status(500).send("Internal Server Error");
  }
});
