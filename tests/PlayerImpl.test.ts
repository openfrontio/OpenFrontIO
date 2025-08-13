import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let player: Player;
let other: Player;

describe("PlayerImpl", () => {
  beforeEach(async () => {
    game = await setup(
      "plains",
      {
        instantBuild: true,
      },
      [
        new PlayerInfo("player", PlayerType.Human, null, "player_id"),
        new PlayerInfo("other", PlayerType.Human, null, "other_id"),
      ],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player = game.player("player_id");
    player.addGold(BigInt(1000000));
    other = game.player("other_id");

    game.config().structureMinDist = () => 10;
  });

  test("City can be upgraded", () => {
    const city = player.buildUnit("City", game.ref(0, 0), {});
    const buCity = player
      .buildableUnits(game.ref(0, 0))
      .find((bu) => bu.type === "City");
    expect(buCity).toBeDefined();
    expect(buCity!.canUpgrade).toBe(city.id());
  });

  test("DefensePost cannot be upgraded", () => {
    player.buildUnit("Defense Post", game.ref(0, 0), {});
    const buDefensePost = player
      .buildableUnits(game.ref(0, 0))
      .find((bu) => bu.type === "Defense Post");
    expect(buDefensePost).toBeDefined();
    expect(buDefensePost!.canUpgrade).toBeFalsy();
  });

  test("City can be upgraded from another city", () => {
    const city = player.buildUnit("City", game.ref(0, 0), {});
    const cityToUpgrade = player.findUnitToUpgrade("City", game.ref(0, 1));
    expect(cityToUpgrade).toBeTruthy();
    if (cityToUpgrade === false) {
      return;
    }
    expect(cityToUpgrade.id()).toBe(city.id());
  });
  test("City cannot be upgraded when too far away", () => {
    player.buildUnit("City", game.ref(0, 0), {});
    const cityToUpgrade = player.findUnitToUpgrade("City", game.ref(50, 50));
    expect(cityToUpgrade).toBe(false);
  });
  test("Unit cannot be upgraded when not enough gold", () => {
    player.buildUnit("City", game.ref(0, 0), {});
    player.removeGold(BigInt(1000000));
    const cityToUpgrade = player.findUnitToUpgrade("City", game.ref(0, 1));
    expect(cityToUpgrade).toBe(false);
  });

  test("Can't send alliance requests when dead", () => {
    // conquer other
    const otherTiles = other.tiles();
    for (const tile of otherTiles) {
      player.conquer(tile);
    }
    expect(other.canSendAllianceRequest(player)).toBe(false);
  });
});
