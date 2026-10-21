import { describe, expect, it } from "vitest";
import { DEFAULT_ENV_OPTIONS, OpenFrontEnv } from "../rl/OpenFrontEnv";
import { ActionType, NUM_SLOTS, TYPE_COUNT } from "../rl/protocol";

// Exercises the headless RL environment on the real engine (compact world map).
describe("RL environment", () => {
  const opts = { ...DEFAULT_ENV_OPTIONS, bots: 10, maxDecisions: 40 };

  it("only allows spawning during the spawn phase, then plays", async () => {
    const env = new OpenFrontEnv(opts, 0);
    const d = env.dims;
    const GG = d.grid * d.grid;
    const spatial = new Float32Array(d.channels * GG);
    const scalars = new Float32Array(d.scalars);
    const masks = new Uint8Array(d.maskSize);

    await env.reset(7);
    env.observe(spatial, scalars, masks);
    const legalTypes = [...Array(TYPE_COUNT).keys()].filter((t) => masks[t]);
    expect(legalTypes).toEqual([ActionType.Spawn]);

    const landOff = TYPE_COUNT + NUM_SLOTS * 2 + 2 * GG;
    const cell = [...Array(GG).keys()].find((i) => masks[landOff + i])!;
    const res = env.step(ActionType.Spawn, 0, 0, cell);
    expect(res.done).toBe(false);
    expect(res.ticks).toBeGreaterThan(50);

    env.observe(spatial, scalars, masks);
    expect(masks[ActionType.Noop]).toBe(1);
    expect(masks[ActionType.Spawn]).toBe(0);
    expect(spatial.slice(GG, 2 * GG).some((v) => v > 0)).toBe(true); // "mine" channel

    let total = 0;
    for (let i = 0; i < opts.maxDecisions + 1; i++) {
      const r = env.step(ActionType.Noop, 0, 0, 0);
      total += r.reward;
      expect(Number.isFinite(r.reward)).toBe(true);
      if (r.done) break;
    }
    expect(Number.isFinite(total)).toBe(true);
  });

  it("is deterministic for a given seed", async () => {
    const run = async () => {
      const env = new OpenFrontEnv(opts, 0);
      const d = env.dims;
      const GG = d.grid * d.grid;
      const masks = new Uint8Array(d.maskSize);
      const spatial = new Float32Array(d.channels * GG);
      const scalars = new Float32Array(d.scalars);
      await env.reset(11);
      env.observe(spatial, scalars, masks);
      const cell = [...Array(GG).keys()].find(
        (i) => masks[TYPE_COUNT + NUM_SLOTS * 2 + 2 * GG + i],
      )!;
      env.step(ActionType.Spawn, 0, 0, cell);
      for (let i = 0; i < 15; i++) env.step(ActionType.Attack, 0, 2, 0);
      return JSON.stringify(env.info());
    };
    expect(await run()).toEqual(await run());
  });
});
