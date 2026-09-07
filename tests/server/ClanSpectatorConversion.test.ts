import { describe, expect, test } from "vitest";
import {
  Duos,
  GameMapType,
  GameMode,
  Quads,
  Trios,
} from "../../src/core/game/Game";
import { ServerStartGameMessage } from "../../src/core/Schemas";
import {
  cid,
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

describe("GameServer - Clan Overflow Spectator Conversion", () => {
  test("Clan members overflowing maxTeamSize are converted to spectators", () => {
    const game = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: 2,
        nations: "disabled",
      },
    });

    const clients = [
      makeClient({ clientID: cid("c1"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c2"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c3"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c4"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c5"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c6"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("c7"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("c8"), clanTag: "OTHER" }),
    ];

    for (const c of clients) {
      game.joinClient(c);
    }

    // 8 players, 2 teams -> maxTeamSize = ceil(8 / 2) = 4
    startGame(game);

    const startMsg = mockWsOf(clients[0])
      .sent()
      .find((m): m is ServerStartGameMessage => m.type === "start");
    expect(startMsg).toBeDefined();

    const startPlayers = startMsg!.gameStartInfo.players;

    // Exactly 4 CLAN members in start info
    const clanPlayers = startPlayers.filter((p) => p.clanTag === "CLAN");
    expect(clanPlayers).toHaveLength(4);

    // 5th CLAN member converted to spectator
    expect(clients[4].spectator).toBe(true);

    // First 4 remain players
    expect(clients.slice(0, 4).every((c) => !c.spectator)).toBe(true);
  });

  test("Matchmaking games exempt clan members from spectator conversion", () => {
    // In matchmade games, the matchmaker already placed clients and balanced teams.
    const game = makeGame({
      matchmakingTeams: [
        [cid("ma"), cid("mb"), cid("mc"), cid("md"), cid("me")],
        [cid("mf"), cid("mg"), cid("mh"), cid("mi"), cid("mj")],
      ],
      config: {
        gameMode: GameMode.Team,
        playerTeams: 2,
        nations: "disabled",
      },
    });

    const clients = [
      makeClient({ clientID: cid("ma"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("mb"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("mc"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("md"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("me"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("mf"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("mg"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("mh"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("mi"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("mj"), clanTag: "OTHER" }),
    ];

    for (const c of clients) {
      game.joinClient(c);
    }

    startGame(game);

    // All 5 CLAN members remain players because matchmaker assigned them
    expect(clients.every((c) => !c.spectator)).toBe(true);
  });

  test("Queued intents from converted clan overflow spectators are pruned", () => {
    const game = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: 2,
        nations: "disabled",
      },
    });

    const clients = [
      makeClient({ clientID: cid("c1"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c2"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c3"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c4"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c5"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c6"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("c7"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("c8"), clanTag: "OTHER" }),
    ];

    for (const c of clients) {
      game.joinClient(c);
    }

    // Queue intent from c1 (kept) and c5 (converted to spectator)
    const serverAny = game as any;
    serverAny.intents.push({
      type: "chat",
      clientID: cid("c1"),
      text: "hello",
    });
    serverAny.intents.push({
      type: "chat",
      clientID: cid("c5"),
      text: "overflow message",
    });

    expect(serverAny.intents.some((i: any) => i.clientID === cid("c5"))).toBe(
      true,
    );

    startGame(game);

    // c5 converted to spectator, so its intent was pruned
    expect(clients[4].spectator).toBe(true);
    expect(serverAny.intents.some((i: any) => i.clientID === cid("c5"))).toBe(
      false,
    );
    // c1 intent retained
    expect(serverAny.intents.some((i: any) => i.clientID === cid("c1"))).toBe(
      true,
    );
  });

  test("Pinned matchmaking players seeded by index are exempt from conversion", () => {
    const game = makeGame({
      matchmakingTeams: [
        [cid("p1"), cid("p2"), cid("p3")],
        [cid("p4"), cid("p5"), cid("p6")],
      ],
      config: {
        gameMode: GameMode.Team,
        playerTeams: 2,
        nations: "disabled",
      },
    });

    const clients = [
      makeClient({ clientID: cid("p1"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("p2"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("p3"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("p4"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("p5"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("p6"), clanTag: "OTHER" }),
    ];

    for (const c of clients) game.joinClient(c);
    startGame(game);

    expect(clients.every((c) => !c.spectator)).toBe(true);
  });

  test("Fixed playerTeams config (Duos, Trios, Quads) strictly limits clan size", () => {
    // Quads: team size = 4
    const quadsGame = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: Quads,
      },
    });
    const quadsClients = [
      makeClient({ clientID: cid("q1"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("q2"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("q3"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("q4"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("q5"), clanTag: "CLAN" }),
    ];
    for (const c of quadsClients) quadsGame.joinClient(c);
    startGame(quadsGame);

    expect(quadsClients.slice(0, 4).every((c) => !c.spectator)).toBe(true);
    expect(quadsClients[4].spectator).toBe(true);

    // Trios: team size = 3
    const triosGame = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: Trios,
      },
    });
    const triosClients = [
      makeClient({ clientID: cid("t1"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("t2"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("t3"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("t4"), clanTag: "CLAN" }),
    ];
    for (const c of triosClients) triosGame.joinClient(c);
    startGame(triosGame);

    expect(triosClients.slice(0, 3).every((c) => !c.spectator)).toBe(true);
    expect(triosClients[3].spectator).toBe(true);

    // Duos: team size = 2
    const duosGame = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: Duos,
      },
    });
    const duosClients = [
      makeClient({ clientID: cid("d1"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("d2"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("d3"), clanTag: "CLAN" }),
    ];
    for (const c of duosClients) duosGame.joinClient(c);
    startGame(duosGame);

    expect(duosClients.slice(0, 2).every((c) => !c.spectator)).toBe(true);
    expect(duosClients[2].spectator).toBe(true);
  });

  test("Variable player size with nations accounts for nation slider count", () => {
    // 5 clan players with 201 nations in 2 teams -> capacity ceil((5+201)/2) = 103 -> none converted
    const game = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: 2,
        nations: 201,
      },
    });
    const clients = [
      makeClient({ clientID: cid("n1"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("n2"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("n3"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("n4"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("n5"), clanTag: "CLAN" }),
    ];
    for (const c of clients) game.joinClient(c);
    startGame(game);

    for (const c of clients) {
      expect(c.spectator).toBe(false);
    }
  });

  test("Clan overflow accounts for default map nation count in variable team sizing", () => {
    // World map has 72 default nations.
    // Case A: 10 players in clan CLAN (total = 10 + 72 = 82):
    // maxTeamSize = ceil(82 / 2) = 41.
    // All 10 clan members should remain active players.
    const game = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: 2,
        nations: "default",
        gameMap: GameMapType.World,
      },
    });
    const clients = Array.from({ length: 10 }, (_, i) =>
      makeClient({ clientID: cid(`d${i}`), clanTag: "CLAN" }),
    );
    for (const c of clients) game.joinClient(c);
    startGame(game);

    for (const c of clients) {
      expect(c.spectator).toBe(false);
    }

    // Case B: Map with 0 default nations (e.g. BaikalNukeWars) and 2 teams:
    // 5 clan members on BaikalNukeWars with 2 teams -> maxTeamSize = ceil((5 + 0) / 2) = 3.
    // First 3 fit, remaining 2 converted to spectator!
    const zeroNationsGame = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: 2,
        nations: "default",
        gameMap: GameMapType.BaikalNukeWars,
      },
    });
    const zeroNationsClients = Array.from({ length: 5 }, (_, i) =>
      makeClient({ clientID: cid(`z${i}`), clanTag: "CLAN" }),
    );
    for (const c of zeroNationsClients) zeroNationsGame.joinClient(c);
    startGame(zeroNationsGame);

    expect(zeroNationsClients.slice(0, 3).every((c) => !c.spectator)).toBe(
      true,
    );
    expect(zeroNationsClients.slice(3).every((c) => c.spectator)).toBe(true);
  });
});
