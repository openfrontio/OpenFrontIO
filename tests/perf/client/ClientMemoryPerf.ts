/**
 * Main-thread memory harness: drives a real singleplayer game in headless
 * Chromium and measures the page's JS heap with forced-GC checkpoints and
 * full V8 heap snapshots taken over the Chrome DevTools Protocol.
 *
 * The core simulation runs in a Web Worker, so a page-session snapshot
 * isolates the MAIN thread: GameView state, rendering layers, UI components.
 * Snapshots are the standard V8 format — analyze them with
 *   npx tsx tests/perf/fullgame/HeapSnapshotRetainers.ts <file> [top]
 * (or HeapSnapshotSummary.ts for multi-GB files).
 *
 * The harness starts its own vite dev server on a private port (default
 * 9017) so results always come from THIS checkout, even when another
 * working copy is serving port 9000.
 *
 * One-time browser setup (installs playwright + chromium libs, no sudo):
 *   bash .claude/skills/run-openfront/setup.sh
 *
 * Usage:
 *   npm run perf:client-mem -- --map "Giant World Map" --ticks 3000 \
 *     --window 500 --snapshot-at 0,3000
 *
 * Flags:
 *   --map <name>          GameMapType value (default "Giant World Map")
 *   --bots <n>            bot count (default 400, the solo-modal default)
 *   --difficulty <d>      Easy|Medium|Hard|Impossible (default modal default)
 *   --ticks <n>           run until this game tick (default 3000)
 *   --window <n>          checkpoint every n ticks (default 500)
 *   --snapshot-at <list>  comma-separated ticks to snapshot; 0 = post-spawn
 *   --spawn <x,y>         fixed human spawn tile (default: auto-pick),
 *                         for run-to-run repeatability on a given map
 *   --port <n>            vite dev-server port (default 9017)
 *   --raf-interval <ms>   rAF throttle; SwiftShader frames cost seconds of
 *                         CPU, so an unthrottled frame loop starves the sim
 *                         (default 3000)
 *   --out-dir <dir>       output dir (default tests/perf/output)
 *
 * Headless caveats: rendering uses SwiftShader, so GPU texture memory lives
 * in the GPU process and is NOT in these numbers — this measures main-thread
 * JS heap + ArrayBuffers (which is where GameView, layers, and pixel staging
 * buffers live). Solo games are RNG-driven (bot spawns), so numbers vary a
 * few percent run-to-run; compare trends, not bytes.
 */
import { ChildProcess, spawn as spawnProcess } from "child_process";
import fs from "fs";
import path from "path";

interface Options {
  map: string;
  bots: number;
  difficulty: string | undefined;
  ticks: number;
  window: number;
  snapshotAt: number[];
  spawn: { x: number; y: number } | null;
  port: number;
  rafIntervalMs: number;
  outDir: string;
}

interface Checkpoint {
  label: string;
  ticks: number;
  wallMs: number;
  jsHeapUsedBytes: number;
  jsHeapTotalBytes: number;
  backingStoreBytes: number;
  embedderHeapBytes: number;
  domNodes: number;
  jsEventListeners: number;
  documents: number;
}

function parseArgs(): Options {
  const opts: Options = {
    map: "Giant World Map",
    bots: 400,
    difficulty: undefined,
    ticks: 3000,
    window: 500,
    snapshotAt: [],
    spawn: null,
    port: 9017,
    rafIntervalMs: 3000,
    outDir: path.join("tests", "perf", "output"),
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--map":
        opts.map = next();
        break;
      case "--bots":
        opts.bots = parseInt(next(), 10);
        break;
      case "--difficulty":
        opts.difficulty = next();
        break;
      case "--ticks":
        opts.ticks = parseInt(next(), 10);
        break;
      case "--window":
        opts.window = parseInt(next(), 10);
        break;
      case "--snapshot-at":
        opts.snapshotAt = next()
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n));
        break;
      case "--spawn": {
        const [x, y] = next().split(",").map(Number);
        opts.spawn = { x, y };
        break;
      }
      case "--port":
        opts.port = parseInt(next(), 10);
        break;
      case "--raf-interval":
        opts.rafIntervalMs = parseInt(next(), 10);
        break;
      case "--out-dir":
        opts.outDir = next();
        break;
      default:
        throw new Error(`unknown flag: ${argv[i]}`);
    }
  }
  return opts;
}

// ---------- dev server ----------

async function startViteServer(port: number): Promise<ChildProcess> {
  // --strictPort makes vite exit instead of silently picking another port —
  // that also guards against measuring a different checkout's server.
  const child = spawnProcess(
    "npx",
    ["vite", "--port", String(port), "--strictPort"],
    {
      env: { ...process.env, SKIP_BROWSER_OPEN: "true" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true, // own process group, so cleanup kills vite's children
    },
  );
  let output = "";
  child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (output += d.toString()));

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `vite exited with code ${child.exitCode} (port ${port} busy?)\n${output}`,
      );
    }
    try {
      const res = await fetch(`http://localhost:${port}/`);
      if (res.ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`vite did not become ready on port ${port}\n${output}`);
}

function stopViteServer(child: ChildProcess): void {
  if (child.pid !== undefined && child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGTERM"); // whole process group
    } catch {
      // already gone
    }
  }
}

// ---------- report ----------

const fmtMB = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);

function printReport(checkpoints: Checkpoint[], opts: Options): void {
  console.log(
    `\n=== Main-thread memory (map=${opts.map}, bots=${opts.bots}) ===`,
  );
  console.log(
    `${"label".padEnd(12)} ${"ticks".padStart(6)} ${"heapUsed".padStart(9)} ${"heapTotal".padStart(10)} ${"buffers".padStart(9)} ${"domNodes".padStart(9)} ${"listeners".padStart(9)} ${"ticks/s".padStart(8)}`,
  );
  let prev: Checkpoint | null = null;
  for (const c of checkpoints) {
    const rate =
      prev !== null && c.wallMs > prev.wallMs
        ? ((c.ticks - prev.ticks) / ((c.wallMs - prev.wallMs) / 1000)).toFixed(
            1,
          )
        : "-";
    console.log(
      `${c.label.padEnd(12)} ${String(c.ticks).padStart(6)} ${fmtMB(c.jsHeapUsedBytes).padStart(6)} MB ${fmtMB(c.jsHeapTotalBytes).padStart(7)} MB ${fmtMB(c.backingStoreBytes).padStart(6)} MB ${String(c.domNodes).padStart(9)} ${String(c.jsEventListeners).padStart(9)} ${rate.padStart(8)}`,
    );
    prev = c;
  }
}

// ---------- main ----------

async function main(): Promise<void> {
  const opts = parseArgs();
  fs.mkdirSync(opts.outDir, { recursive: true });

  console.log(`starting vite on port ${opts.port}…`);
  const vite = await startViteServer(opts.port);

  // The skill driver reads OPENFRONT_URL at import time, so set it before
  // the dynamic imports below.
  process.env.OPENFRONT_URL = `http://localhost:${opts.port}`;
  const { launch, gotoHome, openSoloModal } =
    // @ts-expect-error untyped .mjs skill module
    await import("../../../.claude/skills/run-openfront/driver.mjs");
  const { startSoloGame, spawn, waitForSpawnPhaseEnd, gameState } =
    // @ts-expect-error untyped .mjs skill module
    await import("../../../.claude/skills/run-openfront/game.mjs");

  let browser: { close(): Promise<void> } | null = null;
  try {
    console.log("launching headless chromium…");
    const launched = await launch({
      rafIntervalMs: opts.rafIntervalMs,
      // Headless Chromium throttles backgrounded/occluded pages, which
      // starves the singleplayer turn loop on top of SwiftShader's cost.
      args: [
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ],
    });
    browser = launched.browser;
    const page = launched.page;

    // Headless Chromium only has SwiftShader, and the WebGL gate (#4324)
    // refuses software renderers by matching the unmasked renderer string.
    // Spoof the string so the gate passes; rendering still runs on
    // SwiftShader (hence the rAF throttle).
    await page.addInitScript(() => {
      const orig = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (p: number) {
        const v = orig.call(this, p);
        return typeof v === "string"
          ? v.replace(/swiftshader|llvmpipe|software/gi, "PerfHarnessGPU")
          : v;
      };
    });

    // Solo games are fully local: block external requests (ad scripts) and
    // all websockets — vite's HMR socket times out under heavy throttling
    // and force-reloads the page mid-game.
    await page.route("**/*", (route: any) => {
      const host = new URL(route.request().url()).hostname;
      return host === "localhost" || host === "127.0.0.1"
        ? route.continue()
        : route.abort();
    });
    await page.routeWebSocket("**", () => {});

    // CDP session against the page = the main thread's isolate only (the
    // core sim worker is a separate target and not included).
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.enable");
    await cdp.send("Performance.enable");

    const startWall = Date.now();
    const checkpoints: Checkpoint[] = [];

    const checkpoint = async (label: string): Promise<Checkpoint> => {
      // Two forced GCs: the first can leave finalizer garbage behind.
      await cdp.send("HeapProfiler.collectGarbage");
      await cdp.send("HeapProfiler.collectGarbage");
      const { metrics } = await cdp.send("Performance.getMetrics");
      const m = new Map<string, number>(
        metrics.map((x: { name: string; value: number }) => [x.name, x.value]),
      );
      // JSHeapUsedSize excludes ArrayBuffer backing stores — where most
      // render-layer memory lives. Newer CDP reports them here.
      const usage = (await cdp.send("Runtime.getHeapUsage")) as {
        usedSize: number;
        totalSize: number;
        backingStorageSize?: number;
        embedderHeapUsedSize?: number;
      };
      const state = await gameState(page);
      const c: Checkpoint = {
        label,
        ticks: state?.ticks ?? 0,
        wallMs: Date.now() - startWall,
        jsHeapUsedBytes: m.get("JSHeapUsedSize") ?? 0,
        jsHeapTotalBytes: m.get("JSHeapTotalSize") ?? 0,
        backingStoreBytes: usage.backingStorageSize ?? 0,
        embedderHeapBytes: usage.embedderHeapUsedSize ?? 0,
        domNodes: m.get("Nodes") ?? 0,
        jsEventListeners: m.get("JSEventListeners") ?? 0,
        documents: m.get("Documents") ?? 0,
      };
      checkpoints.push(c);
      console.log(
        `[checkpoint] ${label}: tick ${c.ticks}, heap ${fmtMB(c.jsHeapUsedBytes)} MB used / ${fmtMB(c.jsHeapTotalBytes)} MB total, buffers ${fmtMB(c.backingStoreBytes)} MB, ${c.domNodes} DOM nodes`,
      );
      return c;
    };

    const writeSnapshot = async (label: string): Promise<void> => {
      const file = path.join(opts.outDir, `client-${label}.heapsnapshot`);
      const ws = fs.createWriteStream(file);
      const onChunk = (p: { chunk: string }) => ws.write(p.chunk);
      cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
      // All chunks are delivered before takeHeapSnapshot resolves.
      await cdp.send("HeapProfiler.takeHeapSnapshot", {
        reportProgress: false,
      });
      cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
      await new Promise((r) => ws.end(r));
      const mb = (fs.statSync(file).size / 1024 / 1024).toFixed(0);
      console.log(`[snapshot] ${file} (${mb} MB)`);
    };

    console.log("loading home page + solo modal…");
    await gotoHome(page);
    await openSoloModal(page);

    console.log(
      `starting solo game: map=${opts.map}, bots=${opts.bots}` +
        (opts.difficulty !== undefined
          ? `, difficulty=${opts.difficulty}`
          : ""),
    );
    await startSoloGame(page, {
      map: opts.map,
      bots: opts.bots,
      ...(opts.difficulty !== undefined ? { difficulty: opts.difficulty } : {}),
    });
    await checkpoint("loaded");

    console.log("spawning…");
    const tile = await spawn(page, opts.spawn);
    console.log(`spawned at (${tile.x},${tile.y})`);
    await waitForSpawnPhaseEnd(page, 120_000);
    await checkpoint("spawned");

    const pendingSnapshots = [...new Set(opts.snapshotAt)].sort(
      (a, b) => a - b,
    );
    const takeDueSnapshots = async (currentTick: number): Promise<void> => {
      while (
        pendingSnapshots.length > 0 &&
        pendingSnapshots[0] <= currentTick
      ) {
        await writeSnapshot(`tick${pendingSnapshots.shift()}`);
      }
    };
    const spawnedTick = checkpoints[checkpoints.length - 1].ticks;
    await takeDueSnapshots(spawnedTick);

    const targets: number[] = [];
    for (let t = spawnedTick + opts.window; t < opts.ticks; t += opts.window) {
      targets.push(t);
    }
    if (opts.ticks > spawnedTick) targets.push(opts.ticks);
    for (const target of targets) {
      // Generous timeout: headless sim speed varies wildly with map size
      // and bot count (0.5–10 ticks/s).
      const timeout = opts.window * 2000 + 120_000;
      await page.waitForFunction(
        (t: number) => {
          const g = (document.querySelector("build-menu") as any)?.game;
          return g !== undefined && g.ticks() >= t;
        },
        target,
        { timeout, polling: 1000 },
      );
      const c = await checkpoint(`tick ${target}`);
      await takeDueSnapshots(c.ticks);
    }
    // Anything requested beyond the reached tick range.
    await takeDueSnapshots(Number.MAX_SAFE_INTEGER);

    // End-of-run screenshot — a cheap rendering sanity check (a black map
    // means the GL pipeline broke even if no pageerror surfaced).
    const shotPath = path.join(opts.outDir, "client-final.png");
    await page.screenshot({ path: shotPath });
    console.log(`[screenshot] ${shotPath}`);

    printReport(checkpoints, opts);
    const finalState = await gameState(page);
    console.log(
      `\nfinal state: ${JSON.stringify(finalState)}\ntotal wall time ${((Date.now() - startWall) / 1000 / 60).toFixed(1)} min`,
    );
  } finally {
    await browser?.close();
    stopViteServer(vite);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
