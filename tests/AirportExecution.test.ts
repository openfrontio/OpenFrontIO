import { AirportExecution } from "../src/core/execution/AirportExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let player: Player;
let other: Player;

describe("AirportExecution", () => {
  beforeEach(async () => {
    game = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo("player", PlayerType.Human, null, "player_id"),
      new PlayerInfo("other", PlayerType.Human, null, "other_id"),
    ]);

    player = game.player("player_id");
    player.addGold(BigInt(1000000));
    other = game.player("other_id");

    game.config().structureMinDist = () => 10;
  });

  test("Destination airports chances scale with level", () => {
    game.config().proximityBonusPortsNb = () => 0;
    game.config().tradeShipShortRangeDebuff = () => 0;

    player.conquer(game.ref(7, 7));
    const spawn = player.canBuild(UnitType.Airport, game.ref(7, 7));
    if (spawn === false) {
      throw new Error("Unable to build airport for test");
    }
    const airport = player.buildUnit(UnitType.Airport, spawn, {});
    const execution = new AirportExecution(airport);
    execution.init(game, 0);
    execution.tick(0);

    other.conquer(game.ref(0, 0));
    const otherAirport = other.buildUnit(UnitType.Airport, game.ref(0, 0), {});
    otherAirport.increaseLevel();
    otherAirport.increaseLevel();

    const airports = execution.tradingAirports();

    expect(airports.length).toBe(3);
  });

  test("Plane proximity bonus mirrors port behavior", () => {
    game.config().proximityBonusPortsNb = () => 10;
    game.config().tradeShipShortRangeDebuff = () => 0;

    player.conquer(game.ref(7, 7));
    const spawn = player.canBuild(UnitType.Airport, game.ref(7, 7));
    if (spawn === false) {
      throw new Error("Unable to build airport for test");
    }
    const airport = player.buildUnit(UnitType.Airport, spawn, {});
    const execution = new AirportExecution(airport);
    execution.init(game, 0);
    execution.tick(0);

    other.conquer(game.ref(0, 0));
    other.buildUnit(UnitType.Airport, game.ref(0, 0), {});

    const airports = execution.tradingAirports();

    expect(airports.length).toBe(2);
  });
});
