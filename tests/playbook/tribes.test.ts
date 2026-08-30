// Rule: harvestBots click cap — a tribe is attacked with botRatio × its troops (+500), but no single click exceeds
// botClickCap (30 %) of home; the rest follows botFollowUpTicks (100) later and merges into the running wave.
// The follow-up is not logged by the bot, so it is observed where it lands: the running attack's troop count,
// which otherwise only falls, jumps by the follow-up amount on the tick the merge initialises.
import { describe, expect, test } from "vitest";
import { PlayerType } from "../../src/core/game/Game";
import { playbookSetup } from "../util/PlaybookSetup";

// big_plains: the wave has to outlive the 100-tick follow-up gap, which on the 100×100 map it does not — a
// 30k wave against a 3k-tile tribe is spent in ~50 ticks. A 240k wave against 20k tiles lasts ~140.
async function tribeGame(tribeTroops: number) {
  const h = await playbookSetup({
    map: "big_plains",
    spawn: [100, 50],
    tiles: [0, 0, 199, 99],
    troops: 800_000,
    bot: { expandFree: 0, expandContested: 0 }, // expand runs before tribes and would shift the spendable figure
    rivals: [
      {
        name: "T",
        type: PlayerType.Bot,
        at: [100, 150],
        tiles: [0, 100, 199, 199],
        troops: tribeTroops,
      },
    ],
  });
  const t = h.rival("T");
  h.step(h.nextRuleTick(10) + 1); // the tribes rule at tick 10, the wave initialises at 11
  const line = h.log.find((l) => l.includes("bot T "))!;
  expect(line).toMatch(/^t10 bot T \d+t\/\d+ ← (\d+)\/(\d+)$/);
  const [, first, want] = /← (\d+)\/(\d+)$/.exec(line)!.map(Number);
  // a follow-up absorbs the running wave (AttackExecution.init merges the old attack into the new one), so the
  // wave that existed last tick is replaced by a bigger one; a fresh click only happens once no wave is running
  const jumps: { tick: number; by: number }[] = [];
  const running = () => h.me.outgoingAttacks().find((a) => a.target() === t);
  let prev = running();
  for (let i = 0; i < 130; i++) {
    h.step(1);
    const cur = running();
    if (prev && cur && cur.troops() > prev.troops())
      jumps.push({ tick: h.game.ticks(), by: cur.troops() - prev.troops() });
    prev = cur;
  }
  return { h, t, first, want, jumps };
}

describe("harvestBots click cap", () => {
  test("a large tribe is split: 30 % of home now, the remainder 100 ticks later into the same wave", async () => {
    const { h, first, want, jumps } = await tribeGame(150_000);
    expect(first).toBeLessThan(want);
    expect(first).toBeGreaterThanOrEqual(800_000 * 0.3);
    expect(first).toBeLessThanOrEqual(800_000 * 0.3 * 1.01); // 30 % of home (plus one tick of regen)
    expect(want).toBeGreaterThanOrEqual(Math.ceil(150_000 * 1.67) + 500);
    // exactly one follow-up, on the first rule pass 100 ticks after the click (tick 110, initialised at 111)
    expect(jumps.map((j) => j.tick)).toEqual([111]);
    expect(h.log.filter((l) => l.includes("bot T "))).toHaveLength(1); // one click, not a second one
    const followUp = want - first;
    expect(jumps[0].by).toBeGreaterThan(followUp * 0.8); // minus the wave's own losses in that tick
    expect(jumps[0].by).toBeLessThanOrEqual(followUp);
  });

  test("a tribe within the cap is taken in one click and never followed up", async () => {
    const { first, want, jumps } = await tribeGame(100_000);
    expect(first).toBe(want);
    expect(want).toBeLessThan(800_000 * 0.3);
    expect(jumps).toEqual([]);
  });
});
