// Flag `nationAware` (C1): the expiry hold asks the nation's own attack rules (Rivals.couldAttackAtExpiry: reserve
// ratio, send cap with us as the unfriendly neighbour we become, too-weak rule, FFA strength check) whether the
// lapsing ally could hit us, instead of the "stronger than 0.85× our troops" heuristic. Same set-up as hold.test.ts;
// both armies are pinned every tick so regen cannot move either side across a line during the window.
import { describe, expect, test } from "vitest";
import { AllianceRequestExecution } from "../../src/core/execution/alliance/AllianceRequestExecution";
import { PlaybookParams } from "../../src/core/execution/playbook/PlaybookBotExecution";
import { NATION_RULES } from "../../src/core/execution/playbook/Rivals";
import { Player, PlayerType } from "../../src/core/game/Game";
import { PlaybookHarness, playbookSetup, Rect } from "../util/PlaybookSetup";

const SMALL: Rect = [80, 70, 120, 114]; // 1 845 tiles
const LARGE: Rect = [40, 115, 160, 190]; // 9 196 tiles: a Medium nation's cap ≈ 432k

async function allied(ourTroops: number, theirTroops: number, bot: Partial<PlaybookParams>) {
  const h = await playbookSetup({
    map: "big_plains", spawn: [100, 92], tiles: SMALL, troops: ourTroops, bot,
    rivals: [{ name: "R", type: PlayerType.Nation, at: [100, 152], tiles: LARGE, troops: theirTroops }],
    config: { customAllianceDuration: 1 }, // 600-tick alliances: the hold window opens at expiry − 450
  });
  const r = h.rival("R");
  h.game.addExecution(new AllianceRequestExecution(r, h.me.id()));
  h.step(2);
  const al = h.me.allianceWith(r);
  expect(al).not.toBeNull();
  return { h, r, expiresAt: al!.expiresAt() };
}

/** Steps to `to`, pinning both armies each tick; returns the ticks on which a new attack of ours was running and
 *  whether sit.hold was ever set. */
function window(h: PlaybookHarness, r: Player, ours: number, theirs: number, to: number) {
  const known = new Set(h.me.outgoingAttacks().map((a) => a.id()));
  let newAttackTicks = 0, held = false;
  const sit = () => (h.bot as unknown as { sit: { hold: Player | null } }).sit;
  while (h.game.ticks() < to) {
    h.me.setTroops(ours); r.setTroops(theirs);
    h.step(1);
    if (sit().hold !== null) held = true;
    if (h.me.outgoingAttacks().some((a) => !known.has(a.id()))) newAttackTicks++;
  }
  return { newAttackTicks, held };
}

describe("nationAware: the expiry hold", () => {
  test("a nation under its reserve ratio cannot attack at expiry: no hold (the heuristic would hold)", async () => {
    // 100k on a 432k cap is 23 %: below the 30 % reserve ratio every nation needs before it attacks anyone —
    // yet twice our 50k, so the 0.85× heuristic holds the whole army home for 45 s
    for (const nationAware of [true, false]) {
      const { h, r, expiresAt } = await allied(50_000, 100_000, { nationAware });
      expect(100_000 / h.game.config().maxTroops(r)).toBeLessThan(NATION_RULES.reserveRatio[0]);
      h.step(expiresAt - 450 + 1 - h.game.ticks());
      const w = window(h, r, 50_000, 100_000, expiresAt - 10);
      if (nationAware) { expect(w.held).toBe(false); expect(w.newAttackTicks).toBeGreaterThan(100); }
      else { expect(w.held).toBe(true); expect(w.newAttackTicks).toBe(0); }
    }
  });

  test("a nation whose rules allow the attack still triggers the hold", async () => {
    const { h, r, expiresAt } = await allied(50_000, 400_000, { nationAware: true });
    h.step(expiresAt - 450 + 1 - h.game.ticks());
    const w = window(h, r, 50_000, 400_000, expiresAt - 10);
    expect(w.held).toBe(true);
    expect(w.newAttackTicks).toBe(0);
    expect(h.log.some((l) => l.includes("holding troops home: alliance with R about to lapse"))).toBe(true);
  });

  test("couldAttackAtExpiry counts us as the unfriendly neighbour the send cap would see", async () => {
    const { h, r } = await allied(50_000, 400_000, { nationAware: true });
    const q = (h.bot as unknown as { q: { rivals: { couldAttackAtExpiry(p: Player, t: number): { can: boolean; send: number } } } }).q;
    expect(q.rivals.couldAttackAtExpiry(r, 50_000)).toEqual({ can: true, send: r.troops() - h.game.config().maxTroops(r) * NATION_RULES.reserveRatio[0] });
    expect(q.rivals.couldAttackAtExpiry(r, 500_000).can).toBe(false); // FFA: it never attacks a stronger, non-hostile neighbour
    expect(q.rivals.couldAttackAtExpiry(h.me, 1).can).toBe(false); // only nations
  });
});
