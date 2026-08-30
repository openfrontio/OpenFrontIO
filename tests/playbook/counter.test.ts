// Rule: counterAttack — opposing attacks cancel troop-for-troop, so a non-bot wave that would cost real land is
// answered with ≈1.05× its size (capped at half of home). "Big" is > 15 % of our troops, or > 5 % when no
// defence post faces the attacker.
import { describe, expect, test } from "vitest";
import { PlayerType, UnitType } from "../../src/core/game/Game";
import { playbookSetup, Rect } from "../util/PlaybookSetup";

const ME: Rect = [30, 25, 70, 57];
const RV: Rect = [30, 58, 70, 90];

async function scenario(incomingTroops: number, post = false) {
  const h = await playbookSetup({
    spawn: [50, 40],
    tiles: ME,
    troops: 100_000,
    rivals: [
      {
        name: "R",
        type: PlayerType.Nation,
        at: [50, 75],
        tiles: RV,
        troops: 100_000,
      },
    ],
  });
  const r = h.rival("R");
  if (post) h.me.buildUnit(UnitType.DefensePost, h.game.ref(50, 54), {});
  h.attack(r, h.me, incomingTroops);
  // land the attack, then stop just before the tick on which the counter rule (every 10) runs
  h.step(h.nextRuleTick(10) - 1);
  const inc0 =
    h.me
      .incomingAttacks()
      .find((a) => a.attacker() === r)
      ?.troops() ?? 0;
  h.step(1); // the rule runs here and queues the counter
  h.step(1); // the counter's AttackExecution initialises and cancels against the incoming wave
  return { h, r, inc0 };
}

describe("counterAttack", () => {
  test("a wave above 15 % of home is countered at ≈1.05× and cancels the incoming attack", async () => {
    const { h, r, inc0 } = await scenario(20_000);
    expect(inc0).toBeGreaterThan(h.me.troops() * 0.15);
    const line = h.log.find((l) => l.includes("COUNTER R"));
    expect(line).toMatch(/^t10 COUNTER R \(\d+k incoming\) with (\d+)k$/);
    const sentK = Number(/with (\d+)k/.exec(line!)![1]);
    expect(sentK).toBe(Math.round(Math.ceil(inc0 * 1.05) / 1000));
    // the engine cancels the two waves against each other: the incoming one is gone and ours keeps the 5 % surplus
    expect(
      h.me.incomingAttacks().filter((a) => a.attacker() === r),
    ).toHaveLength(0);
    const out = h.me.outgoingAttacks().find((a) => a.target() === r);
    expect(out).toBeDefined();
    expect(out!.troops()).toBeGreaterThanOrEqual(inc0 * 0.05);
    expect(out!.troops()).toBeLessThanOrEqual(inc0 * 0.08);
  });

  test("a wave under 5 % of home is ignored", async () => {
    const { h, r, inc0 } = await scenario(4_000);
    expect(inc0).toBeGreaterThan(0);
    expect(inc0).toBeLessThan(h.me.troops() * 0.05);
    h.step(40);
    expect(h.log.some((l) => l.includes("COUNTER"))).toBe(false);
    expect(h.me.outgoingAttacks().some((a) => a.target() === r)).toBe(false);
  });

  test("between 5 % and 15 % only an unguarded border is countered", async () => {
    const open = await scenario(10_000);
    expect(open.inc0).toBeGreaterThan(open.h.me.troops() * 0.05);
    expect(open.inc0).toBeLessThan(open.h.me.troops() * 0.15);
    expect(open.h.log.some((l) => l.includes("COUNTER R"))).toBe(true);

    const guarded = await scenario(10_000, true);
    guarded.h.step(40);
    expect(guarded.h.me.units(UnitType.DefensePost)).toHaveLength(1);
    expect(guarded.h.log.some((l) => l.includes("COUNTER"))).toBe(false);
  });

  test("the same attacker is not countered again within 300 ticks", async () => {
    const { h, r } = await scenario(20_000);
    h.step(30);
    h.attack(r, h.me, 20_000);
    h.step(30);
    expect(h.log.filter((l) => l.includes("COUNTER R"))).toHaveLength(1);
  });
});
