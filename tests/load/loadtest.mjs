// WebSocket load test for the OpenFront game server.
//
// The game server's hot path is WebSocket messaging: clients send `intent`
// messages, the server queues them, and every turn tick (100ms) it broadcasts
// a `turn` message containing the queued intents to every client in the game.
// This harness measures that path end to end against the REAL server.
//
// The load generator always runs under plain Node so the measuring instrument
// stays constant; only the server runtime varies (--runtime node|bun).
//
// How RTT is measured with zero server changes: the `attack` intent's
// `troops` field is any nonnegative number, and the server relays intents
// verbatim. Each generated intent stores Date.now() in `troops`; every client
// that receives the turn computes RTT = now - troops. Same machine, same
// clock, no skew.
//
// Usage:
//   node tests/load/loadtest.mjs [--runtime node|bun] [--games 8]
//     [--clients 25] [--duration 60] [--intent-rate 1] [--workers 2]
//     [--label baseline] [--attach]   (--attach: use an already-running server)
//
// Results: human summary on stdout + JSON in tests/load/results/<label>.json

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import WebSocket from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

// ---------------------------------------------------------------- args

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}

const RUNTIME = String(arg("runtime", "node")); // node | bun
const GAMES = Number(arg("games", 8));
const CLIENTS_PER_GAME = Number(arg("clients", 25));
const DURATION_S = Number(arg("duration", 60));
const INTENT_RATE = Number(arg("intent-rate", 1)); // intents/sec/client (<=2.5 to stay under server limits)
const NUM_WORKERS = Number(arg("workers", 2));
const LABEL = String(arg("label", RUNTIME));
const ATTACH = arg("attach", false) === true;

const MASTER_PORT = 3000;
const workerPort = (i) => 3001 + i;

// ---------------------------------------------------------------- helpers

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    mean: sorted.length ? sum / sorted.length : NaN,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length ? sorted[sorted.length - 1] : NaN,
  };
}

function fmt(ms) {
  return Number.isFinite(ms) ? ms.toFixed(1) : "n/a";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${label}`);
    }
    await sleep(250);
  }
}

// UUID v4 for dev tokens (dev servers accept a raw persistent id as token).
const uuid = () => crypto.randomUUID();

// ---------------------------------------------------------------- server process management

const serverEnv = {
  ...process.env,
  GAME_ENV: "dev",
  NUM_WORKERS: String(NUM_WORKERS),
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  API_KEY: "WARNING_DEV_API_KEY_DO_NOT_USE_IN_PRODUCTION",
  ADMIN_BOT_API_KEY: "WARNING_DEV_ADMIN_BOT_KEY_DO_NOT_USE_IN_PRODUCTION",
  DOMAIN: "localhost",
  GIT_COMMIT: "DEV",
};

function serverCommand() {
  if (RUNTIME === "bun") {
    return ["bun", ["src/server/Server.ts"]];
  }
  // The production Node path runs through tsx (see package.json start:server),
  // so measuring tsx-launched Node is measuring the real deployment.
  return ["npx", ["tsx", "src/server/Server.ts"]];
}

let serverProc = null;
const resultsDir = path.join(__dirname, "results");
fs.mkdirSync(resultsDir, { recursive: true });
const serverLogPath = path.join(resultsDir, `${LABEL}-server.log`);

function startServer() {
  const [cmd, args] = serverCommand();
  const logFd = fs.openSync(serverLogPath, "w");
  serverProc = spawn(cmd, args, {
    cwd: repoRoot,
    env: serverEnv,
    detached: true, // own process group so we can kill the whole tree
    stdio: ["ignore", logFd, logFd],
  });
  serverProc.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`server exited early (code=${code} signal=${signal})`);
      console.error(`see ${serverLogPath}`);
      process.exit(1);
    }
  });
}

let shuttingDown = false;
function stopServer() {
  shuttingDown = true;
  if (serverProc && serverProc.pid) {
    try {
      process.kill(-serverProc.pid, "SIGTERM");
    } catch {
      // group already gone
    }
  }
}

process.on("SIGINT", () => {
  stopServer();
  process.exit(130);
});

// ---------------------------------------------------------------- /proc CPU + RSS sampling

function readProcTable() {
  // pid -> { ppid, utime, stime, rssPages, comm }
  const table = new Map();
  let pids;
  try {
    pids = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d));
  } catch {
    return table;
  }
  for (const pid of pids) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      // comm can contain spaces/parens; it is wrapped in the last ')'
      const close = stat.lastIndexOf(")");
      const comm = stat.slice(stat.indexOf("(") + 1, close);
      const rest = stat.slice(close + 2).split(" ");
      // rest[0]=state, rest[1]=ppid, rest[11]=utime, rest[12]=stime, rest[21]=rss(pages)
      table.set(Number(pid), {
        ppid: Number(rest[1]),
        utime: Number(rest[11]),
        stime: Number(rest[12]),
        rssPages: Number(rest[21]),
        comm,
      });
    } catch {
      // process vanished between readdir and read
    }
  }
  return table;
}

function descendantsOf(rootPid, table) {
  const children = new Map();
  for (const [pid, info] of table) {
    if (!children.has(info.ppid)) children.set(info.ppid, []);
    children.get(info.ppid).push(pid);
  }
  const out = [];
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    if (!table.has(pid)) continue;
    out.push(pid);
    for (const c of children.get(pid) ?? []) stack.push(c);
  }
  return out;
}

const HZ = 100; // Linux USER_HZ
const PAGE_SIZE = 4096;

class ProcSampler {
  constructor(rootPid) {
    this.rootPid = rootPid;
    this.samples = []; // { t, cpuTicks, rssBytes, nprocs }
    this.timer = null;
  }
  start() {
    this.timer = setInterval(() => this.sample(), 1000);
    this.sample();
  }
  sample() {
    const table = readProcTable();
    const pids = descendantsOf(this.rootPid, table);
    let cpuTicks = 0;
    let rssBytes = 0;
    for (const pid of pids) {
      const info = table.get(pid);
      cpuTicks += info.utime + info.stime;
      rssBytes += info.rssPages * PAGE_SIZE;
    }
    this.samples.push({
      t: Date.now(),
      cpuTicks,
      rssBytes,
      nprocs: pids.length,
    });
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
  // CPU% (of one core) averaged over the window, and peak RSS.
  report(windowStartMs) {
    const inWindow = this.samples.filter((s) => s.t >= windowStartMs);
    if (inWindow.length < 2) return { avgCpuPct: NaN, peakRssMb: NaN };
    const first = inWindow[0];
    const last = inWindow[inWindow.length - 1];
    const cpuSec = (last.cpuTicks - first.cpuTicks) / HZ;
    const wallSec = (last.t - first.t) / 1000;
    const peakRss = Math.max(...inWindow.map((s) => s.rssBytes));
    return {
      avgCpuPct: (cpuSec / wallSec) * 100,
      peakRssMb: peakRss / (1024 * 1024),
      procCount: last.nprocs,
    };
  }
}

// ---------------------------------------------------------------- load client

class LoadClient {
  constructor(game, index, isCreator, token) {
    this.game = game;
    this.index = index;
    this.isCreator = isCreator;
    this.token = token;
    this.clientID = null;
    this.ws = null;
    this.started = false;
    this.joinSentAt = 0;
    this.joinLatencyMs = null;
    this.lastTurnAt = 0;
    this.errors = [];
    this.closed = false;
    this.msgsReceived = 0;
    this.bytesReceived = 0;
    this.intentsSent = 0;
    this.timers = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.game.port}/`);
      this.ws = ws;
      const joinTimeout = setTimeout(
        () =>
          reject(new Error(`join timeout g=${this.game.id} c=${this.index}`)),
        20000,
      );
      ws.on("open", () => {
        this.joinSentAt = performance.now();
        ws.send(
          JSON.stringify({
            type: "join",
            token: this.token,
            gameID: this.game.id,
            username: `load_${this.game.index}_${this.index}`,
            clanTag: null,
            turnstileToken: null,
          }),
        );
      });
      ws.on("message", (data) => {
        this.msgsReceived++;
        this.bytesReceived += data.length;
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        this.onMessage(msg);
        if (this.clientID !== null && joinTimeout) {
          clearTimeout(joinTimeout);
          resolve();
        }
      });
      ws.on("error", (err) => {
        this.errors.push(String(err));
      });
      ws.on("close", (code, reason) => {
        this.closed = true;
        if (!metrics.done && code !== 1000) {
          this.errors.push(`closed ${code} ${reason}`);
        }
      });
    });
  }

  onMessage(msg) {
    const now = Date.now();
    switch (msg.type) {
      case "lobby_info":
        if (this.clientID === null) {
          this.clientID = msg.myClientID;
          this.joinLatencyMs = performance.now() - this.joinSentAt;
          metrics.joinLatencies.push(this.joinLatencyMs);
        }
        break;
      case "start":
        this.started = true;
        this.game.onClientStarted();
        break;
      case "turn": {
        // Turn-interval jitter, measured per client past the first turn.
        if (this.lastTurnAt !== 0 && metrics.measuring) {
          metrics.turnGaps.push(now - this.lastTurnAt);
        }
        this.lastTurnAt = now;
        if (metrics.measuring) metrics.turnsReceived++;
        for (const intent of msg.turn.intents) {
          if (
            intent.type === "attack" &&
            typeof intent.troops === "number" &&
            intent.troops > metrics.epoch
          ) {
            if (metrics.measuring) metrics.rtts.push(now - intent.troops);
          }
        }
        break;
      }
      case "error":
        this.errors.push(JSON.stringify(msg));
        break;
    }
  }

  startTraffic() {
    // Keepalive pings (server drops clients silent for 60s).
    this.timers.push(
      setInterval(
        () => this.send({ type: "ping" }),
        5000 + Math.random() * 1000,
      ),
    );
    // Intent traffic at INTENT_RATE per second, jittered start so clients
    // don't phase-lock.
    const intervalMs = 1000 / INTENT_RATE;
    setTimeout(() => {
      this.timers.push(
        setInterval(() => {
          this.send({
            type: "intent",
            intent: { type: "attack", targetID: null, troops: Date.now() },
          });
          this.intentsSent++;
        }, intervalMs),
      );
    }, Math.random() * intervalMs);
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close(1000);
  }
}

class LoadGame {
  constructor(index) {
    this.index = index;
    this.id = null;
    this.port = null;
    this.creatorToken = uuid();
    this.clients = [];
    this.startedClients = 0;
    this.allStarted = null;
    this.allStartedResolve = null;
  }

  async create() {
    // Round-robin creation across workers; each worker mints an id routed to
    // itself.
    const port = workerPort(this.index % NUM_WORKERS);
    const res = await fetch(`http://127.0.0.1:${port}/api/create_game`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.creatorToken}`,
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      throw new Error(`create_game failed: ${res.status} ${await res.text()}`);
    }
    const info = await res.json();
    this.id = info.gameID;
    this.port = workerPort(info.workerIndex);
  }

  async join() {
    this.allStarted = new Promise((r) => (this.allStartedResolve = r));
    for (let i = 0; i < CLIENTS_PER_GAME; i++) {
      const isCreator = i === 0;
      const token = isCreator ? this.creatorToken : uuid();
      this.clients.push(new LoadClient(this, i, isCreator, token));
    }
    // Batch connects to avoid a thundering herd on the accept queue.
    const BATCH = 10;
    for (let i = 0; i < this.clients.length; i += BATCH) {
      await Promise.all(
        this.clients.slice(i, i + BATCH).map((c) => c.connect()),
      );
    }
  }

  begin() {
    // Creator flips the start timer; server prestarts on its next manager
    // tick and starts ~2s later.
    const creator = this.clients[0];
    creator.send({
      type: "intent",
      intent: { type: "toggle_game_start_timer" },
    });
  }

  onClientStarted() {
    this.startedClients++;
    if (this.startedClients === this.clients.length) {
      this.allStartedResolve();
    }
  }
}

// ---------------------------------------------------------------- metrics

const metrics = {
  epoch: Date.now() - 60_000, // troops values above this are our timestamps
  measuring: false,
  done: false,
  rtts: [],
  turnGaps: [],
  joinLatencies: [],
  turnsReceived: 0,
};

// ---------------------------------------------------------------- main

async function main() {
  console.log(
    `load test: runtime=${RUNTIME} games=${GAMES} clients/game=${CLIENTS_PER_GAME} ` +
      `total clients=${GAMES * CLIENTS_PER_GAME} duration=${DURATION_S}s ` +
      `intent rate=${INTENT_RATE}/s/client workers=${NUM_WORKERS}`,
  );

  if (!ATTACH) {
    // Preflight: a leftover server on our ports would silently absorb the
    // health check and half the traffic (workers bind with SO_REUSEPORT
    // under Bun's cluster), poisoning results. Refuse to run.
    for (let p = MASTER_PORT; p <= workerPort(NUM_WORKERS - 1); p++) {
      const occupied = await fetch(`http://127.0.0.1:${p}/`, {
        signal: AbortSignal.timeout(1000),
      }).then(
        () => true,
        () => false,
      );
      if (occupied) {
        throw new Error(
          `port ${p} is already serving HTTP — kill the stray server first ` +
            `(or pass --attach to test against it)`,
        );
      }
    }
    console.log(`starting server (${serverCommand().flat().join(" ")})...`);
    startServer();
  }

  // In --attach mode the target may be a standalone worker (no master), so
  // the master health check only runs for servers we spawned ourselves.
  if (!ATTACH) {
    await waitFor(
      async () => {
        try {
          const res = await fetch(
            `http://127.0.0.1:${MASTER_PORT}/api/health`,
            { signal: AbortSignal.timeout(1500) },
          );
          return res.ok;
        } catch {
          return false;
        }
      },
      60_000,
      "server health",
    );
  }
  // Health means workers signaled ready over IPC; verify their HTTP ports too.
  for (let i = 0; i < NUM_WORKERS; i++) {
    await waitFor(
      async () => {
        try {
          await fetch(`http://127.0.0.1:${workerPort(i)}/api/env`, {
            signal: AbortSignal.timeout(1500),
          });
          return true;
        } catch {
          return false;
        }
      },
      30_000,
      `worker ${i} http`,
    );
  }
  console.log("server healthy");

  const sampler = serverProc ? new ProcSampler(serverProc.pid) : null;
  sampler?.start();

  // Create games (staggered to stay under the 20 req/s/IP limiter).
  const games = [];
  for (let i = 0; i < GAMES; i++) {
    const g = new LoadGame(i);
    await g.create();
    games.push(g);
    await sleep(60);
  }
  console.log(`created ${games.length} games`);

  await Promise.all(games.map((g) => g.join()));
  const joined = games.reduce((a, g) => a + g.clients.length, 0);
  console.log(`joined ${joined} clients`);

  for (const g of games) g.begin();
  await Promise.all(
    games.map((g) =>
      waitFor(
        () => g.startedClients === g.clients.length,
        30_000,
        `game ${g.id} start`,
      ),
    ),
  );
  console.log("all games started; warming up 5s...");

  for (const g of games) for (const c of g.clients) c.startTraffic();
  await sleep(5000); // warmup: JIT, connection settling

  console.log(`measuring for ${DURATION_S}s...`);
  const windowStart = Date.now();
  metrics.measuring = true;
  await sleep(DURATION_S * 1000);
  metrics.measuring = false;
  metrics.done = true;

  // Teardown clients.
  for (const g of games) for (const c of g.clients) c.stop();
  sampler?.stop();

  // ---------------- report
  const rtt = stats(metrics.rtts);
  const gaps = stats(metrics.turnGaps);
  const joins = stats(metrics.joinLatencies);
  const proc = sampler ? sampler.report(windowStart) : null;

  const allClients = games.flatMap((g) => g.clients);
  const totalMsgs = allClients.reduce((a, c) => a + c.msgsReceived, 0);
  const totalBytes = allClients.reduce((a, c) => a + c.bytesReceived, 0);
  const totalIntents = allClients.reduce((a, c) => a + c.intentsSent, 0);
  const errored = allClients.filter((c) => c.errors.length > 0);
  const closedEarly = allClients.filter((c) => c.closed);

  const result = {
    label: LABEL,
    runtime: RUNTIME,
    timestamp: new Date().toISOString(),
    config: {
      games: GAMES,
      clientsPerGame: CLIENTS_PER_GAME,
      totalClients: GAMES * CLIENTS_PER_GAME,
      durationS: DURATION_S,
      intentRatePerClient: INTENT_RATE,
      numWorkers: NUM_WORKERS,
      turnIntervalMs: 100,
    },
    intentToTurnBroadcastRttMs: rtt,
    turnIntervalMs: gaps,
    joinLatencyMs: joins,
    throughput: {
      turnsReceivedTotal: metrics.turnsReceived,
      clientMsgsReceivedTotal: totalMsgs,
      clientBytesReceivedTotal: totalBytes,
      intentsSentTotal: totalIntents,
    },
    server: proc,
    clientErrors: errored.length,
    clientsClosedEarly: closedEarly.length,
  };

  const outPath = path.join(resultsDir, `${LABEL}.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log(`\n===== RESULTS (${LABEL}) =====`);
  console.log(
    `intent -> turn-broadcast RTT ms (n=${rtt.count}): ` +
      `mean=${fmt(rtt.mean)} p50=${fmt(rtt.p50)} p95=${fmt(rtt.p95)} p99=${fmt(rtt.p99)} max=${fmt(rtt.max)}`,
  );
  console.log(
    `  (includes avg ~${100 / 2}ms inherent wait for the next 100ms turn tick)`,
  );
  console.log(
    `turn interval ms (target 100, n=${gaps.count}): ` +
      `mean=${fmt(gaps.mean)} p50=${fmt(gaps.p50)} p95=${fmt(gaps.p95)} p99=${fmt(gaps.p99)} max=${fmt(gaps.max)}`,
  );
  console.log(
    `join latency ms (n=${joins.count}): mean=${fmt(joins.mean)} p50=${fmt(joins.p50)} p95=${fmt(joins.p95)} max=${fmt(joins.max)}`,
  );
  console.log(
    `throughput: ${(totalMsgs / DURATION_S).toFixed(0)} msgs/s to clients, ` +
      `${(totalBytes / DURATION_S / 1024).toFixed(0)} KiB/s, ` +
      `${(totalIntents / DURATION_S).toFixed(0)} intents/s from clients`,
  );
  if (proc) {
    console.log(
      `server: avg CPU ${proc.avgCpuPct.toFixed(1)}% (of one core, whole tree), ` +
        `peak RSS ${proc.peakRssMb.toFixed(0)} MB, ${proc.procCount} procs`,
    );
  }
  console.log(
    `client errors: ${errored.length}, closed early: ${closedEarly.length}`,
  );
  console.log(`json: ${outPath}`);

  stopServer();
  // Give the process group a moment to die, then force-exit (timers linger).
  await sleep(500);
  process.exit(errored.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  stopServer();
  process.exit(1);
});
