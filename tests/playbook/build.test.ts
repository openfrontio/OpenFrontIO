// Rule: build() step 1 — when a non-bot attack lands and a post is affordable, a defence post goes up on the
// contact border with the attacker, stepped 8–14 tiles back onto our side of it.
import { describe, expect, test } from "vitest";
import { PlayerType, UnitType } from "../../src/core/game/Game";
import { distToPlayer, playbookSetup, Rect } from "../util/PlaybookSetup";

const ME: Rect = [30, 25, 70, 57]; // our land: y 25..57
const RV: Rect = [30, 58, 70, 90]; // the attacker's: y 58..90, contact line at y = 57/58

async function attacked(gold: bigint, incoming = 30_000) {
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
  h.me.addGold(gold);
  if (incoming > 0) h.attack(r, h.me, incoming);
  h.step(h.nextRuleTick(10)); // the build rule runs with the attack on our border
  return { h, r };
}

describe("build(): defence post where an attack lands", () => {
  test("orders a post on the tick the attack is seen and places it facing the attacker", async () => {
    const { h, r } = await attacked(100_000n);
    expect(h.log).toContain("t10 build Defense Post");
    h.step(60); // construction takes 50 ticks
    const posts = h.me.units(UnitType.DefensePost);
    expect(posts).toHaveLength(1);
    const tile = posts[0].tile();
    expect(posts[0].isUnderConstruction()).toBe(false);
    expect(h.game.owner(tile)).toBe(h.me);
    // just behind the contact line (8–14 tiles back from the border midpoint, so ≤ ~20 from the attacker's land)
    expect(distToPlayer(h.game, tile, r)).toBeGreaterThanOrEqual(5);
    expect(distToPlayer(h.game, tile, r)).toBeLessThanOrEqual(20);
    // on the attacker's side of our territory, not somewhere in the interior
    const y = h.game.y(tile);
    expect(y).toBeGreaterThan(41); // our centre line
    expect(y).toBeLessThanOrEqual(57);
    expect(Math.abs(h.game.x(tile) - 50)).toBeLessThanOrEqual(12); // near the contact midpoint, not a corner
  });

  test("no post without the gold for it", async () => {
    const { h } = await attacked(40_000n);
    h.step(60);
    expect(h.log.some((l) => l.includes("build Defense Post"))).toBe(false);
    expect(h.me.units(UnitType.DefensePost)).toHaveLength(0);
  });

  test("no post when nothing is attacking (threat posts wait for a city and 1:30)", async () => {
    const { h } = await attacked(100_000n, 0);
    h.step(60);
    expect(h.log.some((l) => l.includes("build Defense Post"))).toBe(false);
    expect(h.me.units(UnitType.DefensePost)).toHaveLength(0);
  });
});
