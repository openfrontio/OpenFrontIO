import { beforeEach, describe, expect, test, vi } from "vitest";
import { NukeExecution } from "../../../src/core/execution/NukeExecution";
import { PlayerExecution } from "../../../src/core/execution/PlayerExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";
import { executeTicks } from "../../util/utils";

// Land a nuke cuts off from the owner's main body goes to the enemy around
// it, as long as the cut-off piece itself has no coast or map edge. The
// main body reaching the map edge (standing in for a coast) must not save
// the piece just because the crater links the two.

let game: Game;
let defender: Player;
let attacker: Player;

type Shape = (x: number, y: number) => boolean;
const rect =
  (x0: number, y0: number, x1: number, y1: number): Shape =>
  (x, y) =>
    x >= x0 && x <= x1 && y >= y0 && y <= y1;
const union =
  (...shapes: Shape[]): Shape =>
  (x, y) =>
    shapes.some((s) => s(x, y));

function paint(defenderShape: Shape) {
  game.map().forEachTile((t) => {
    (defenderShape(game.x(t), game.y(t)) ? defender : attacker).conquer(t);
  });
}

function crater(cx: number, cy: number, r: number) {
  game.map().forEachTile((t) => {
    const dx = game.x(t) - cx;
    const dy = game.y(t) - cy;
    if (dx * dx + dy * dy > r * r) return;
    const owner = game.owner(t);
    if (owner.isPlayer()) owner.relinquish(t);
    game.setFallout(t, true);
  });
}

function defenderTilesIn(shape: Shape): number {
  let n = 0;
  game.map().forEachTile((t) => {
    if (game.ownerID(t) === defender.smallID() && shape(game.x(t), game.y(t)))
      n++;
  });
  return n;
}

// Cluster checks only rerun once tiles change after the previous check, so
// start the executions first and let the crater land mid-game, as a nuke would.
function startClusterChecks() {
  game.addExecution(new PlayerExecution(defender));
  game.addExecution(new PlayerExecution(attacker));
  executeTicks(game, 25);
}

function runClusterChecks() {
  executeTicks(game, 45);
}

// Main body runs to the left map edge; an arm reaches east into the
// attacker's land.
const mainBody = rect(0, 60, 70, 140);
const arm = rect(70, 94, 170, 106);
const armTip = rect(130, 0, 199, 199);

describe("land a nuke severs from the main body is annexed", () => {
  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("defender", PlayerType.Human, "c1", "defender_id"),
        new PlayerInfo("attacker", PlayerType.Human, "c2", "attacker_id"),
      ],
    );
    defender = game.player("defender_id");
    attacker = game.player("attacker_id");
  });

  test("an arm cut off a main body that reaches the map edge is annexed", () => {
    paint(union(mainBody, arm));
    startClusterChecks();
    crater(100, 100, 12);
    const tipBefore = defenderTilesIn(armTip);
    const mainBefore = defenderTilesIn(mainBody);
    expect(tipBefore).toBeGreaterThan(0);

    runClusterChecks();

    expect(defenderTilesIn(armTip)).toBe(0);
    expect(defenderTilesIn(mainBody)).toBe(mainBefore);
  });

  test("a crater inside the main body does not hand the main body over", () => {
    paint(union(mainBody, arm));
    startClusterChecks();
    crater(35, 100, 12);
    crater(100, 100, 12);
    const mainBefore = defenderTilesIn(mainBody);

    runClusterChecks();

    expect(defenderTilesIn(armTip)).toBe(0);
    expect(defenderTilesIn(mainBody)).toBe(mainBefore);
  });

  test("a cut-off piece that reaches the map edge is kept", () => {
    // The arm runs all the way to the right edge, so the owner still has a
    // way out of it.
    paint(union(mainBody, rect(70, 94, 199, 106)));
    startClusterChecks();
    crater(100, 100, 12);
    const tipBefore = defenderTilesIn(armTip);

    runClusterChecks();

    expect(defenderTilesIn(armTip)).toBe(tipBefore);
  });

  test("a cut-off piece next to unclaimed land is kept", () => {
    paint(union(mainBody, arm));
    startClusterChecks();
    crater(100, 100, 12);
    // Open, never-nuked land beside the tip: the piece is not walled in.
    for (let x = 150; x <= 160; x++) {
      for (let y = 107; y <= 112; y++) attacker.relinquish(game.ref(x, y));
    }
    const tipBefore = defenderTilesIn(armTip);

    runClusterChecks();

    expect(defenderTilesIn(armTip)).toBe(tipBefore);
  });

  test("a piece with no fallout around it is left to the existing rules", () => {
    // Cut off by the attacker's land rather than by a nuke.
    paint(union(mainBody, arm));
    startClusterChecks();
    for (let y = 94; y <= 106; y++) attacker.conquer(game.ref(120, y));
    const mainBefore = defenderTilesIn(mainBody);
    expect(defenderTilesIn(armTip)).toBeGreaterThan(0);

    runClusterChecks();

    // isSurrounded already annexes a fully surrounded inland pocket.
    expect(defenderTilesIn(armTip)).toBe(0);
    expect(defenderTilesIn(mainBody)).toBe(mainBefore);
  });

  test("losing the last land to a severed-piece annex conquers the player", () => {
    // Both pieces must fall in the same cluster pass: the main body first,
    // through the existing rules, then the cut-off piece as the last land.
    const main = rect(40, 80, 80, 120);
    const pocket = rect(81, 98, 83, 102);
    const strip = rect(176, 90, 199, 110);
    paint(union(main, rect(150, 94, 175, 106)));
    // Until the strike, the main body touches an unclaimed pocket and the
    // piece opens onto unclaimed land running to the map edge, so neither
    // is annexed yet.
    game.map().forEachTile((t) => {
      const x = game.x(t);
      const y = game.y(t);
      if (pocket(x, y) || strip(x, y)) attacker.relinquish(t);
    });
    startClusterChecks();
    expect(defender.numTilesOwned()).toBeGreaterThan(0);

    const conquerPlayer = vi.spyOn(game, "conquerPlayer");
    // In one tick the attacker seals the main body and a strike turns the
    // strip, plus the piece's last column, into fallout. Losing tiles is what
    // makes the defender's cluster check run again.
    const blast = rect(175, 90, 199, 110);
    game.map().forEachTile((t) => {
      const x = game.x(t);
      const y = game.y(t);
      if (pocket(x, y)) attacker.conquer(t);
      if (blast(x, y)) {
        const owner = game.owner(t);
        if (owner.isPlayer()) owner.relinquish(t);
        game.setFallout(t, true);
      }
    });

    runClusterChecks();

    expect(defender.numTilesOwned()).toBe(0);
    expect(conquerPlayer).toHaveBeenCalledWith(attacker, defender);
  });

  // Border clusters join land that touches only at a corner, but territories
  // join only side by side. Piece A borders nothing but fallout; piece B,
  // touching it diagonally, borders the attacker. Run both orientations so
  // whichever piece the cluster lists first, A is judged on its own.
  test.each([
    {
      name: "A above-left of B",
      a: rect(120, 100, 125, 105),
      b: rect(126, 106, 135, 115),
      far: [120, 100],
    },
    {
      name: "A below-right of B",
      a: rect(126, 106, 131, 111),
      b: rect(116, 96, 125, 105),
      far: [131, 111],
    },
  ])(
    "land touching a cut-off piece only at a corner is judged on its own ($name)",
    ({ a, b, far }) => {
      paint(union(mainBody, a, b));
      startClusterChecks();
      // Ring A in fallout; B keeps attacker land on its far sides.
      const [ax0, ay0, ax1, ay1] = [96, 96, 136, 116];
      game.map().forEachTile((t) => {
        const x = game.x(t);
        const y = game.y(t);
        if (x < ax0 || x > ax1 || y < ay0 || y > ay1 || a(x, y) || b(x, y))
          return;
        const nearA = [...Array(9)].some((_, k) =>
          a(x + (k % 3) - 1, y + Math.floor(k / 3) - 1),
        );
        if (!nearA) return;
        const owner = game.owner(t);
        if (owner.isPlayer()) owner.relinquish(t);
        game.setFallout(t, true);
      });
      // The strike also takes a tile of A, as a real one would; losing
      // tiles is what makes the defender re-run its cluster checks.
      const farTile = game.ref(far[0], far[1]);
      defender.relinquish(farTile);
      game.setFallout(farTile, true);
      const aBefore = defenderTilesIn(a);

      runClusterChecks();

      // A touches no enemy, so it stays; B is cut off and goes to the attacker.
      expect(defenderTilesIn(a)).toBe(aBefore);
      expect(defenderTilesIn(b)).toBe(0);
    },
  );

  test("a real hydrogen bomb cutting an arm off hands the arm over", () => {
    (game.config() as TestConfig).nukeMagnitudes = () => ({
      inner: 20,
      outer: 26,
    });
    paint(union(mainBody, arm));
    attacker.buildUnit(UnitType.MissileSilo, game.ref(190, 190), {});
    game.addExecution(new PlayerExecution(defender));
    game.addExecution(new PlayerExecution(attacker));
    executeTicks(game, 25);
    game.addExecution(
      new NukeExecution(
        UnitType.HydrogenBomb,
        attacker,
        game.ref(100, 110),
        game.ref(190, 190),
        1000,
      ),
    );
    executeTicks(game, 80);

    expect(game.numTilesWithFallout()).toBeGreaterThan(0);
    expect(defenderTilesIn(armTip)).toBe(0);
    expect(defenderTilesIn(mainBody)).toBeGreaterThan(0);
  });
});
