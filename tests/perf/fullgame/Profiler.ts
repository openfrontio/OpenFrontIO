import { Session } from "node:inspector";
import { Execution, Game } from "../../../src/core/game/Game";

// ── Per-tick wall-time statistics ──

export interface TickStatsSummary {
  count: number;
  totalMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  overBudget: number;
  slowest: { tick: number; ms: number }[];
}

export class TickStats {
  private durations: number[] = [];
  private ticks: number[] = [];

  record(tick: number, ms: number): void {
    this.ticks.push(tick);
    this.durations.push(ms);
  }

  summarize(budgetMs: number, slowestN = 10): TickStatsSummary {
    const n = this.durations.length;
    if (n === 0) {
      return {
        count: 0,
        totalMs: 0,
        meanMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        maxMs: 0,
        overBudget: 0,
        slowest: [],
      };
    }
    const sorted = [...this.durations].sort((a, b) => a - b);
    const pct = (p: number) =>
      sorted[Math.min(n - 1, Math.floor((p / 100) * n))];
    const totalMs = this.durations.reduce((a, b) => a + b, 0);
    const indexed = this.durations.map((ms, i) => ({
      tick: this.ticks[i],
      ms,
    }));
    indexed.sort((a, b) => b.ms - a.ms);
    return {
      count: n,
      totalMs,
      meanMs: totalMs / n,
      p50Ms: pct(50),
      p95Ms: pct(95),
      p99Ms: pct(99),
      maxMs: sorted[n - 1],
      overBudget: this.durations.filter((d) => d > budgetMs).length,
      slowest: indexed.slice(0, slowestN),
    };
  }
}

// ── Per-Execution-class profiler ──

export interface ExecClassStats {
  name: string;
  instances: number;
  initCalls: number;
  initMs: number;
  tickCalls: number;
  tickMs: number;
  totalMs: number;
}

/**
 * Wraps every Execution added to the game so init() and tick() are timed,
 * aggregated by execution class name. Attach BEFORE GameRunner.init() so the
 * initial executions (nations, bots, spawn timer, win check) are captured.
 */
export class ExecutionProfiler {
  private byClass = new Map<
    string,
    {
      instances: number;
      initCalls: number;
      initMs: number;
      tickCalls: number;
      tickMs: number;
    }
  >();

  attach(game: Game): void {
    const original = game.addExecution.bind(game);
    game.addExecution = (...execs: Execution[]) => {
      for (const e of execs) {
        this.wrap(e);
      }
      original(...execs);
    };
  }

  private statsFor(name: string) {
    let s = this.byClass.get(name);
    if (s === undefined) {
      s = { instances: 0, initCalls: 0, initMs: 0, tickCalls: 0, tickMs: 0 };
      this.byClass.set(name, s);
    }
    return s;
  }

  private wrap(e: Execution): void {
    const stats = this.statsFor(e.constructor.name);
    stats.instances++;
    const origInit = e.init.bind(e);
    const origTick = e.tick.bind(e);
    e.init = (mg: Game, ticks: number) => {
      const start = performance.now();
      origInit(mg, ticks);
      stats.initMs += performance.now() - start;
      stats.initCalls++;
    };
    e.tick = (ticks: number) => {
      const start = performance.now();
      origTick(ticks);
      stats.tickMs += performance.now() - start;
      stats.tickCalls++;
    };
  }

  report(): ExecClassStats[] {
    const rows: ExecClassStats[] = [];
    for (const [name, s] of this.byClass) {
      rows.push({ name, ...s, totalMs: s.initMs + s.tickMs });
    }
    rows.sort((a, b) => b.totalMs - a.totalMs);
    return rows;
  }
}

// ── V8 sampling CPU profiler (function-level, no instrumentation skew) ──

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

export interface CpuProfile {
  nodes: CpuProfileNode[];
  startTime: number;
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

export interface FunctionSelfTime {
  functionName: string;
  location: string;
  selfMs: number;
  selfPct: number;
}

export class CpuProfiler {
  private session = new Session();

  private post(method: string, params?: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.session.post(method, params, (err, result) =>
        err ? reject(err) : resolve(result),
      );
    });
  }

  async start(samplingIntervalUs = 100): Promise<void> {
    this.session.connect();
    await this.post("Profiler.enable");
    await this.post("Profiler.setSamplingInterval", {
      interval: samplingIntervalUs,
    });
    await this.post("Profiler.start");
  }

  async stop(): Promise<CpuProfile> {
    const { profile } = (await this.post("Profiler.stop")) as {
      profile: CpuProfile;
    };
    this.session.disconnect();
    return profile;
  }
}

/**
 * Aggregates self time per function from a .cpuprofile. Self time is computed
 * from the sample timeline (samples + timeDeltas), falling back to hitCount
 * weighting when the timeline is absent.
 */
export function summarizeCpuProfile(
  profile: CpuProfile,
  projectRoot: string,
): FunctionSelfTime[] {
  const selfUsByNode = new Map<number, number>();
  if (profile.samples && profile.timeDeltas) {
    for (let i = 0; i < profile.samples.length; i++) {
      const nodeId = profile.samples[i];
      const delta = Math.max(0, profile.timeDeltas[i] ?? 0);
      selfUsByNode.set(nodeId, (selfUsByNode.get(nodeId) ?? 0) + delta);
    }
  } else {
    const totalUs = profile.endTime - profile.startTime;
    const totalHits = profile.nodes.reduce((a, n) => a + (n.hitCount ?? 0), 0);
    const usPerHit = totalHits > 0 ? totalUs / totalHits : 0;
    for (const node of profile.nodes) {
      selfUsByNode.set(node.id, (node.hitCount ?? 0) * usPerHit);
    }
  }

  const totalUs = [...selfUsByNode.values()].reduce((a, b) => a + b, 0);
  const byFunction = new Map<string, FunctionSelfTime>();
  for (const node of profile.nodes) {
    const selfUs = selfUsByNode.get(node.id) ?? 0;
    if (selfUs === 0) continue;
    const { functionName, url, lineNumber } = node.callFrame;
    const name = functionName || "(anonymous)";
    let location = url.replace(/^file:\/\//, "");
    if (location.startsWith(projectRoot)) {
      location = location.slice(projectRoot.length + 1);
    }
    // tsx/esbuild collapses line info to 0; only show real line numbers.
    if (location !== "" && lineNumber > 0) {
      location += `:${lineNumber + 1}`;
    }
    const key = `${name}@${location}`;
    const row = byFunction.get(key);
    if (row) {
      row.selfMs += selfUs / 1000;
    } else {
      byFunction.set(key, {
        functionName: name,
        location,
        selfMs: selfUs / 1000,
      } as FunctionSelfTime);
    }
  }

  const rows = [...byFunction.values()];
  for (const row of rows) {
    row.selfPct = totalUs > 0 ? (row.selfMs * 1000 * 100) / totalUs : 0;
  }
  rows.sort((a, b) => b.selfMs - a.selfMs);
  return rows;
}
