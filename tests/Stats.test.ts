import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { Stats } from "../src/core/game/Stats";
import { StatsImpl } from "../src/core/game/StatsImpl";
import { replacer } from "../src/core/Util";
import { setup } from "./util/Setup";

let stats: Stats;
let game: Game;
let player1: Player;
let player2: Player;

describe("Stats", () => {
  beforeEach(async () => {
    stats = new StatsImpl();
    game = await setup("half_land_half_ocean", {}, [
      new PlayerInfo("boat dude", PlayerType.Human, "client1", "player_1_id"),
      new PlayerInfo("boat dude", PlayerType.Human, "client2", "player_2_id"),
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

  test("bombLaunch", () => {
    stats.bombLaunch(player1, player2, UnitType.AtomBomb);
    expect(stats.stats()).toStrictEqual({
      client1: { bombs: { abomb: [1n] } },
    });
  });

  test("bombLand", () => {
    stats.bombLand(player1, player2, UnitType.HydrogenBomb);
    expect(stats.stats()).toStrictEqual({
      client1: { bombs: { hbomb: [0n, 1n] } },
    });
  });

  test("bombIntercept", () => {
    stats.bombIntercept(player1, UnitType.MIRVWarhead, 1);
    expect(stats.stats()).toStrictEqual({
      client1: { bombs: { mirvw: [0n, 0n, 1n] } },
    });
  });

  test("goldWar", () => {
    stats.goldWar(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: { gold: [0n, 1n] },
    });
  });

  test("goldWork", () => {
    stats.goldWork(player1, 1);
    expect(stats.stats()).toStrictEqual({
      client1: { gold: [1n] },
    });
  });

  test("unitBuild", () => {
    stats.unitBuild(player1, UnitType.City);
    expect(stats.stats()).toStrictEqual({
      client1: { units: { city: [1n] } },
    });
  });

  test("unitCapture", () => {
    stats.unitCapture(player1, UnitType.DefensePost);
    expect(stats.stats()).toStrictEqual({
      client1: {
        units: {
          defp: [0n, 0n, 1n],
        },
      },
    });
  });

  test("unitDestroy", () => {
    stats.unitDestroy(player1, UnitType.MissileSilo);
    expect(stats.stats()).toStrictEqual({
      client1: {
        units: {
          silo: [0n, 1n],
        },
      },
    });
  });

  test("unitLose", () => {
    stats.unitLose(player1, UnitType.Port);
    expect(stats.stats()).toStrictEqual({
      client1: {
        units: {
          port: [0n, 0n, 0n, 1n],
        },
      },
    });
  });

  test("emojiSend", () => {
    stats.emojiSend(player1, player2);
    expect(stats.stats()).toStrictEqual({
      client1: {
        actions: {
          emoji: [1n, 0n, 0n],
        },
      },
      client2: {
        actions: {
          emoji: [0n, 1n, 0n],
        },
      },
    });
    stats.emojiSend(player1, player2);
    expect(stats.stats()).toStrictEqual({
      client1: {
        actions: {
          emoji: [2n, 0n, 0n],
        },
      },
      client2: {
        actions: {
          emoji: [0n, 2n, 0n],
        },
      },
    });
    stats.emojiSend(player2, player1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        actions: {
          emoji: [2n, 1n, 0n],
        },
      },
      client2: {
        actions: {
          emoji: [1n, 2n, 0n],
        },
      },
    });
  });

  test("emojiBroadcast", () => {
    stats.emojiBroadcast(player1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        actions: {
          emoji: [0n, 0n, 1n],
        },
      },
    });

    // multiple broadcasts accumulate
    stats.emojiBroadcast(player1);
    stats.emojiBroadcast(player1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        actions: {
          emoji: [0n, 0n, 3n],
        },
      },
    });
  });

  test("quickChatSend", () => {
    stats.quickChatSend(player1, player2);
    expect(stats.stats()).toStrictEqual({
      client1: {
        actions: {
          quickchat: [1n, 0n],
        },
      },
      client2: {
        actions: {
          quickchat: [0n, 1n],
        },
      },
    });
    stats.quickChatSend(player1, player2);
    expect(stats.stats()).toStrictEqual({
      client1: {
        actions: {
          quickchat: [2n, 0n],
        },
      },
      client2: {
        actions: {
          quickchat: [0n, 2n],
        },
      },
    });
    stats.quickChatSend(player2, player1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        actions: {
          quickchat: [2n, 1n],
        },
      },
      client2: {
        actions: {
          quickchat: [1n, 2n],
        },
      },
    });
  });

  test("targetSend", () => {
    stats.targetSend(player1, player2);
    expect(stats.stats()).toStrictEqual({
      client1: {
        actions: {
          target: [1n, 0n],
        },
      },
      client2: {
        actions: {
          target: [0n, 1n],
        },
      },
    });
    stats.targetSend(player1, player2);
    expect(stats.stats()).toStrictEqual({
      client1: {
        actions: {
          target: [2n, 0n],
        },
      },
      client2: {
        actions: {
          target: [0n, 2n],
        },
      },
    });
    stats.targetSend(player2, player1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        actions: {
          target: [2n, 1n],
        },
      },
      client2: {
        actions: {
          target: [1n, 2n],
        },
      },
    });
  });

  test("recordConquer", () => {
    stats.recordConquer(player1, "bot");
    expect(stats.stats()).toStrictEqual({
      client1: {
        conquers: [1n, 0n, 0n],
      },
    });
    stats.recordConquer(player1, "nation");
    expect(stats.stats()).toStrictEqual({
      client1: {
        conquers: [1n, 1n, 0n],
      },
    });
    stats.recordConquer(player2, "player");
    expect(stats.stats()).toStrictEqual({
      client1: {
        conquers: [1n, 1n, 0n],
      },
      client2: {
        conquers: [0n, 0n, 1n],
      },
    });
  });

  test("troopsSend", () => {
    stats.troopsSend(player1, player2, 100);
    expect(stats.stats()).toStrictEqual({
      client1: {
        actions: {
          troops: [100n, 0n],
        },
      },
      client2: {
        actions: {
          troops: [0n, 100n],
        },
      },
    });

    stats.troopsSend(player1, player2, 50);
    expect(stats.stats()).toStrictEqual({
      client1: {
        actions: {
          troops: [150n, 0n],
        },
      },
      client2: {
        actions: {
          troops: [0n, 150n],
        },
      },
    });

    stats.troopsSend(player2, player1, 25);
    expect(stats.stats()).toStrictEqual({
      client1: {
        actions: {
          troops: [150n, 25n],
        },
      },
      client2: {
        actions: {
          troops: [25n, 150n],
        },
      },
    });
  });

  test("goldSend", () => {
    stats.goldSend(player1, player2, 1000n);
    expect(stats.stats()).toStrictEqual({
      client1: {
        actions: {
          gold: [1000n, 0n],
        },
      },
      client2: {
        actions: {
          gold: [0n, 1000n],
        },
      },
    });

    stats.goldSend(player1, player2, 500n);
    expect(stats.stats()).toStrictEqual({
      client1: {
        actions: {
          gold: [1500n, 0n],
        },
      },
      client2: {
        actions: {
          gold: [0n, 1500n],
        },
      },
    });

    stats.goldSend(player2, player1, 250n);
    expect(stats.stats()).toStrictEqual({
      client1: {
        actions: {
          gold: [1500n, 250n],
        },
      },
      client2: {
        actions: {
          gold: [250n, 1500n],
        },
      },
    });
  });

  test("stringify", () => {
    stats.unitLose(player1, UnitType.Port);
    expect(JSON.stringify(stats.stats(), replacer)).toBe(
      '{"client1":{"units":{"port":["0","0","0","1"]}}}',
    );
  });
});
