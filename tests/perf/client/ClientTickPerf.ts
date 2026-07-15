/**
 * Main-thread tick-processing harness: drives a real singleplayer game in
 * headless Chromium and measures how long the worker→main "game_update"
 * message dispatch takes on the MAIN thread — the per-tick cost that competes
 * with the frame budget (16.7 ms at 60 fps) and causes frame drops on low-end
 * hardware when it runs long.
 *
 * What is measured, per dispatch:
 *   - deserialization: first access to event.data (structured-clone decode)
 *   - handler: WorkerClient.handleWorkerMessage → gameView.update →
 *     webglBuilder.update → renderer.tick
 * Both are captured by wrapping Worker.prototype.addEventListener in an init
 * script, so no product code changes are needed.
 *
 * For attribution, CDP sampling profiles (chrome .cpuprofile files) can be
 * captured over tick windows and are summarized as top self-time functions.
 * Open them in Chrome DevTools → Performance → load profile for flame graphs.
 *
 * The harness starts its own vite dev server on a private port (default
 * 9017) so results always come from THIS checkout, even when another
 * working copy is serving port 9000.
 *
 * One-time browser setup (installs playwright + chromium libs, no sudo):
 *   bash .claude/skills/run-openfront/setup.sh
 *
 * Usage:
 *   npm run perf:client-tick -- --map "Giant World Map" --ticks 2000 \
 *     --window 250 --profile-at 500,1500
 *
 * Flags:
 *   --map <name>          GameMapType value (default "Giant World Map")
 *   --bots <n>            bot count (default 400, the solo-modal default)
 *   --difficulty <d>      Easy|Medium|Hard|Impossible (default modal default)
 *   --ticks <n>           run until this game tick (default 2000)
 *   --window <n>          report stats every n ticks (default 250)
 *   --profile-at <list>   comma-separated ticks to start a CPU profile
 *   --profile-window <n>  ticks each CPU profile spans (default 100)
 *   --spawn <x,y>         fixed human spawn tile (default: auto-pick)
 *   --port <n>            vite dev-server port (default 9017)
 *   --raf-interval <ms>   rAF throttle; SwiftShader frames cost seconds of
 *                         CPU, so an unthrottled frame loop starves the sim
 *                         (default 3000)
 *   --out-dir <dir>       output dir (default tests/perf/output)
 *
 * Headless caveats: rendering uses SwiftShader and the rAF loop is throttled,
 * so this measures the tick-dispatch path, not draw calls. GL upload calls
 * issued inside the dispatch go through SwiftShader's command buffer and cost
 * differently than on real GPUs. Solo games are RNG-driven, so numbers vary
 * a few percent run-to-run; compare trends, not microseconds.
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
  profileAt: number[];
  profileWindow: number;
  spawn: { x: number; y: number } | null;
  port: number;
  rafIntervalMs: number;
  outDir: string;
}

/** One worker→main game-update dispatch, as recorded by the init script. */
interface TickSample {
  /** Game tick of the (last) update in the dispatch. */
  tick: number;
  /** ms spent deserializing event.data (structured-clone decode). */
  deserMs: number;
  /** ms spent in the message handler (gameView/webglBuilder/renderer). */
  handlerMs: number;
  /** Updates in the dispatch (>1 for game_update_batch catch-up). */
  updates: number;
}

interface WindowStats {
  label: string;
  fromTick: number;
  toTick: number;
  dispatches: number;
  updates: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  meanDeserMs: number;
  maxDeserMs: number;
  /** Mean handler ms per game tick (normalizes batched dispatches). */
  meanPerUpdateMs: number;
}

function parseArgs(): Options {
  const opts: Options = {
    map: "Giant World Map",
    bots: 400,
    difficulty: undefined,
    ticks: 2000,
    window: 250,
    profileAt: [],
    profileWindow: 100,
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
      case "--profile-at":
        opts.profileAt = next()
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n));
        break;
      case "--profile-window":
        opts.profileWindow = parseInt(next(), 10);
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

// ---------- stats ----------

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function summarizeWindow(label: string, samples: TickSample[]): WindowStats {
  const handler = samples.map((s) => s.handlerMs).sort((a, b) => a - b);
  const deser = samples.map((s) => s.deserMs);
  const updates = samples.reduce((acc, s) => acc + s.updates, 0);
  const totalHandler = handler.reduce((acc, v) => acc + v, 0);
  return {
    label,
    fromTick: samples.length > 0 ? samples[0].tick : 0,
    toTick: samples.length > 0 ? samples[samples.length - 1].tick : 0,
    dispatches: samples.length,
    updates,
    meanMs: samples.length > 0 ? totalHandler / samples.length : 0,
    p50Ms: quantile(handler, 0.5),
    p95Ms: quantile(handler, 0.95),
    maxMs: handler.length > 0 ? handler[handler.length - 1] : 0,
    meanDeserMs:
      samples.length > 0
        ? deser.reduce((acc, v) => acc + v, 0) / samples.length
        : 0,
    maxDeserMs: deser.length > 0 ? Math.max(...deser) : 0,
    meanPerUpdateMs: updates > 0 ? totalHandler / updates : 0,
  };
}

function printReport(windows: WindowStats[], opts: Options): void {
  console.log(
    `\n=== Main-thread tick dispatch (map=${opts.map}, bots=${opts.bots}) ===`,
  );
  console.log(
    "handler ms per worker game-update dispatch (frame budget at 60 fps: 16.7 ms)",
  );
  console.log(
    `${"window".padEnd(14)} ${"disp".padStart(5)} ${"upd".padStart(5)} ${"mean".padStart(7)} ${"p50".padStart(7)} ${"p95".padStart(7)} ${"max".padStart(7)} ${"deser".padStart(7)} ${"ms/upd".padStart(7)}`,
  );
  for (const w of windows) {
    console.log(
      `${w.label.padEnd(14)} ${String(w.dispatches).padStart(5)} ${String(w.updates).padStart(5)} ${w.meanMs.toFixed(2).padStart(7)} ${w.p50Ms.toFixed(2).padStart(7)} ${w.p95Ms.toFixed(2).padStart(7)} ${w.maxMs.toFixed(2).padStart(7)} ${w.meanDeserMs.toFixed(2).padStart(7)} ${w.meanPerUpdateMs.toFixed(2).padStart(7)}`,
    );
  }
}

// ---------- CPU profile summarization ----------

interface CpuProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
  };
  hitCount?: number;
  children?: number[];
}

interface CpuProfile {
  nodes: CpuProfileNode[];
  startTime: number;
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

/** Print the top-N functions by self time from a V8 sampling profile. */
function summarizeProfile(profile: CpuProfile, top: number): void {
  // Self time per node = sum of timeDeltas for samples attributed to it.
  const selfMicros = new Map<number, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i++) {
    const nodeId = samples[i];
    selfMicros.set(nodeId, (selfMicros.get(nodeId) ?? 0) + (deltas[i] ?? 0));
  }
  const byFunction = new Map<string, number>();
  for (const node of profile.nodes) {
    const micros = selfMicros.get(node.id) ?? 0;
    if (micros === 0) continue;
    const { functionName, url, lineNumber } = node.callFrame;
    const shortUrl = url.replace(/^.*\/(src|node_modules)\//, "$1/");
    const key = `${functionName || "(anonymous)"} ${shortUrl}:${lineNumber + 1}`;
    byFunction.set(key, (byFunction.get(key) ?? 0) + micros);
  }
  const totalMicros = profile.endTime - profile.startTime;
  const rows = [...byFunction.entries()].sort((a, b) => b[1] - a[1]);
  console.log(
    `  top self-time functions (of ${(totalMicros / 1000).toFixed(0)} ms profiled):`,
  );
  for (const [key, micros] of rows.slice(0, top)) {
    const pct = ((micros / totalMicros) * 100).toFixed(1);
    console.log(
      `    ${(micros / 1000).toFixed(1).padStart(8)} ms ${pct.padStart(5)}%  ${key}`,
    );
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
  const {
    startSoloGame,
    waitForGameReady,
    spawn,
    waitForSpawnPhaseEnd,
    waitForTick,
    gameState,
  } =
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

    // Surface in-page failures in the harness log — a broken init script or
    // GL fault otherwise shows up only as an opaque ready-timeout. Blocked
    // external fetches (ads, auth, cosmetics) are expected noise; skip them.
    page.on("console", (msg: { type(): string; text(): string }) => {
      const text = msg.text();
      if (
        msg.type() === "error" &&
        !/Failed to load resource|Failed to fetch|ramp\./.test(text)
      ) {
        console.log(`CONSOLE[error]: ${text}`);
      }
    });

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

    // Time every worker→main "message" dispatch. The first event.data access
    // pays the structured-clone deserialization, so it is timed separately
    // from the handler body. Only game updates are recorded.
    //
    // MUST stay a string, not a function: tsx compiles this file with
    // esbuild's keepNames, which rewrites named function expressions to
    // `__name(fn, "name")` — and the `__name` helper doesn't exist in the
    // page, so a function-form script throws ReferenceError inside
    // Worker.addEventListener and silently kills the game worker setup.
    // (Member-expression assignments like the GL spoof above escape
    // keepNames, which is why that one can stay a function.)
    await page.addInitScript(`(() => {
      // Init scripts also run in dedicated workers, where window is
      // undefined — only the page context is measured.
      if (typeof window === "undefined") return;
      const samples = [];
      window.__tickPerf = {
        take() {
          return samples.splice(0, samples.length);
        },
      };
      const origAdd = Worker.prototype.addEventListener;
      Worker.prototype.addEventListener = function (type, listener, options) {
        if (type !== "message" || typeof listener !== "function") {
          return origAdd.call(this, type, listener, options);
        }
        const wrapped = function (event) {
          const t0 = performance.now();
          const d = event.data; // first access → structured-clone decode
          const t1 = performance.now();
          const isTick = d && d.type === "game_update";
          const isBatch = d && d.type === "game_update_batch";
          if (!isTick && !isBatch) {
            return listener.call(this, event);
          }
          try {
            return listener.call(this, event);
          } finally {
            const t2 = performance.now();
            const updates = isBatch ? (d.gameUpdates ?? []) : [d.gameUpdate];
            const last = updates[updates.length - 1];
            samples.push({
              tick: last ? last.tick : -1,
              deserMs: t1 - t0,
              handlerMs: t2 - t1,
              updates: updates.length,
            });
            // Bounded so a stalled harness can't grow the page's heap.
            if (samples.length > 200000) samples.splice(0, 100000);
          }
        };
        return origAdd.call(this, type, wrapped, options);
      };
    })();`);

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

    // CDP session against the page = the main thread only (the core sim
    // worker is a separate target and not included in CPU profiles).
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });

    const takeSamples = async (): Promise<TickSample[]> =>
      (await page.evaluate(() => (window as any).__tickPerf.take())) ?? [];

    console.log("loading home page + solo modal…");
    await gotoHome(page);
    await openSoloModal(page);

    console.log(
      `starting solo game: map=${opts.map}, bots=${opts.bots}` +
        (opts.difficulty !== undefined
          ? `, difficulty=${opts.difficulty}`
          : ""),
    );
    try {
      await startSoloGame(page, {
        map: opts.map,
        bots: opts.bots,
        ...(opts.difficulty !== undefined
          ? { difficulty: opts.difficulty }
          : {}),
      });
    } catch {
      // Giant maps can exceed the skill's 180 s ready timeout on a cold
      // headless start — give the load one more window before giving up.
      console.log("game not ready after 180 s, waiting another 300 s…");
      await waitForGameReady(page, 300_000);
    }

    console.log("spawning…");
    const tile = await spawn(page, opts.spawn);
    console.log(`spawned at (${tile.x},${tile.y})`);
    await waitForSpawnPhaseEnd(page, 120_000);
    const spawnState = await gameState(page);
    const spawnedTick: number = spawnState?.ticks ?? 0;
    // Spawn-phase dispatches are not representative; drop them.
    await takeSamples();

    const startWall = Date.now();
    const windows: WindowStats[] = [];
    const allSamples: TickSample[] = [];
    const pendingProfiles = [...new Set(opts.profileAt)].sort((a, b) => a - b);

    const captureProfile = async (startTick: number): Promise<void> => {
      const endTick = startTick + opts.profileWindow;
      console.log(`[profile] capturing ticks ${startTick}–${endTick}…`);
      await cdp.send("Profiler.start");
      await waitForTick(page, endTick, opts.profileWindow * 2000 + 120_000);
      const { profile } = await cdp.send("Profiler.stop");
      const file = path.join(opts.outDir, `client-tick${startTick}.cpuprofile`);
      fs.writeFileSync(file, JSON.stringify(profile));
      console.log(`[profile] ${file}`);
      summarizeProfile(profile as CpuProfile, 25);
    };

    const targets: number[] = [];
    for (let t = spawnedTick + opts.window; t < opts.ticks; t += opts.window) {
      targets.push(t);
    }
    if (opts.ticks > spawnedTick) targets.push(opts.ticks);

    for (const target of targets) {
      // A due profile splits the window: profile spans real ticks inside it.
      while (pendingProfiles.length > 0 && pendingProfiles[0] < target) {
        const at = pendingProfiles.shift()!;
        const state = await gameState(page);
        const current: number = state?.ticks ?? 0;
        if (at > current) {
          // Generous timeout: headless sim speed varies wildly with map size
          // and bot count (0.5–10 ticks/s).
          await waitForTick(page, at, (at - current) * 2000 + 120_000);
        }
        await captureProfile(Math.max(at, current));
      }
      const state = await gameState(page);
      const current: number = state?.ticks ?? 0;
      if (target > current) {
        await waitForTick(page, target, (target - current) * 2000 + 120_000);
      }
      const samples = await takeSamples();
      allSamples.push(...samples);
      const w = summarizeWindow(`tick ${target}`, samples);
      windows.push(w);
      console.log(
        `[window] ${w.label}: ${w.dispatches} dispatches, mean ${w.meanMs.toFixed(2)} ms, p95 ${w.p95Ms.toFixed(2)} ms, max ${w.maxMs.toFixed(2)} ms`,
      );
    }
    // Any profiles requested at/beyond the final tick.
    while (pendingProfiles.length > 0) {
      await captureProfile(pendingProfiles.shift()!);
    }

    const samplesFile = path.join(opts.outDir, "client-tick-samples.json");
    fs.writeFileSync(samplesFile, JSON.stringify(allSamples));
    console.log(`[samples] ${samplesFile} (${allSamples.length} dispatches)`);

    // End-of-run screenshot — a cheap rendering sanity check (a black map
    // means the GL pipeline broke even if no pageerror surfaced).
    const shotPath = path.join(opts.outDir, "client-tick-final.png");
    await page.screenshot({ path: shotPath });
    console.log(`[screenshot] ${shotPath}`);

    printReport(windows, opts);
    printReport([summarizeWindow("overall", allSamples)], {
      ...opts,
      map: `${opts.map} (all windows)`,
    });
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
