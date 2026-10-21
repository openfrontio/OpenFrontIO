import { GameEnv } from "@openfront/shared/configuration/Env";
import cluster, { Worker } from "cluster";
import crypto from "crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import {
  applyCheckinState,
  CHECKIN_INTERVAL_MS,
  checkinBody,
  isRefusal,
  registeredSite,
  sendCheckin,
} from "./ClusterCheckin";
import { getDescriptor } from "./DesktopRelease";
import {
  coordinatorUrl,
  LobbyCoordinatorClient,
} from "./LobbyCoordinatorClient";
import { logger } from "./Logger";
import { MapPlaylist } from "./MapPlaylist";
import { fetchMapWeights, MAP_WEIGHTS_POLL_MS } from "./MapWeights";
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

// Apple Pay domain verification (Stripe's universal association file,
// vendored in resources/public/). Apple fetches this exact path over HTTPS when the
// domain is registered in the Stripe dashboard, and it must get the raw file:
// express.static above ignores dotfile paths (so it falls through to here)
// and the SPA fallback below would answer with the app shell, which makes
// registration fail with no error anywhere we can see. Registered after the
// rate limiter so the file read is covered by it. Verify with
// `curl https://<domain>/.well-known/apple-developer-merchantid-domain-association`.
app.get(
  "/.well-known/apple-developer-merchantid-domain-association",
  (_req, res) => {
    res.type("text/plain");
    res.sendFile(
      path.join(
        __dirname,
        "../../resources/public/.well-known/apple-developer-merchantid-domain-association",
      ),
      // sendFile refuses dotfile path segments (".well-known") by default.
      // maxAge matters beyond browsers: nginx's proxy cache honours the
      // upstream Cache-Control, and sendFile's default max-age=0 would veto
      // the nginx.conf location block that shields this route.
      { dotfiles: "allow", maxAge: "1d" },
      (err) => {
        if (err && !res.headersSent) res.status(404).end();
      },
    );
  },
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

  // A server that registers schedules nothing until the API calls it open: a
  // mistyped letter must not mint lobbies under a letter routed elsewhere.
  const registers = checkinBody(0) !== null;
  lobbyService = new MasterLobbyService(playlist, log, registers);

  const INSTANCE_ID =
    ServerEnv.env() === GameEnv.Dev
      ? "DEV_ID"
      : crypto.randomBytes(4).toString("hex");
  process.env.INSTANCE_ID = INSTANCE_ID;

  log.info(`Instance ID: ${INSTANCE_ID}`);

  // Join the site's shared public-lobby roster (LobbyCoordinatorClient.ts)
  // when LOBBY_COORDINATOR=api and this server has a public host to
  // register under, the same test as the check-in below. Started before the
  // workers fork so the first roster normally lands before scheduling
  // begins; until it does, and whenever it stops, the master schedules its
  // own lobbies exactly as it does without a coordinator.
  const hello = checkinBody(0);
  const coordinator = coordinatorUrl(registeredSite());
  if (coordinator !== null && hello !== null) {
    log.info(`Joining lobby coordinator at ${coordinator}`);
    const client = new LobbyCoordinatorClient({
      url: coordinator,
      apiKey: ServerEnv.apiKey(),
      hello: {
        letter: hello.letter,
        host: hello.host,
        version: hello.version,
        numWorkers: hello.numWorkers,
        instanceId: INSTANCE_ID,
      },
      handlers: lobbyService.coordinatorHandlers(),
      log,
    });
    lobbyService.attachCoordinator(client);
    client.start();
  }

  // A worker that dies within this long of being forked counts as a
  // startup crash; one that stayed up at least this long is treated as
  // healthy, restarts immediately, and clears its backoff.
  const STARTUP_CRASH_MS = 30_000;
  const BACKOFF_CAP_MS = 30_000;

  // Map each cluster Worker to the WORKER_ID it was forked with, plus the
  // fork time. A Worker's env is not readable after exit (worker.process
  // has no .env), so the id must be captured here, at fork time.
  const forkedWorkers = new Map<Worker, { id: number; forkedAt: number }>();

  // Consecutive startup crashes per worker id, driving the backoff delay.
  const startupCrashes = new Map<number, number>();

  const forkWorker = (workerId: number): Worker => {
    const worker = cluster.fork({
      WORKER_ID: workerId,
      INSTANCE_ID,
    });

    forkedWorkers.set(worker, { id: workerId, forkedAt: Date.now() });
    lobbyService.registerWorker(workerId, worker);
    return worker;
  };

  // Fork workers
  for (let i = 0; i < ServerEnv.numWorkers(); i++) {
    const worker = forkWorker(i);
    log.info(`Started worker ${i} (PID: ${worker.process.pid})`);
  }

  // Handle worker crashes. A worker that dies during startup may crash on
  // boot again (bad env, bad file), so its restart is delayed with an
  // exponential backoff (1s doubling, capped) to avoid fork-looping many
  // times a second. Normal crashes restart straight away, and the backoff
  // resets once a worker has stayed up past STARTUP_CRASH_MS.
  cluster.on("exit", (worker, code, signal) => {
    const info = forkedWorkers.get(worker);
    forkedWorkers.delete(worker);
    if (info === undefined) {
      log.error(`worker crashed could not find id`);
      return;
    }

    const workerId = info.id;
    const uptimeMs = Date.now() - info.forkedAt;

    lobbyService.removeWorker(workerId);

    log.warn(
      `Worker ${workerId} (PID: ${worker.process.pid}) died with code: ${code} and signal: ${signal}`,
    );

    if (uptimeMs < STARTUP_CRASH_MS) {
      const crashes = (startupCrashes.get(workerId) ?? 0) + 1;
      startupCrashes.set(workerId, crashes);
      const delayMs = Math.min(1_000 * 2 ** (crashes - 1), BACKOFF_CAP_MS);
      log.warn(
        `Worker ${workerId} died during startup (${uptimeMs}ms after fork, crash #${crashes}); delaying restart by ${delayMs}ms`,
      );
      setTimeout(() => {
        log.info(`Restarting worker ${workerId}...`);
        const newWorker = forkWorker(workerId);
        log.info(
          `Restarted worker ${workerId} (New PID: ${newWorker.process.pid})`,
        );
      }, delayMs);
      return;
    }

    // Stayed up past STARTUP_CRASH_MS: a normal crash, restart straight
    // away and reset this slot's backoff.
    startupCrashes.delete(workerId);
    log.info(`Restarting worker ${workerId}...`);

    const newWorker = forkWorker(workerId);
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
  // Local development (`npm run dev`, no SUBDOMAIN) has no public host and
  // registers nowhere; every deployed host registers under its own site.
  if (registers) {
    log.info(
      `Checking in with ${ServerEnv.jwtIssuer()}/cluster/checkin every ${CHECKIN_INTERVAL_MS / 1000}s`,
    );
    let lastRefusal: string | null = null;
    startPolling(async () => {
      const body = checkinBody(lobbyService.liveGames());
      if (body === null) return;
      const result = await sendCheckin(body);
      if (isRefusal(result)) {
        if (result.refused !== lastRefusal) {
          log.error(
            `API refused check-in as letter ${body.letter} from ${body.host}: ${result.refused}. Scheduling no public lobbies until it is accepted.`,
          );
        }
        lastRefusal = result.refused;
      } else if (result !== null) {
        lastRefusal = null;
      }
      applyCheckinState(result, (active) => lobbyService.setActive(active));
    }, CHECKIN_INTERVAL_MS);

    // Public-lobby rotation weight overrides set in the API. Until the first
    // fetch lands, and while it keeps failing, the last known weights (or the
    // build's info.json) stay in effect.
    startPolling(async () => {
      playlist.setWeightOverrides(await fetchMapWeights());
    }, MAP_WEIGHTS_POLL_MS);
  }
}

app.get("/api/health", (_req, res) => {
  const ready = lobbyService?.isHealthy() ?? false;
  // instanceId is diagnostics: it tells the machines behind an apex apart.
  const instanceId = ServerEnv.instanceId();
  if (ready) {
    res.json({ status: "ok", instanceId });
  } else {
    res.status(503).json({ status: "unavailable", instanceId });
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
