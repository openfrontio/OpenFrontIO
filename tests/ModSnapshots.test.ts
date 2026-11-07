import {
  PlayerInfo,
  PlayerType,
  TrainType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AirportExecution } from "@openfront/engine/execution/AirportExecution";
import { CargoPlaneExecution } from "@openfront/engine/execution/CargoPlaneExecution";
import { FighterJetExecution } from "@openfront/engine/execution/FighterJetExecution";
import { TankExecution } from "@openfront/engine/execution/TankExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { setup } from "./util/Setup";
import { diffGraphs, diffSnapshots, roundTrip } from "./util/Snapshot";
import { executeTicks } from "./util/utils";

const MAP = "plains";

function claim(
  game: Game,
  player: Player,
  x0: number,
  y0: number,
  w: number,
  h: number,
) {
  for (let x = x0; x < x0 + w; x++) {
    for (let y = y0; y < y0 + h; y++) player.conquer(game.ref(x, y));
  }
}

describe("mod execution snapshots", () => {
  test("tanks, airports, cargo planes and jets round-trip mid-flight", async () => {
    const game = await setup(MAP, { infiniteGold: true, instantBuild: true }, [
      new PlayerInfo("one", PlayerType.Human, null, "p1"),
      new PlayerInfo("two", PlayerType.Human, null, "p2"),
    ]);
    const p1 = game.player("p1");
    const p2 = game.player("p2");
    claim(game, p1, 10, 10, 20, 20);
    claim(game, p2, 60, 10, 20, 20);
    executeTicks(game, 3);

    const a1 = p1.buildUnit(UnitType.Airport, game.ref(12, 12), {});
    const a2 = p2.buildUnit(UnitType.Airport, game.ref(62, 12), {});
    game.addExecution(new AirportExecution(a1), new AirportExecution(a2));
    game.addExecution(new CargoPlaneExecution(p1, a1, a2));
    const tank = p1.buildUnit(UnitType.Tank, game.ref(20, 20), {
      patrolTile: game.ref(20, 20),
    });
    game.addExecution(new TankExecution(tank));
    p2.buildUnit(UnitType.Train, game.ref(23, 20), {
      trainType: TrainType.Engine,
    });
    const jet = p2.buildUnit(UnitType.FighterJet, game.ref(50, 14), {
      patrolTile: game.ref(50, 14),
    });
    game.addExecution(new FighterJetExecution(jet));
    executeTicks(game, 8);
    expect(game.unitCount(UnitType.CargoPlane)).toBeGreaterThan(0);

    const { bytes, restored, again } = await roundTrip(game, MAP);
    expect(diffGraphs(game, restored)).toEqual([]);
    expect(diffSnapshots(bytes, again)).toEqual([]);

    for (let i = 0; i < 60; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(diffSnapshots(snapshotGame(game), snapshotGame(restored))).toEqual(
      [],
    );
  });
});
