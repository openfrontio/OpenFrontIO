// Flag `realRetreats`: a bot-ordered retreat schedules a RetreatExecution, so the wave actually comes home
// (executeRetreat after the engine's 20-tick delay) instead of freezing with the `retreating` flag set —
// the gap tests/playbook/retreat.test.ts documents. Same scenario as that file: a losing 20k wave into a
// 100k nation next door.
import { describe, expect, test } from "vitest";
import { PlayerType } from "../../src/core/game/Game";
import { playbookSetup, Rect } from "../util/PlaybookSetup";

const ME: Rect = [30, 25, 70, 57];
const RV: Rect = [30, 58, 70, 90];

async function losingWar(realRetreats: boolean) {
  const h = await playbookSetup({
    spawn: [50, 40],
    tiles: ME,
    troops: 30_000, // far under fightAbove × cap and before fightNotBeforeTick: the bot starts no war of its own
    bot: { realRetreats },
    rivals: [{ name: "R", type: PlayerType.Nation, at: [50, 75], tiles: RV, troops: 100_000 }],
  });
  const r = h.rival("R");
  h.attack(h.me, r, 20_000);
  h.step(2);
  const a = h.me.outgoingAttacks().find((x) => x.target() === r)!;
  expect(a).toBeDefined();
  h.step(h.nextRuleTick(10)); // the retreats rule records the wave's starting size and the target's troops
  a.setTroops(Math.floor(a.troops() * 0.15)); // now "losing": under 20 % of the wave while the target keeps > 70 %
  h.step(h.nextRuleTick(10));
  h.step(1); // an execution added during tick T first runs at T+1: that is when RetreatExecution flags the wave
  expect(a.retreating()).toBe(true);
  return { h, r, a };
}

describe("realRetreats", () => {
  test("on: the survivors are home within 25 ticks and the attack leaves outgoingAttacks()", async () => {
    const { h, r, a } = await losingWar(true);
    const wave = a.troops();
    // the tick in which the wave comes home: home troops jump by the survivors (the bot's expand clicks and regen
    // move home troops by a few hundred a tick; the jump is thousands)
    let jump = 0, ticks = 0;
    for (; ticks < 25 && h.me.outgoingAttacks().includes(a); ticks++) {
      const before = h.me.troops();
      h.step(1);
      jump = Math.max(jump, h.me.troops() - before);
    }
    expect(ticks).toBeLessThan(25);
    expect(a.retreated()).toBe(true);
    expect(h.me.outgoingAttacks().some((x) => x.target() === r)).toBe(false);
    // 25 % retreat malus against a player; the rest is back
    expect(jump).toBeGreaterThanOrEqual(Math.floor(wave * 0.75) - 600);
    expect(jump).toBeLessThan(wave);
  });

  test("on: the retreat is scheduled once, even though the rule keeps running", async () => {
    const { h, a } = await losingWar(true);
    h.step(h.nextRuleTick(10));
    h.step(h.nextRuleTick(10)); // two more passes of manageRetreats while the wave is still flagged
    expect(h.log.filter((l) => l.includes("retreat from R")).length).toBe(1);
    expect(h.until(() => !h.me.outgoingAttacks().includes(a), 25)).toBe(true);
  });

  test("off: the wave stays frozen (baseline behaviour kept)", async () => {
    const { h, a } = await losingWar(false);
    const frozen = a.troops();
    h.step(100);
    expect(a.retreated()).toBe(false);
    expect(a.troops()).toBe(frozen);
    expect(h.me.outgoingAttacks()).toContain(a);
  });
});
