// Quick sanity check: random legal-mask actions through the env directly.
import { DEFAULT_ENV_OPTIONS, OpenFrontEnv } from "./OpenFrontEnv";
import { TYPE_COUNT, NUM_SLOTS } from "./protocol";

console.debug = () => {};
console.warn = () => {};
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const opts = { ...DEFAULT_ENV_OPTIONS, ...(args.map ? { map: args.map } : {}), ...(args.bots ? { bots: +args.bots } : {}) };
const env = new OpenFrontEnv(opts, 0);
const d = env.dims;
const GG = d.grid * d.grid;
const spatial = new Float32Array(d.channels * GG);
const scalars = new Float32Array(d.scalars);
const masks = new Uint8Array(d.maskSize);
const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = (off: number, n: number) => {
  const ok: number[] = [];
  for (let i = 0; i < n; i++) if (masks[off + i]) ok.push(i);
  return ok.length ? ok[rnd(ok.length)] : 0;
};
const counts = new Array(TYPE_COUNT).fill(0);
const t0 = performance.now();
await env.reset(1);
console.error("reset ms", (performance.now() - t0).toFixed(0));
let steps = 0, totalR = 0, episodes = 0;
const t1 = performance.now();
const maxSteps = +(args.steps ?? 300);
while (steps < maxSteps) {
  env.observe(spatial, scalars, masks);
  const type = pick(0, TYPE_COUNT);
  const slotOff = type === 11 ? TYPE_COUNT + NUM_SLOTS : TYPE_COUNT;
  const slot = pick(slotOff, NUM_SLOTS);
  const kinds = [0, 0, 0, 0, 0];
  const kindOf: Record<number, number> = { 2: 3, 3: 0, 4: 1, 5: 0, 6: 0, 7: 0, 8: 0, 9: 1, 10: 4, 13: 2 };
  const kind = kindOf[type] ?? 0;
  void kinds;
  const cell = pick(TYPE_COUNT + NUM_SLOTS * 2 + kind * GG, GG);
  counts[type]++;
  const r = env.step(type, slot, rnd(5), cell);
  totalR += r.reward;
  steps++;
  if (steps % 50 === 0) console.error(steps, JSON.stringify(env.info()), "R", totalR.toFixed(3));
  if (r.done) {
    episodes++;
    console.error("done", JSON.stringify(r));
    await env.reset();
  }
}
const dt = (performance.now() - t1) / 1000;
console.error(`steps/s ${(steps / dt).toFixed(1)}  ticks/s ${(steps * opts.decisionInterval / dt).toFixed(0)}  episodes ${episodes}`);
console.error("action counts", counts.join(","));
console.error("spatial sum per channel", Array.from({ length: d.channels }, (_, c) => spatial.slice(c * GG, (c + 1) * GG).reduce((a, b) => a + b, 0).toFixed(1)).join(" "));
console.error("scalars", Array.from(scalars.slice(0, 24)).map((v) => v.toFixed(2)).join(" "));
