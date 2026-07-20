import { PlaneExecution } from "../src/core/execution/PlaneExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let player: Player;
let other: Player;

function findBuildableAirportTile(
  owner: Player,
  candidates: ReadonlyArray<[number, number]>,
): number {
  for (const [x, y] of candidates) {
    if (!game.isValidCoord(x, y)) {
      continue;
    }
    const tile = game.ref(x, y);
    owner.conquer(tile);
    if (owner.canBuild(UnitType.Airport, tile) !== false) {
      return tile;
    }
  }

  for (let y = 0; y < game.height(); y++) {
    for (let x = 0; x < game.width(); x++) {
      if (!game.isValidCoord(x, y)) {
        continue;
      }
      const tile = game.ref(x, y);
      owner.conquer(tile);
      if (owner.canBuild(UnitType.Airport, tile) !== false) {
        return tile;
      }
    }
  }

  throw new Error("No buildable airport tile found for test");
}

function buildAirport(owner: Player, tile: number): Unit {
  const spawn = owner.canBuild(UnitType.Airport, tile);
  if (spawn === false) {
    throw new Error("Unable to build airport for test");
  }
  return owner.buildUnit(UnitType.Airport, spawn, {});
}

describe("PlaneExecution", () => {
  beforeEach(async () => {
    game = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo("player", PlayerType.Human, null, "player_id"),
      new PlayerInfo("other", PlayerType.Human, null, "other_id"),
    ]);

    player = game.player("player_id");
    other = game.player("other_id");
    player.addGold(BigInt(10_000_000));
    other.addGold(BigInt(10_000_000));
    game.config().structureMinDist = () => 10;
  });

  test("Plane flies directly between airports and pays trade gold", () => {
    const srcTile = findBuildableAirportTile(player, [
      [7, 10],
      [10, 7],
      [12, 12],
      [5, 5],
      [20, 20],
    ]);
    const dstTile = findBuildableAirportTile(other, [
      [0, 0],
      [3, 3],
      [25, 25],
      [15, 15],
      [30, 30],
    ]);
    player.conquer(srcTile);
    other.conquer(dstTile);

    const srcAirport = buildAirport(player, srcTile);
    const dstAirport = buildAirport(other, dstTile);

    const p1GoldBefore = player.gold();
    const p2GoldBefore = other.gold();

    const execution = new PlaneExecution(player, srcAirport, dstAirport);
    execution.init(game, 0);

    for (let tick = 0; tick < 200; tick++) {
      execution.tick(tick);
      if (!execution.isActive()) {
        break;
      }
    }

    expect(execution.isActive()).toBe(false);
    expect(game.unitCount(UnitType.Plane)).toBe(0);

    const p1Gain = player.gold() - p1GoldBefore;
    const p2Gain = other.gold() - p2GoldBefore;

    expect(p1Gain).toBe(p2Gain);
    expect(p1Gain).toBeGreaterThanOrEqual(12_000n);
    expect(p1Gain).toBeLessThanOrEqual(20_000n);
  });
});
