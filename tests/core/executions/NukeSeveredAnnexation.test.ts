import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { NukeExecution } from "@openfront/engine/execution/NukeExecution";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
// Some tests give it land; it runs no PlayerExecution, so its own land is
// never annexed.
let third: Player;

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

function fallout(shape: Shape) {
  game.map().forEachTile((t) => {
    if (!shape(game.x(t), game.y(t))) return;
    const owner = game.owner(t);
    if (owner.isPlayer()) owner.relinquish(t);
    game.setFallout(t, true);
  });
}

function crater(cx: number, cy: number, r: number) {
  fallout((x, y) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r);
}

function tilesOwnedBy(player: Player, shape: Shape): number {
  let n = 0;
  game.map().forEachTile((t) => {
    if (game.ownerID(t) === player.smallID() && shape(game.x(t), game.y(t)))
      n++;
  });
  return n;
}

function defenderTilesIn(shape: Shape): number {
  return tilesOwnedBy(defender, shape);
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("defender", PlayerType.Human, "c1", "defender_id"),
        new PlayerInfo("attacker", PlayerType.Human, "c2", "attacker_id"),
        new PlayerInfo("third", PlayerType.Human, "c3", "third_id"),
      ],
    );
    defender = game.player("defender_id");
    attacker = game.player("attacker_id");
    third = game.player("third_id");
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

    // classifyCluster already annexes a fully surrounded inland pocket.
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

  // Two square craters across the arm, touching at one corner. The defender
  // keeps both tiles beside that corner, so the two halves of the arm still
  // touch diagonally and their borders join the main body's cluster, but no
  // side-by-side path is left between them.
  test.each([
    {
      name: "upper crater on the left",
      craters: union(rect(95, 88, 100, 100), rect(101, 101, 106, 112)),
    },
    {
      name: "lower crater on the left",
      craters: union(rect(95, 101, 100, 112), rect(101, 88, 106, 100)),
    },
  ])(
    "an arm cut off only across a diagonal is annexed ($name)",
    ({ craters }) => {
      paint(union(mainBody, arm));
      startClusterChecks();
      fallout(craters);
      const cutOff = rect(101, 0, 199, 199);
      const armBase = rect(71, 94, 100, 106);
      const mainBefore = defenderTilesIn(mainBody);
      const baseBefore = defenderTilesIn(armBase);
      expect(defenderTilesIn(cutOff)).toBeGreaterThan(0);
      expect(baseBefore).toBeGreaterThan(0);

      runClusterChecks();

      expect(defenderTilesIn(cutOff)).toBe(0);
      expect(defenderTilesIn(armBase)).toBe(baseBefore);
      expect(defenderTilesIn(mainBody)).toBe(mainBefore);
    },
  );

  test("a cut-off piece with a hole of its own is still annexed", () => {
    paint(union(mainBody, arm));
    startClusterChecks();
    crater(100, 100, 12);
    // A hole in the arm's tip, half someone else's land, half fallout: its
    // ring is a candidate of its own, and the tip reaches well past it.
    for (let x = 140; x <= 142; x++) {
      for (let y = 98; y <= 102; y++) third.conquer(game.ref(x, y));
    }
    fallout(rect(143, 98, 146, 102));
    const mainBefore = defenderTilesIn(mainBody);
    expect(defenderTilesIn(armTip)).toBeGreaterThan(0);

    runClusterChecks();

    expect(defenderTilesIn(armTip)).toBe(0);
    expect(defenderTilesIn(mainBody)).toBe(mainBefore);
  });

  test("a hole bordering only an ally and fallout stays cheap and attached", () => {
    // The defender holds the whole map but the attacker's top-left corner,
    // so the main body's only outer border is far from the hole below.
    const corner = rect(0, 0, 49, 49);
    const piece = rect(10, 20, 25, 30);
    paint((x, y) => !corner(x, y) || piece(x, y));
    startClusterChecks();
    // An ally's enclave in a hole near the bottom-right, with fallout beside
    // it: the ring around the hole borders only the ally and fallout, so it
    // is a candidate on every pass although it belongs to the main body.
    defender.createAllianceRequest(third)!.accept();
    for (let x = 165; x <= 175; x++) {
      for (let y = 150; y <= 160; y++) third.conquer(game.ref(x, y));
    }
    fallout(rect(176, 150, 180, 160));
    // A piece out in the attacker's land, cut off by a strike at its end.
    fallout(rect(26, 20, 30, 30));
    const defenderLand = (x: number, y: number) => !corner(x, y);
    const mainBefore = defenderTilesIn(defenderLand);

    // Count the tiles the severed-land floods walk.
    let inFlood = false;
    let walked = 0;
    const proto = PlayerExecution.prototype as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    const original = proto.severedTerritory;
    const flood = vi
      .spyOn(proto, "severedTerritory")
      .mockImplementation(function (this: unknown, ...args: unknown[]) {
        inFlood = true;
        try {
          return original.apply(this, args);
        } finally {
          inFlood = false;
        }
      });
    const map = game.map();
    const neighbors4 = map.neighbors4.bind(map);
    vi.spyOn(map, "neighbors4").mockImplementation((ref, out) => {
      if (inFlood) walked++;
      return neighbors4(ref, out);
    });

    runClusterChecks();

    expect(flood).toHaveBeenCalled();
    expect(defenderTilesIn(piece)).toBe(0);
    expect(defenderTilesIn(defenderLand)).toBe(mainBefore);
    // The main body is ~37,000 tiles, and without a bound these passes walk
    // nearly all of it; a flood from the ring stops once it leaves the
    // ring's bounding box.
    expect(walked).toBeLessThan(1000);
  });

  test("two severed pieces as the last land conquer the player once, by the last captor", () => {
    // The main body falls first through the existing rules, as in the
    // single-piece test above, then two cut-off pieces, each walled in by a
    // different enemy.
    const main = rect(40, 80, 80, 120);
    const pocket = rect(81, 98, 83, 102);
    const pieceA = rect(150, 30, 175, 42);
    const pieceB = rect(150, 160, 175, 172);
    const thirdLand = rect(100, 140, 199, 199);
    const strips = union(rect(176, 30, 199, 42), rect(176, 160, 199, 172));
    game.map().forEachTile((t) => {
      const x = game.x(t);
      const y = game.y(t);
      if (main(x, y) || pieceA(x, y) || pieceB(x, y)) defender.conquer(t);
      else if (thirdLand(x, y)) third.conquer(t);
      else attacker.conquer(t);
    });
    // Until the strike the main body touches an unclaimed pocket and each
    // piece opens onto unclaimed land running to the map edge.
    game.map().forEachTile((t) => {
      const owner = game.owner(t);
      if (owner.isPlayer() && union(pocket, strips)(game.x(t), game.y(t))) {
        owner.relinquish(t);
      }
    });
    startClusterChecks();
    expect(defenderTilesIn(pieceA)).toBeGreaterThan(0);
    expect(defenderTilesIn(pieceB)).toBeGreaterThan(0);

    const conquerPlayer = vi.spyOn(game, "conquerPlayer");
    const captors: Player[] = [];
    const ticks = new Set<number>();
    for (const p of [attacker, third]) {
      const conquer = p.conquer.bind(p);
      vi.spyOn(p, "conquer").mockImplementation((t) => {
        if (game.ownerID(t) === defender.smallID()) {
          captors.push(p);
          ticks.add(game.ticks());
        }
        conquer(t);
      });
    }
    // In one tick the attacker seals the main body and strikes turn both
    // strips, plus each piece's last column, into fallout.
    game.map().forEachTile((t) => {
      if (pocket(game.x(t), game.y(t))) attacker.conquer(t);
    });
    fallout(union(rect(175, 30, 199, 42), rect(175, 160, 199, 172)));

    runClusterChecks();

    expect(defender.numTilesOwned()).toBe(0);
    // The main body and both pieces changed hands in one pass, the pieces
    // to different captors.
    expect(ticks.size).toBe(1);
    expect(captors).toContain(attacker);
    expect(captors).toContain(third);
    expect(conquerPlayer).toHaveBeenCalledTimes(1);
    expect(conquerPlayer).toHaveBeenCalledWith(
      captors[captors.length - 1],
      defender,
    );
  });

  test("a cut-off piece next to only fallout and an ally is kept", () => {
    paint(union(mainBody, arm));
    defender.createAllianceRequest(attacker)!.accept();
    startClusterChecks();
    crater(100, 100, 12);
    const tipBefore = defenderTilesIn(armTip);
    expect(tipBefore).toBeGreaterThan(0);

    runClusterChecks();

    expect(defenderTilesIn(armTip)).toBe(tipBefore);
  });

  // The piece borders the attacker west of `split` and the third player from
  // `split` east, including the tip's far end.
  test.each([
    { split: 125, winner: "third" },
    { split: 160, winner: "attacker" },
  ])(
    "a cut-off piece between two enemies goes to the longer border (split at x=$split)",
    ({ split, winner }) => {
      paint(union(mainBody, arm));
      game.map().forEachTile((t) => {
        if (game.x(t) >= split && game.ownerID(t) === attacker.smallID()) {
          third.conquer(t);
        }
      });
      startClusterChecks();
      crater(100, 100, 12);
      // Everything of the arm east of the crater is cut off.
      const cutOff = rect(101, 94, 170, 106);
      const cutBefore = defenderTilesIn(cutOff);
      expect(cutBefore).toBeGreaterThan(0);

      runClusterChecks();

      const expected = winner === "third" ? third : attacker;
      expect(tilesOwnedBy(expected, cutOff)).toBe(cutBefore);
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
