import { Session } from "node:inspector";
import { PerformanceObserver } from "node:perf_hooks";
import v8 from "node:v8";

// ── GC pause tracking (PerformanceObserver on 'gc' entries) ──

export type GcKind = "minor" | "major" | "incremental" | "weakcb";

const KIND_NAMES: Record<number, GcKind> = {
  1: "minor", // NODE_PERFORMANCE_GC_MINOR (scavenge)
  4: "major", // NODE_PERFORMANCE_GC_MAJOR (mark-sweep-compact)
  8: "incremental", // NODE_PERFORMANCE_GC_INCREMENTAL (marking steps)
  16: "weakcb", // NODE_PERFORMANCE_GC_WEAKCB (weak callbacks)
};

export interface GcEvent {
  kind: GcKind;
  /** performance.now() timeline of when the GC started. */
  startTime: number;
  durationMs: number;
}

export interface GcKindSummary {
  count: number;
  totalMs: number;
  maxMs: number;
}

export type GcSummary = Record<GcKind, GcKindSummary> & {
  all: GcKindSummary;
};

export function summarizeGcEvents(events: GcEvent[]): GcSummary {
  const empty = (): GcKindSummary => ({ count: 0, totalMs: 0, maxMs: 0 });
  const summary: GcSummary = {
    minor: empty(),
    major: empty(),
    incremental: empty(),
    weakcb: empty(),
    all: empty(),
  };
  for (const e of events) {
    for (const bucket of [summary[e.kind], summary.all]) {
      bucket.count++;
      bucket.totalMs += e.durationMs;
      bucket.maxMs = Math.max(bucket.maxMs, e.durationMs);
    }
  }
  return summary;
}

/**
 * Records every GC the process performs, with timestamps, so pauses can be
 * attributed to time windows after the fact. The tick loop is synchronous and
 * V8 only dispatches buffered GC entries to observers on a later timer task
 * (setImmediate and takeRecords() both see nothing), so stop() awaits timer
 * ticks until no new entries arrive.
 */
export class GcTracker {
  private observer: PerformanceObserver | null = null;
  readonly events: GcEvent[] = [];

  start(): void {
    this.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // Node's PerformanceEntry has .detail; the bundled DOM type does not.
        const detail = (entry as { detail?: { kind?: number } }).detail;
        const kind = KIND_NAMES[detail?.kind ?? 0];
        if (kind === undefined) continue;
        this.events.push({
          kind,
          startTime: entry.startTime,
          durationMs: entry.duration,
        });
      }
    });
    this.observer.observe({ entryTypes: ["gc"] });
  }

  async stop(): Promise<GcEvent[]> {
    let idleRounds = 0;
    let lastCount = this.events.length;
    while (idleRounds < 3) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (this.events.length === lastCount) {
        idleRounds++;
      } else {
        idleRounds = 0;
        lastCount = this.events.length;
      }
    }
    this.observer?.disconnect();
    this.observer = null;
    return this.events;
  }

  /** Events whose start falls in [fromTime, toTime) on the performance.now() timeline. */
  eventsBetween(fromTime: number, toTime: number): GcEvent[] {
    return this.events.filter(
      (e) => e.startTime >= fromTime && e.startTime < toTime,
    );
  }
}

// ── Per-window heap sampling (allocation-rate proxy) ──

export interface HeapWindow {
  label: string;
  ticks: number;
  wallMs: number;
  /**
   * Sum of positive used-heap deltas between consecutive ticks. This is a
   * lower bound on bytes allocated (allocation and collection inside a single
   * tick cancel out), but tracks churn trends well at ~10ms ticks.
   */
  allocatedBytes: number;
  heapUsedEnd: number;
  /** Filled in after the run from GcTracker events. */
  startTime: number;
  endTime: number;
}

/**
 * Call tick() after every simulation tick and closeWindow() at reporting
 * boundaries. Uses v8.getHeapStatistics() (no /proc reads, unlike
 * process.memoryUsage()).
 */
export class HeapSampler {
  private windows: HeapWindow[] = [];
  private lastHeapUsed: number;
  private windowStartTime: number;
  private windowAllocated = 0;
  private windowTicks = 0;

  constructor() {
    this.lastHeapUsed = v8.getHeapStatistics().used_heap_size;
    this.windowStartTime = performance.now();
  }

  tick(): void {
    const used = v8.getHeapStatistics().used_heap_size;
    const delta = used - this.lastHeapUsed;
    if (delta > 0) {
      this.windowAllocated += delta;
    }
    this.lastHeapUsed = used;
    this.windowTicks++;
  }

  closeWindow(label: string): HeapWindow {
    const now = performance.now();
    const window: HeapWindow = {
      label,
      ticks: this.windowTicks,
      wallMs: now - this.windowStartTime,
      allocatedBytes: this.windowAllocated,
      heapUsedEnd: v8.getHeapStatistics().used_heap_size,
      startTime: this.windowStartTime,
      endTime: now,
    };
    this.windows.push(window);
    this.windowStartTime = now;
    this.windowAllocated = 0;
    this.windowTicks = 0;
    return window;
  }

  all(): HeapWindow[] {
    return this.windows;
  }
}

// ── V8 sampling heap profiler (allocation sites, includes collected objects) ──

interface SamplingHeapProfileNode {
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
  };
  selfSize: number;
  children?: SamplingHeapProfileNode[];
}

export interface SamplingHeapProfile {
  head: SamplingHeapProfileNode;
  samples: unknown[];
}

export interface AllocationSite {
  functionName: string;
  location: string;
  selfBytes: number;
  selfPct: number;
}

/**
 * Samples allocations (including objects already collected, i.e. churn) and
 * attributes bytes to the allocating function. Sampled — low overhead, sizes
 * are statistical estimates.
 */
export class AllocationSampler {
  private session = new Session();

  private post(method: string, params?: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.session.post(method, params, (err, result) =>
        err ? reject(err) : resolve(result),
      );
    });
  }

  async start(samplingIntervalBytes = 65536): Promise<void> {
    this.session.connect();
    await this.post("HeapProfiler.enable");
    await this.post("HeapProfiler.startSampling", {
      samplingInterval: samplingIntervalBytes,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
  }

  async stop(): Promise<SamplingHeapProfile> {
    const { profile } = (await this.post("HeapProfiler.stopSampling")) as {
      profile: SamplingHeapProfile;
    };
    this.session.disconnect();
    return profile;
  }
}

/** Aggregates self-allocated bytes per function from a sampling heap profile. */
export function summarizeAllocationProfile(
  profile: SamplingHeapProfile,
  projectRoot: string,
): { sites: AllocationSite[]; totalBytes: number } {
  const bySite = new Map<string, AllocationSite>();
  let totalBytes = 0;

  const visit = (node: SamplingHeapProfileNode): void => {
    if (node.selfSize > 0) {
      totalBytes += node.selfSize;
      const { functionName, url, lineNumber } = node.callFrame;
      const name = functionName || "(anonymous)";
      let location = url.replace(/^file:\/\//, "");
      if (location.startsWith(projectRoot)) {
        location = location.slice(projectRoot.length + 1);
      }
      if (location !== "" && lineNumber > 0) {
        location += `:${lineNumber + 1}`;
      }
      const key = `${name}@${location}`;
      const site = bySite.get(key);
      if (site) {
        site.selfBytes += node.selfSize;
      } else {
        bySite.set(key, {
          functionName: name,
          location,
          selfBytes: node.selfSize,
        } as AllocationSite);
      }
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(profile.head);

  const sites = [...bySite.values()];
  for (const site of sites) {
    site.selfPct = totalBytes > 0 ? (site.selfBytes * 100) / totalBytes : 0;
  }
  sites.sort((a, b) => b.selfBytes - a.selfBytes);
  return { sites, totalBytes };
}

// ── Live-heap footprint checkpoints ──

export interface FootprintCheckpoint {
  label: string;
  /** used_heap_size after a forced full GC — the live set. */
  liveHeapBytes: number;
  totalHeapBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
  rssBytes: number;
}

/**
 * Forces a full GC (twice, so objects freed by finalizers in the first pass
 * are also collected) and returns the resulting heap statistics. Requires the
 * process to run with --expose-gc; returns null otherwise.
 */
export function takeFootprintCheckpoint(
  label: string,
): FootprintCheckpoint | null {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc === undefined) {
    return null;
  }
  gc();
  gc();
  const heap = v8.getHeapStatistics();
  const mem = process.memoryUsage();
  return {
    label,
    liveHeapBytes: heap.used_heap_size,
    totalHeapBytes: heap.total_heap_size,
    externalBytes: mem.external,
    arrayBuffersBytes: mem.arrayBuffers,
    rssBytes: mem.rss,
  };
}
