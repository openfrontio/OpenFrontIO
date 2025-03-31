import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { constructionExecution } from "./util/utils";

const coastX = 7;
let game: Game;
let player1: Player;
let player2: Player;

describe("Warship", () => {
  beforeEach(async () => {
    game = await setup("half_land_half_ocean", {
      infiniteGold: true,
      instantBuild: true,
    });
    const player_1_info = new PlayerInfo(
      "us",
      "boat dude",
      PlayerType.Human,
      null,
      "player_1_id",
    );
    game.addPlayer(player_1_info, 1000);
    const player_2_info = new PlayerInfo(
      "us",
      "boat dude",
      PlayerType.Human,
      null,
      "player_2_id",
    );
    game.addPlayer(player_2_info, 1000);

    game.addExecution(
      new SpawnExecution(
        game.player(player_1_info.id).info(),
        game.ref(coastX, 10),
      ),
      new SpawnExecution(
        game.player(player_2_info.id).info(),
        game.ref(coastX, 15),
      ),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player1 = game.player(player_1_info.id);
    player2 = game.player(player_2_info.id);
  });

  test("Warship heals only if player has port", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Warship).maxHealth;

    const port = player1.buildUnit(UnitType.Port, 0, game.ref(coastX, 10));
    const warship = player1.buildUnit(
      UnitType.Warship,
      0,
      game.ref(coastX + 1, 10),
    );

    game.executeNextTick();

    expect(warship.health()).toBe(maxHealth);
    warship.modifyHealth(-10);
    expect(warship.health()).toBe(maxHealth - 10);
    game.executeNextTick();
    expect(warship.health()).toBe(maxHealth - 9);

    port.delete();

    game.executeNextTick();
    expect(warship.health()).toBe(maxHealth - 9);
  });

  test("Warship captures trade if player has port", async () => {
    constructionExecution(game, player1.id(), coastX, 10, UnitType.Port);
    constructionExecution(game, player1.id(), coastX + 1, 10, UnitType.Warship);
    // Warship need one more tick (for warship exec to actually build warship)
    game.executeNextTick();
    expect(player1.units(UnitType.Warship)).toHaveLength(1);

    // Cannot buildExec with trade ship as it's not buildable (but
    // we can obviously directly add it to the player)
    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      0,
      game.ref(coastX + 1, 7),
    );

    expect(tradeShip.owner().id()).toBe(player2.id());
    // Let plenty of time for A* to execute
    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
    }
    expect(tradeShip.owner().id()).toBe(player1.id());
  });

  test("Warship do not capture trade if player has no port", async () => {
    constructionExecution(game, player1.id(), coastX, 10, UnitType.Port);
    constructionExecution(game, player1.id(), coastX + 1, 10, UnitType.Warship);
    expect(player1.units(UnitType.Warship)).toHaveLength(1);

    player1.units(UnitType.Port)[0].delete();
    // Cannot buildExec with trade ship as it's not buildable (but
    // we can obviously directly add it to the player)
    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      0,
      game.ref(coastX + 1, 11),
    );

    expect(tradeShip.owner().id()).toBe(player2.id());
    // Let plenty of time for A* to execute
    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
    }
    expect(tradeShip.owner().id()).toBe(player2.id());
  });
});
