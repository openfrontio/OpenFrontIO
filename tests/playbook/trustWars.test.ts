// Flag `trustWars` (C1): fight() skips a target whose living ally on our border could pile in — a nation whose own
// attack rules allow it (RivalView.nationCanAttack) with at least half our spendable troops — and prefers targets
// that broke faith: + 2 × (1 − trust) in the score. Off = the plain scorer.
import { describe, expect, test } from "vitest";
import { PlaybookParams } from "../../src/core/execution/playbook/PlaybookBotExecution";
import { Situation } from "../../src/core/execution/playbook/Situation";
import { PlayerType } from "../../src/core/game/Game";
import { playbookSetup, Rect } from "../util/PlaybookSetup";

const ME: Rect = [30, 25, 70, 57];
const LEFT: Rect = [29, 58, 49, 90]; // two equal 21 × 33 rectangles under us
const RIGHT: Rect = [50, 58, 70, 90];
const WAR: Partial<PlaybookParams> = { fightNotBeforeTick: 0, fightMinCities: 0, expandFree: 0, expandContested: 0 };

describe("trustWars: an ally that can pile in", () => {
  async function prey(trustWars: boolean, allied: boolean) {
    const h = await playbookSetup({
      spawn: [50, 40], tiles: ME, troops: 100_000, bot: { ...WAR, trustWars },
      rivals: [
        { name: "R", type: PlayerType.Nation, at: [40, 75], tiles: LEFT, troops: 10_000 }, // affordable at 2×
        { name: "A", type: PlayerType.Nation, at: [60, 75], tiles: RIGHT, troops: 200_000 }, // could send troops − 0.3 × cap at us
      ],
    });
    const r = h.rival("R"), a = h.rival("A");
    if (allied) { a.createAllianceRequest(r)!.accept(); expect(a.isAlliedWith(r)).toBe(true); }
    h.step(h.nextRuleTick(10));
    return { h, r, a };
  }

  test("off: the prey is attacked although its ally next door could join", async () => {
    const { h, a } = await prey(false, true);
    const sit = (h.bot as unknown as { sit: Situation }).sit;
    const v = sit.rival.get(a)!;
    expect(v.nationCanAttack).toBe(true);
    expect(v.nationWouldSend).toBeGreaterThanOrEqual(sit.spendable * 0.5);
    expect(h.log.some((l) => /ATTACK R /.test(l))).toBe(true);
  });

  test("on: no war on the prey while its ally can pile in, and the reason is logged", async () => {
    const { h } = await prey(true, true);
    expect(h.log.some((l) => /ATTACK R /.test(l))).toBe(false);
    expect(h.log.some((l) => /no war on R: its ally A could send \d+k at us/.test(l))).toBe(true);
  });

  test("on: without the alliance the prey is attacked as usual", async () => {
    const { h } = await prey(true, false);
    expect(h.log.some((l) => /ATTACK R /.test(l))).toBe(true);
  });
});

describe("trustWars: low trust is the better target", () => {
  async function twins(attacker: "L" | "R") {
    const h = await playbookSetup({
      spawn: [50, 40], tiles: ME, troops: 100_000, bot: { ...WAR, trustWars: true },
      rivals: [
        { name: "L", type: PlayerType.Nation, at: [40, 75], tiles: LEFT, troops: 10_000 },
        { name: "R", type: PlayerType.Nation, at: [60, 75], tiles: RIGHT, troops: 10_000 },
      ],
    });
    // one twin pokes us with 200 troops: trust 0.5 → 0.3, a 1.4 bonus against 1.0 for the other
    h.attack(h.rival(attacker), h.me, 200);
    h.step(2);
    for (const n of ["L", "R"]) h.rival(n).setTroops(10_000); // the poke must not change the twins' size
    h.step(h.nextRuleTick(10));
    return h;
  }

  test("the twin that attacked us is the one we go for", async () => {
    const hL = await twins("L");
    expect(hL.log.some((l) => /trust L 0\.50 → 0\.30: attacked us/.test(l))).toBe(true);
    expect(hL.log.find((l) => l.includes("ATTACK "))).toMatch(/ATTACK L /);
    const hR = await twins("R");
    expect(hR.log.find((l) => l.includes("ATTACK "))).toMatch(/ATTACK R /);
  });
});
