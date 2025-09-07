import { NukeExecution } from "../../../src/core/execution/NukeExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { constructionExecution } from "../../util/utils";

let game: Game;
let player: Player;

describe("originTile emission on UnitUpdate", () => {
  beforeEach(async () => {
    game = await setup("plains", { infiniteGold: true, instantBuild: true });
    const pinfo = new PlayerInfo(
      "player",
      PlayerType.Human,
      "client_id",
      "player_id",
    );
    game.addPlayer(pinfo);

    // Ensure spawn phase completes
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player = game.player("player_id");

    // Give the player a Missile Silo at (1,1) for launching nukes
    constructionExecution(game, player, 1, 1, UnitType.MissileSilo);
  });

  test("AtomBomb UnitUpdate should include originTile (silo tile)", () => {
    const siloTile = game.ref(1, 1);
    const targetTile = game.ref(7, 7);

    // Launch an AtomBomb from the silo
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, player, targetTile, siloTile),
    );

    // Allow init + first movement tick
    game.executeNextTick();
    game.executeNextTick();

    const nukes = player.units(UnitType.AtomBomb);
    expect(nukes.length).toBe(1);

    // Use toUpdate() directly (server-side authoritative shape)
    const update = nukes[0].toUpdate();
    expect(update.unitType).toBe(UnitType.AtomBomb);
    expect(update.originTile).toBeDefined();
    expect(update.originTile).toBe(siloTile);
  });

  test("Non-nuke units should NOT include originTile", () => {
    const cityTile = game.ref(2, 2);
    player.buildUnit(UnitType.City, cityTile, {});

    // No extra ticks needed for buildUnit; assert directly
    const cities = player.units(UnitType.City);
    expect(cities.length).toBe(1);

    const update = cities[0].toUpdate();
    expect(update.unitType).toBe(UnitType.City);
    expect(update.originTile).toBeUndefined();
  });
});
