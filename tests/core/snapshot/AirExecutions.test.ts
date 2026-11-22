import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AAGunExecution } from "@openfront/engine/execution/air/AAGunExecution";
import { AircraftExecution } from "@openfront/engine/execution/air/AircraftExecution";
import { AirStructureExecution } from "@openfront/engine/execution/air/AirStructureExecution";
import { SAMLauncherExecution } from "@openfront/engine/execution/SAMLauncherExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../../util/Setup";
import { expectSnapshotRoundTrip } from "../../util/Snapshot";
import { executeTicks } from "../../util/utils";

const MAP = "big_plains";

function conquerRect(
  game: Game,
  p: Player,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) p.conquer(game.ref(x, y));
  }
}

function humans(...ids: string[]): PlayerInfo[] {
  return ids.map((id) => new PlayerInfo(id, PlayerType.Human, null, id));
}

describe("snapshot: AIR update", () => {
  async function airGame() {
    const game = await setup(
      MAP,
      { infiniteGold: true, instantBuild: true },
      humans("a", "b"),
    );
    const a = game.player("a");
    const b = game.player("b");
    conquerRect(game, a, 0, 0, 100, 200);
    conquerRect(game, b, 100, 0, 200, 200);
    a.addTroops(100_000);
    b.addTroops(100_000);
    return { game, a, b };
  }

  test("aircraft on every leg of a sortie, guided missiles and flak in flight", async () => {
    const { game, a, b } = await airGame();
    const baseA = a.buildUnit(UnitType.Airbase, game.ref(70, 100), {});
    const radarA = a.buildUnit(UnitType.RadarStation, game.ref(90, 100), {});
    const samA = a.buildUnit(UnitType.SAMLauncher, game.ref(95, 100), {});
    const gunA = a.buildUnit(UnitType.AAGun, game.ref(95, 110), {});
    const baseB = b.buildUnit(UnitType.Airbase, game.ref(140, 100), {});
    b.buildUnit(UnitType.City, game.ref(110, 110), {});
    game.addExecution(
      new AirStructureExecution(baseA),
      new AirStructureExecution(radarA),
      new AirStructureExecution(baseB),
      new SAMLauncherExecution(a, null, samA),
      new AAGunExecution(gunA),
      new AircraftExecution({
        owner: a,
        type: UnitType.Fighter,
        patrolTile: game.ref(100, 100),
      }),
      new AircraftExecution({
        owner: b,
        type: UnitType.Bomber,
        patrolTile: game.ref(80, 100),
      }),
      new AircraftExecution({
        owner: b,
        type: UnitType.AttackHelicopter,
        patrolTile: game.ref(100, 112),
      }),
      new AircraftExecution({
        owner: a,
        type: UnitType.TransportHelicopter,
        patrolTile: game.ref(120, 150),
      }),
    );
    // Queued, then docked on the ground.
    await expectSnapshotRoundTrip(game, MAP, 3);
    executeTicks(game, 30);
    // Mid-flight, engagements under way.
    await expectSnapshotRoundTrip(game, MAP, 40);
    executeTicks(game, 60);
    await expectSnapshotRoundTrip(game, MAP, 60);
    expect(
      game.units(UnitType.Fighter, UnitType.Bomber).length,
    ).toBeGreaterThan(0);
  });
});
