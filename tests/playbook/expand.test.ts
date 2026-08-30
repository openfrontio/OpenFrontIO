// Rule: expand — every 10 ticks a share of home troops goes into empty land (expandFree alone, expandContested
// with a rival on the border). Every send() is bounded by the reserve: reserveShare of current troops stays home.
import { describe, expect, test } from "vitest";
import {
  DEFAULT_PLAYBOOK,
  PlaybookParams,
} from "../../src/core/execution/playbook/PlaybookBotExecution";
import { playbookSetup } from "../util/PlaybookSetup";

async function alone(bot: Partial<PlaybookParams> = {}) {
  return playbookSetup({ spawn: [50, 50], troops: 100_000, bot });
}

describe("expand", () => {
  test("clicks expandFree of home troops into terra nullius when nobody borders us", async () => {
    const h = await alone();
    const before = h.me.troops();
    h.step(h.nextRuleTick(10));
    const wave = h.me.outgoingAttacks().find((a) => !a.target().isPlayer());
    expect(wave).toBeDefined();
    // sit.troops is read after this tick's regen, so allow a little above 10 % of the pre-tick figure
    expect(wave!.troops()).toBeGreaterThanOrEqual(
      before * DEFAULT_PLAYBOOK.expandFree * 0.99,
    );
    expect(wave!.troops()).toBeLessThanOrEqual(
      before * DEFAULT_PLAYBOOK.expandFree * 1.02,
    );
  });

  test("never sends below the reserve, whatever the click asks for", async () => {
    const h = await alone({ expandFree: 1.0, expandContested: 1.0 });
    const floor = DEFAULT_PLAYBOOK.reserveShare;
    for (let i = 0; i < 10; i++) {
      const before = h.me.troops();
      h.step(h.nextRuleTick(10));
      const after = h.me.troops();
      // the click wanted everything; the reserve kept 30 % (regen in the same tick lands on top)
      expect(after).toBeGreaterThanOrEqual(before * floor * 0.99);
      // survivors of earlier waves come home on later passes, so the tight upper bound holds only for the first
      if (i === 0)
        expect(after).toBeLessThanOrEqual(before * floor + before * 0.02);
    }
  });

  test("the reserve scales with reserveShare", async () => {
    const h = await alone({ expandFree: 1.0, reserveShare: 0.6 });
    const before = h.me.troops();
    h.step(h.nextRuleTick(10));
    expect(h.me.troops()).toBeGreaterThanOrEqual(before * 0.6 * 0.99);
    expect(h.me.troops()).toBeLessThanOrEqual(before * 0.6 + before * 0.02);
  });

  // The A1 finding that PlaybookParams.homeFloor was declared but read nowhere led to its removal in C2: the only
  // floor on expansion is reserveShare of current troops (bsrReserve scales it), and the cap floor is the
  // `capFloor` argument of send() that only wars pass.
});
