// Flag `phaseGates` (C1): the tick literals in the rules read sit.phase. Here the endgame branch of fight() — at
// 25:00 (or the push) a war is sent at 1.2× with 70 % of home instead of 2× with fightMaxShare — fires on a forced
// endgame phase (rank ≤ 3 and an unfriendly silo) long before tick 15000; off, the same set-up sends nothing.
import { describe, expect, test } from "vitest";
import { horizon, horizonForPhase } from "../../src/core/execution/playbook/Spend";
import { PlayerType, UnitType } from "../../src/core/game/Game";
import { playbookSetup, Rect } from "../util/PlaybookSetup";

const ME: Rect = [30, 25, 70, 57];
const RV: Rect = [30, 58, 70, 90];

async function siloNextDoor(phaseGates: boolean) {
  const h = await playbookSetup({
    spawn: [50, 40], tiles: ME, troops: 1000,
    bot: { phaseGates, fightNotBeforeTick: 0, fightMinCities: 0, expandFree: 0, expandContested: 0 },
    rivals: [{ name: "R", type: PlayerType.Nation, at: [50, 75], tiles: RV, troops: 1000 }],
  });
  const r = h.rival("R");
  const cap = h.game.config().maxTroops(h.me);
  h.me.setTroops(Math.floor(cap * 0.9)); // over fightAbove, under the 0.95 "at cap" line
  r.setTroops(Math.floor(cap * 0.45)); // half our army: 1.2× is affordable (0.7 × home), 2× is not
  expect(r.buildUnit(UnitType.MissileSilo, h.game.ref(50, 80), {})).toBeTruthy();
  h.step(h.nextRuleTick(10));
  const sit = (h.bot as unknown as { sit: { phase: string; tick: number } }).sit;
  return { h, r, sit };
}

describe("phaseGates", () => {
  test("on: a forced endgame phase takes fight()'s endgame branch (1.2× with 70 % of home)", async () => {
    const { h, r, sit } = await siloNextDoor(true);
    expect(sit.tick).toBeLessThan(100);
    expect(sit.phase).toBe("endgame");
    const line = h.log.find((l) => /ATTACK R /.test(l));
    expect(line).toBeDefined();
    const ratio = Number(/\((\d+\.\d+)×\)/.exec(line!)![1]);
    expect(ratio).toBeGreaterThanOrEqual(1.2);
    expect(ratio).toBeLessThan(2);
    expect(h.me.outgoingAttacks().some((a) => a.target() === r)).toBe(true);
  });

  test("off: the same phase is computed but tick 15000 gates the branch, so nothing is sent", async () => {
    const { h, sit } = await siloNextDoor(false);
    expect(sit.phase).toBe("endgame");
    expect(h.log.some((l) => /ATTACK R /.test(l))).toBe(false);
    expect(h.me.outgoingAttacks()).toHaveLength(0);
  });

  test("Spend.horizonForPhase: a 10-minute block early, 4000 at war, the 25:00 clock in the endgame", () => {
    expect(horizonForPhase("opening", 100)).toBe(6000);
    expect(horizonForPhase("consolidate", 5000)).toBe(6000);
    expect(horizonForPhase("war", 5000)).toBe(4000);
    expect(horizonForPhase("endgame", 9000)).toBe(6000);
    expect(horizonForPhase("endgame", 14500)).toBe(1000);
    expect(horizonForPhase("endgame", 16000)).toBe(1000);
    expect(horizonForPhase("endgame", 13000)).toBe(horizon(13000)); // agrees with the clock once both count down to 25:00
  });
});
