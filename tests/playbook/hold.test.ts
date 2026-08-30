// Rule: send() returns 0 while sit.hold is set — an alliance with a stronger nation (troops > 0.85× ours) lapses
// within 450 ticks, so the army stays home for the nation's renewal check. Counters are the only exception.
import { describe, expect, test } from "vitest";
import { AllianceRequestExecution } from "../../src/core/execution/alliance/AllianceRequestExecution";
import { PlaybookParams } from "../../src/core/execution/playbook/PlaybookBotExecution";
import { PlayerType } from "../../src/core/game/Game";
import { PlaybookHarness, playbookSetup, Rect } from "../util/PlaybookSetup";

// big_plains: on the 100×100 map the bot owns every free tile before the hold window opens, and a bot with no
// wilderness sends nothing whether it holds or not — the controls need expansion to still be possible.
// Territory sets the troop cap, and regen towards the cap decides which side of the 0.85 line the pair sits on
// for the whole window: the stronger side gets the larger rectangle.
const SMALL: Rect = [80, 70, 120, 114]; // 1 845 tiles: cap ≈ 282k (human) / 212k (Medium nation)
const LARGE: Rect = [40, 115, 160, 190]; // 9 196 tiles: cap ≈ 576k (human) / 432k (Medium nation)
const LARGE_TOP: Rect = [40, 40, 160, 114];
const SMALL_BOTTOM: Rect = [80, 115, 120, 159];

async function allied(
  rivalType: PlayerType,
  me: { tiles: Rect; troops: number; bot?: Partial<PlaybookParams> },
  rival: { tiles: Rect; troops: number },
) {
  const centre = ([x0, y0, x1, y1]: Rect): [number, number] => [
    Math.floor((x0 + x1) / 2),
    Math.floor((y0 + y1) / 2),
  ];
  const h = await playbookSetup({
    map: "big_plains",
    spawn: centre(me.tiles),
    tiles: me.tiles,
    troops: me.troops,
    // this file pins the hold mechanism itself via the legacy 0.85x heuristic; the graduated nationAware gate
    // (which asks the nation's own attack rules instead) is covered by nationAware.test.ts
    bot: { nationAware: false, ...me.bot },
    rivals: [
      {
        name: "R",
        type: rivalType,
        at: centre(rival.tiles),
        tiles: rival.tiles,
        troops: rival.troops,
      },
    ],
    config: { customAllianceDuration: 1 }, // 600-tick alliances: the hold window opens at expiry − 450
  });
  const r = h.rival("R");
  h.game.addExecution(new AllianceRequestExecution(r, h.me.id()));
  h.step(2);
  const al = h.me.allianceWith(r);
  expect(al).not.toBeNull();
  return { h, r, expiresAt: al!.expiresAt() };
}

/** Ticks inside [from, to) on which an attack that did not exist at `from` is running. */
function ticksWithNewAttacks(h: PlaybookHarness, to: number): number {
  const known = new Set(h.me.outgoingAttacks().map((a) => a.id()));
  let n = 0;
  while (h.game.ticks() < to) {
    h.step(1);
    if (h.me.outgoingAttacks().some((a) => !known.has(a.id()))) n++;
  }
  return n;
}

describe("send() hold before a stronger nation ally lapses", () => {
  test("no troops leave home inside the 450-tick window", async () => {
    const { h, r, expiresAt } = await allied(
      PlayerType.Nation,
      { tiles: SMALL, troops: 50_000 },
      { tiles: LARGE, troops: 400_000 },
    );
    const holdFrom = expiresAt - 450 + 1; // first tick with expiresAt − tick < 450
    // before the window the bot expands as usual
    h.step(holdFrom - 60 - h.game.ticks());
    expect(h.me.outgoingAttacks().length).toBeGreaterThan(0);
    h.step(holdFrom - h.game.ticks());
    expect(r.troops()).toBeGreaterThan(h.me.troops() * 0.85);
    // inside the window: no new wave is created and nothing leaves home
    const known = new Set(h.me.outgoingAttacks().map((a) => a.id()));
    let troops = h.me.troops();
    for (let t = h.game.ticks(); t < expiresAt - 10; t++) {
      h.step(1);
      expect(
        h.me.outgoingAttacks().filter((a) => !known.has(a.id())),
      ).toHaveLength(0);
      expect(h.me.troops()).toBeGreaterThanOrEqual(troops);
      troops = h.me.troops();
    }
    expect(h.log).toContain(
      "t300 holding troops home: alliance with R about to lapse",
    );
  });

  test("a human ally of the same strength does not trigger the hold", async () => {
    const { h, r, expiresAt } = await allied(
      PlayerType.Human,
      { tiles: SMALL, troops: 50_000 },
      { tiles: LARGE, troops: 400_000 },
    );
    h.step(expiresAt - 450 + 1 - h.game.ticks());
    expect(r.troops()).toBeGreaterThan(h.me.troops() * 0.85);
    expect(ticksWithNewAttacks(h, expiresAt - 10)).toBeGreaterThan(100);
    expect(h.log.some((l) => l.includes("holding troops home"))).toBe(false);
  });

  test("a weaker nation ally does not trigger the hold", async () => {
    // 2 % clicks: 10 % clicks into open country spend the army down to the nation's level within the window
    const { h, r, expiresAt } = await allied(
      PlayerType.Nation,
      {
        tiles: LARGE_TOP,
        troops: 250_000,
        bot: { expandFree: 0.02, expandContested: 0.02 },
      },
      { tiles: SMALL_BOTTOM, troops: 60_000 },
    );
    h.step(expiresAt - 450 + 1 - h.game.ticks());
    expect(r.troops()).toBeLessThan(h.me.troops() * 0.85);
    expect(ticksWithNewAttacks(h, expiresAt - 10)).toBeGreaterThan(100);
    expect(h.log.some((l) => l.includes("holding troops home"))).toBe(false);
  });
});
