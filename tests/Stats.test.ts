import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { Stats } from "../src/core/game/Stats";
import { StatsImpl } from "../src/core/game/StatsImpl";
import { setup } from "./util/Setup";

let stats: Stats;
let game: Game;
let player1: Player;
let player2: Player;

describe("Stats", () => {
  beforeEach(async () => {
    stats = new StatsImpl();
    game = await setup("half_land_half_ocean", {}, [
      new PlayerInfo(
        "us",
        "boat dude",
        PlayerType.Human,
        "client1",
        "player_1_id",
      ),
      new PlayerInfo(
        "us",
        "boat dude",
        PlayerType.Human,
        "client2",
        "player_2_id",
      ),
    ]);

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player1 = game.player("player_1_id");
    player2 = game.player("player_2_id");
  });

  test("attack", () => {
    stats.attack(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        attacks: [1n],
      },
      client2: {
        attacks: [0n, 1n],
      },
    });
  });

  test("attackCancel", () => {
    stats.attackCancel(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        attacks: [-1n, 0n, 1n],
      },
      client2: {
        attacks: [0n, -1n],
      },
    });
  });

  test("betray", () => {
    stats.betray(player1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        betrayals: 1n,
      },
    });
  });

  test("boatSendTrade", () => {
    stats.boatSendTrade(player1, player2);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: {
          trade: [1n],
        },
      },
    });
  });

  test("boatArriveTrade", () => {
    stats.boatArriveTrade(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: { trade: [0n, 1n] },
        gold: [0n, 0n, 1n],
      },
      client2: {
        gold: [0n, 0n, 1n],
      },
    });
  });

  test("boatCapturedTrade", () => {
    stats.boatCapturedTrade(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: { trade: [0n, 0n, 1n] },
        gold: [0n, 0n, 0n, 1n],
      },
    });
  });

  test("boatDestroyTrade", () => {
    stats.boatDestroyTrade(player1, player2);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: { trade: [0n, 0n, 0n, 1n] },
      },
    });
  });

  test("boatSendTroops", () => {
    stats.boatSendTroops(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: {
          trans: [1n],
        },
      },
    });
  });

  test("boatArriveTroops", () => {
    stats.boatArriveTroops(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: { trans: [0n, 1n] },
      },
    });
  });

  test("boatDestroyTroops", () => {
    stats.boatDestroyTroops(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: { trans: [0n, 0n, 0n, 1n] },
      },
    });
  });
});
