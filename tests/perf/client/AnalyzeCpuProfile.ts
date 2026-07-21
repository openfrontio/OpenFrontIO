// Inclusive-time breakdown of the tick-dispatch subtree in a .cpuprofile
// captured by ClientTickPerf. Attributes every sampled stack under the
// harness's "wrapped" listener to each enclosing function, so the phase
// split (gameView.update vs uploadFrameData vs renderer.tick) is visible.
// Usage: npx tsx tests/perf/client/AnalyzeCpuProfile.ts <file> [rootName]
import fs from "fs";

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  hitCount?: number;
  children?: number[];
}

interface Profile {
  nodes: ProfileNode[];
  startTime: number;
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

const file = process.argv[2];
const rootName = process.argv[3] ?? "wrapped";
const p: Profile = JSON.parse(fs.readFileSync(file, "utf8"));

const byId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map<number, number>();
for (const n of p.nodes) {
  for (const c of n.children ?? []) parent.set(c, n.id);
}

// Self micros per node id from samples/timeDeltas.
const selfMicros = new Map<number, number>();
const samples = p.samples ?? [];
const deltas = p.timeDeltas ?? [];
for (let i = 0; i < samples.length; i++) {
  selfMicros.set(
    samples[i],
    (selfMicros.get(samples[i]) ?? 0) + (deltas[i] ?? 0),
  );
}

// True when a node's ancestry (inclusive) contains a rootName frame.
const underRoot = (id: number): boolean => {
  for (
    let cur: number | undefined = id;
    cur !== undefined;
    cur = parent.get(cur)
  ) {
    if (byId.get(cur)?.callFrame.functionName === rootName) return true;
  }
  return false;
};

// Attribute each in-subtree sample to every enclosing function (inclusive
// time), stopping at the root frame.
let rootTotal = 0;
const inclusiveByFn = new Map<string, number>();
for (const [id, micros] of selfMicros) {
  if (!underRoot(id)) continue;
  rootTotal += micros;
  const seen = new Set<string>();
  for (
    let cur: number | undefined = id;
    cur !== undefined;
    cur = parent.get(cur)
  ) {
    const cf = byId.get(cur)?.callFrame;
    if (!cf) break;
    const url = cf.url.replace(/^.*\/(src|node_modules)\//, "$1/");
    const key = `${cf.functionName || "(anonymous)"} ${url}:${cf.lineNumber + 1}`;
    if (!seen.has(key)) {
      seen.add(key);
      inclusiveByFn.set(key, (inclusiveByFn.get(key) ?? 0) + micros);
    }
    if (cf.functionName === rootName) break;
  }
}

console.log(
  `total under "${rootName}": ${(rootTotal / 1000).toFixed(1)} ms of ${((p.endTime - p.startTime) / 1000).toFixed(0)} ms profile`,
);
const rows = [...inclusiveByFn.entries()].sort((a, b) => b[1] - a[1]);
for (const [key, micros] of rows.slice(0, 40)) {
  const pct = ((micros / rootTotal) * 100).toFixed(1);
  console.log(
    `${(micros / 1000).toFixed(1).padStart(9)} ms ${pct.padStart(5)}%  ${key}`,
  );
}
