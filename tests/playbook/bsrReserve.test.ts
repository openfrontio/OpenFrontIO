// Flag `bsrReserve` (C1): the troop reserve follows the border threat. reserve = troops × reserveShare × f, with
// f = clamp(0.5 + 0.5 · maxBsr, 0.5, 2.0) over the unfriendly neighbours' border-security ratio (Rivals.bsr):
// half the reserve with nobody on the border, reserveShare itself at bsr 1, twice it from bsr 3. Off = flat.
import { describe, expect, test } from "vitest";
import { PlaybookParams } from "../../src/core/execution/playbook/PlaybookBotExecution";
import { Situation, SituationQueries } from "../../src/core/execution/playbook/Situation";
import { Player, PlayerType } from "../../src/core/game/Game";
import { PlaybookHarness, playbookSetup, Rect } from "../util/PlaybookSetup";

const ME: Rect = [30, 25, 70, 57];
const RV: Rect = [30, 58, 70, 90];

const sitOf = (h: PlaybookHarness): Situation => (h.bot as unknown as { sit: Situation }).sit;
const factor = (bsr: number) => Math.min(2, Math.max(0.5, 0.5 + 0.5 * bsr));

async function game(bot: Partial<PlaybookParams>, rival: boolean) {
  return playbookSetup({
    spawn: [50, 40],
    tiles: ME,
    troops: 30_000, // a third of what the rival's cap lets it keep on our border: bsr well over 1
    bot: { expandFree: 1.0, expandContested: 1.0, ...bot }, // every click wants everything: only the reserve binds
    rivals: rival ? [{ name: "R", type: PlayerType.Nation, at: [50, 75], tiles: RV, troops: 1_000_000 }] : [],
  });
}

describe("bsrReserve", () => {
  test("the curve: 0.5× with no rival, 1× at bsr 1, clamped at 2× from bsr 3", () => {
    const at = (bsr: number, rivals = 1) => {
      const rival = {} as Player;
      const sit = { rivals: rivals ? [rival] : [], rival: new Map([[rival, { bsr }]]) } as unknown as Situation;
      return SituationQueries.reserveFactor(sit);
    };
    expect(at(0, 0)).toBe(0.5);
    expect(at(0)).toBe(0.5);
    expect(at(1)).toBe(1);
    expect(at(2)).toBe(1.5);
    expect(at(3)).toBe(2);
    expect(at(10)).toBe(2);
  });

  test("on: a rival massed on our border raises the reserve; the expand click leaves that much at home", async () => {
    const h = await game({ bsrReserve: true }, true);
    h.step(h.nextRuleTick(10) - 1); // stop just before the rule tick: `before` is then one regen tick under what the bot reads
    const before = h.me.troops();
    h.step(1);
    const sit = sitOf(h);
    const bsr = sit.rival.get(h.rival("R"))!.bsr;
    expect(bsr).toBeGreaterThan(1.2);
    const f = factor(bsr);
    expect(f).toBeGreaterThan(1.1);
    // the situation read on the rule tick (sit.troops is read after regen, so allow a little above): reserve is
    // reserveShare × f of the troops it was read with
    expect(sit.reserve / before).toBeGreaterThanOrEqual(0.3 * f * 0.99);
    expect(sit.reserve / before).toBeLessThanOrEqual(0.3 * f * 1.03);
    // that much stayed home (regen in the same tick lands on top), where the flat reserve would have kept 30 %
    expect(h.me.troops()).toBeGreaterThanOrEqual(before * 0.3 * f * 0.99);
    expect(h.me.troops()).toBeLessThanOrEqual(before * 0.3 * f + before * 0.03);
  });

  test("on: with nobody on the border the reserve halves", async () => {
    const h = await game({ bsrReserve: true }, false);
    h.step(h.nextRuleTick(10) - 1); // stop just before the rule tick: `before` is then one regen tick under what the bot reads
    const before = h.me.troops();
    h.step(1);
    expect(sitOf(h).rivals).toHaveLength(0);
    expect(h.me.troops()).toBeGreaterThanOrEqual(before * 0.15 * 0.99);
    expect(h.me.troops()).toBeLessThanOrEqual(before * 0.15 + before * 0.03);
  });

  test("off: the same massed rival leaves the flat 30 % reserve", async () => {
    const h = await game({ bsrReserve: false }, true);
    h.step(h.nextRuleTick(10) - 1); // stop just before the rule tick: `before` is then one regen tick under what the bot reads
    const before = h.me.troops();
    h.step(1);
    expect(sitOf(h).rival.get(h.rival("R"))!.bsr).toBeGreaterThan(1.2);
    expect(h.me.troops()).toBeGreaterThanOrEqual(before * 0.3 * 0.99);
    expect(h.me.troops()).toBeLessThanOrEqual(before * 0.3 + before * 0.03);
  });
});
