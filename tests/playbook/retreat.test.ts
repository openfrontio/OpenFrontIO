// Rule: manageRetreats — a war wave is recalled when it is losing: under 20 % of what was sent while the target
// still holds over 70 % of the troops it had at the start; or, against posts, under 50 % while the target keeps 90 %.
// The wave is a real AttackExecution; its size is driven through the public Attack.setTroops() to reach the
// thresholds in a handful of ticks instead of a full war.
import { describe, expect, test } from "vitest";
import { PlayerType, UnitType } from "../../src/core/game/Game";
import { playbookSetup, Rect } from "../util/PlaybookSetup";

const ME: Rect = [30, 25, 70, 57];
const RV: Rect = [30, 58, 70, 90];

async function war(post = false) {
  const h = await playbookSetup({
    spawn: [50, 40],
    tiles: ME,
    troops: 30_000, // far under fightAbove × cap and before fightNotBeforeTick: the bot starts no war of its own
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
  if (post) r.buildUnit(UnitType.DefensePost, h.game.ref(50, 62), {});
  h.attack(h.me, r, 20_000);
  h.step(2);
  const a = h.me.outgoingAttacks().find((x) => x.target() === r)!;
  expect(a).toBeDefined();
  h.step(h.nextRuleTick(10)); // the retreats rule records the wave's starting size and the target's troops
  return { h, r, a, sent: a.troops(), targetTroops: r.troops() };
}

describe("manageRetreats", () => {
  test("retreats a wave under 20 % of what was sent while the target keeps over 70 %", async () => {
    const { h, r, a, sent, targetTroops } = await war();
    a.setTroops(Math.floor(sent * 0.15));
    h.step(h.nextRuleTick(10));
    expect(r.troops()).toBeGreaterThan(targetTroops * 0.7);
    expect(a.retreating()).toBe(true);
    expect(
      h.log.some((l) => /^t\d+ retreat from R \(\d+k left\)$/.test(l)),
    ).toBe(true);
  });

  // Documented gap: the bot calls Player.orderRetreat() directly, which only flags the attack as retreating.
  // The engine completes a retreat in RetreatExecution (executeRetreat() after a 20-tick delay), which nothing in
  // the bot ever schedules — so a bot-ordered retreat freezes: the wave keeps its troops, stays in
  // outgoingAttacks() (blocking outgoingTo(target) and the "one war at a time" gate), and never comes home.
  // This test pins the current behaviour; a fix flips it deliberately.
  test("a bot-ordered retreat never executes: the wave is frozen, the survivors never come home", async () => {
    const { h, r, a, sent } = await war();
    a.setTroops(Math.floor(sent * 0.15));
    h.step(h.nextRuleTick(10));
    expect(a.retreating()).toBe(true);
    const frozen = a.troops();
    h.step(300);
    expect(a.retreated()).toBe(false);
    expect(a.isActive()).toBe(true);
    expect(a.troops()).toBe(frozen);
    expect(h.me.outgoingAttacks()).toContain(a);
    expect(h.me.outgoingAttacks().some((x) => x.target() === r)).toBe(true);
  });

  test("no retreat while the wave is healthy", async () => {
    const { h, a } = await war();
    h.step(h.nextRuleTick(10));
    expect(a.retreating()).toBe(false);
    expect(h.log.some((l) => l.includes("retreat from"))).toBe(false);
  });

  test("no retreat when the target has bled too: the war is being won", async () => {
    const { h, r, a, sent, targetTroops } = await war();
    a.setTroops(Math.floor(sent * 0.15));
    r.setTroops(Math.floor(targetTroops * 0.5));
    h.step(h.nextRuleTick(10));
    expect(a.retreating()).toBe(false);
    expect(h.log.some((l) => l.includes("retreat from"))).toBe(false);
  });

  test("against defence posts the line is 50 % of the wave with the target over 90 %", async () => {
    const { h, r, a, sent, targetTroops } = await war(true);
    expect(r.units(UnitType.DefensePost)).toHaveLength(1);
    a.setTroops(Math.floor(sent * 0.4));
    h.step(h.nextRuleTick(10));
    expect(r.troops()).toBeGreaterThan(targetTroops * 0.9);
    expect(a.retreating()).toBe(true);
  });
});
