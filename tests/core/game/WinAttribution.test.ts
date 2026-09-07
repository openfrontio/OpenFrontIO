import { describe, expect, test } from "vitest";
import { MarkDisconnectedExecution } from "../../../src/core/execution/MarkDisconnectedExecution";
import {
  Duos,
  GameMapType,
  GameMode,
  PlayerInfo,
  PlayerType,
  Quads,
  Trios,
} from "../../../src/core/game/Game";
import { GameImpl } from "../../../src/core/game/GameImpl";
import { ServerStartGameMessage } from "../../../src/core/Schemas";
import {
  cid,
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../../util/GameServerHarness";
import { setup } from "../../util/Setup";

describe("Win Attribution Bug Fix", () => {
  async function createTeamGame() {
    const pAInfo = new PlayerInfo(
      "PlayerA",
      PlayerType.Human,
      "clientA",
      "pA",
      false,
      null,
      [],
      0,
    );
    const pBInfo = new PlayerInfo(
      "PlayerB",
      PlayerType.Human,
      "clientB",
      "pB",
      false,
      null,
      [],
      0,
    );
    const pCInfo = new PlayerInfo(
      "PlayerC",
      PlayerType.Human,
      "clientC",
      "pC",
      false,
      null,
      [],
      1,
    );
    const pDInfo = new PlayerInfo(
      "PlayerD",
      PlayerType.Human,
      "clientD",
      "pD",
      false,
      null,
      [],
      1,
    );

    const game = (await setup(
      "plains",
      { gameMode: GameMode.Team, playerTeams: 2 },
      [pAInfo, pBInfo, pCInfo, pDInfo],
    )) as GameImpl;

    const landTiles: number[] = [];
    game.forEachTile((t) => {
      if (landTiles.length < 10 && game.map().isLand(t)) {
        landTiles.push(t);
      }
    });

    const pA = game.player("pA");
    const pB = game.player("pB");
    const pC = game.player("pC");
    const pD = game.player("pD");

    return { game, pA, pB, pC, pD, landTiles };
  }

  test("Test 1: Sacrificed teammate who died while playing is attributed the team win", async () => {
    const { game, pA, pB, landTiles } = await createTeamGame();

    pA.setSpawnTile(landTiles[0]);
    pA.conquer(landTiles[0]);
    pB.setSpawnTile(landTiles[1]);
    pB.conquer(landTiles[1]);

    // Teammate A dies while playing
    pA.relinquish(landTiles[0]);
    expect(pA.isAlive()).toBe(false);
    expect(pA.hasSpawned()).toBe(true);
    expect(pA.isDisconnected()).toBe(false);

    const team = pA.team()!;
    const winner = game.makeWinner(team);
    expect(winner).toBeDefined();
    expect(winner?.[0]).toBe("team");
    expect(winner?.[1]).toBe(team);
    expect(winner?.slice(2)).toContain("clientA");
    expect(winner?.slice(2)).toContain("clientB");
  });

  test("Test 1b: Sacrificed teammate who leaves after dying is attributed the team win", async () => {
    const { game, pA, pB, landTiles } = await createTeamGame();

    pA.setSpawnTile(landTiles[0]);
    pA.conquer(landTiles[0]);
    pB.setSpawnTile(landTiles[1]);
    pB.conquer(landTiles[1]);

    // Teammate A dies first, then disconnects
    pA.relinquish(landTiles[0]);
    pA.markDisconnected(true, 100, 40, 100);

    expect(pA.isAlive()).toBe(false);
    expect(pA.wasAliveOnDisconnect()).toBe(false);

    const team = pA.team()!;
    const winner = game.makeWinner(team);
    expect(winner?.slice(2)).toContain("clientA");
  });

  test("Test 2: Ragequit teammate who abandons active game at 40% land share is excluded from win", async () => {
    const { game, pA, pB, landTiles } = await createTeamGame();

    pA.setSpawnTile(landTiles[0]);
    pA.conquer(landTiles[0]);
    pB.setSpawnTile(landTiles[1]);
    pB.conquer(landTiles[1]);

    // Player A ragequits while alive when team has 40% land share
    pA.markDisconnected(true, 50, 40, 100);
    expect(pA.wasAliveOnDisconnect()).toBe(true);
    expect(pA.hasWinningLandShareOnDisconnect()).toBe(false);

    // Later Player A's tile is eaten/conquered
    pA.relinquish(landTiles[0]);
    expect(pA.isAlive()).toBe(false);
    expect(pA.wasAliveOnDisconnect()).toBe(true);

    const team = pA.team()!;
    const winner = game.makeWinner(team);
    expect(winner?.slice(2)).not.toContain("clientA");
    expect(winner?.slice(2)).toContain("clientB");
  });

  test("Test 3: Unspawned teammate never spawned and is excluded from win (default defeat)", async () => {
    const { game, pA, pB, landTiles } = await createTeamGame();

    // Player B spawns, Player A never spawns
    pB.setSpawnTile(landTiles[1]);
    pB.conquer(landTiles[1]);

    expect(pA.hasSpawned()).toBe(false);

    const team = pA.team()!;
    const winner = game.makeWinner(team);
    expect(winner?.slice(2)).not.toContain("clientA");
    expect(winner?.slice(2)).toContain("clientB");
  });

  test("Test 4: Late disconnect post-70% retains team win", async () => {
    const { game, pA, pB, landTiles } = await createTeamGame();

    pA.setSpawnTile(landTiles[0]);
    pA.conquer(landTiles[0]);
    pB.setSpawnTile(landTiles[1]);
    pB.conquer(landTiles[1]);

    // Player A leaves while alive after team achieved 75% land share
    pA.markDisconnected(true, 150, 75, 100);
    expect(pA.wasAliveOnDisconnect()).toBe(true);
    expect(pA.hasWinningLandShareOnDisconnect()).toBe(true);

    const team = pA.team()!;
    const winner = game.makeWinner(team);
    expect(winner?.slice(2)).toContain("clientA");
    expect(winner?.slice(2)).toContain("clientB");
  });

  test("Test 5: Reconnected teammate resets disconnect state and receives win", async () => {
    const { game, pA, pB, landTiles } = await createTeamGame();

    pA.setSpawnTile(landTiles[0]);
    pA.conquer(landTiles[0]);
    pB.setSpawnTile(landTiles[1]);
    pB.conquer(landTiles[1]);

    // Disconnect at 40%
    pA.markDisconnected(true, 50, 40, 100);
    expect(pA.isDisconnected()).toBe(true);
    expect(pA.wasAliveOnDisconnect()).toBe(true);
    expect(pA.disconnectedAtTick()).toBe(50);

    // Reconnect
    pA.markDisconnected(false);
    expect(pA.isDisconnected()).toBe(false);
    expect(pA.wasAliveOnDisconnect()).toBe(false);
    expect(pA.teamTilesOnDisconnect()).toBe(0);
    expect(pA.totalLandOnDisconnect()).toBe(0);
    expect(pA.disconnectedAtTick()).toBeNull();

    const team = pA.team()!;
    const winner = game.makeWinner(team);
    expect(winner?.slice(2)).toContain("clientA");
    expect(winner?.slice(2)).toContain("clientB");
  });

  test("Test 5b: Reconnects then disconnects again at 75% uses latest disconnect state and wins", async () => {
    const { game, pA, pB, landTiles } = await createTeamGame();

    pA.setSpawnTile(landTiles[0]);
    pA.conquer(landTiles[0]);
    pB.setSpawnTile(landTiles[1]);
    pB.conquer(landTiles[1]);

    // Disconnect at 40%
    pA.markDisconnected(true, 50, 40, 100);
    expect(pA.wasAliveOnDisconnect()).toBe(true);
    expect(pA.hasWinningLandShareOnDisconnect()).toBe(false);

    // Reconnect
    pA.markDisconnected(false);

    // Disconnect again later at 75%
    pA.markDisconnected(true, 120, 75, 100);
    expect(pA.wasAliveOnDisconnect()).toBe(true);
    expect(pA.hasWinningLandShareOnDisconnect()).toBe(true);

    const team = pA.team()!;
    const winner = game.makeWinner(team);
    expect(winner?.slice(2)).toContain("clientA");
    expect(winner?.slice(2)).toContain("clientB");
  });

  test("Test 5c: Reconnects then disconnects again below 70% uses latest state and forfeits", async () => {
    const { game, pA, pB, landTiles } = await createTeamGame();

    pA.setSpawnTile(landTiles[0]);
    pA.conquer(landTiles[0]);
    pB.setSpawnTile(landTiles[1]);
    pB.conquer(landTiles[1]);

    // Disconnect at 75%
    pA.markDisconnected(true, 50, 75, 100);
    expect(pA.hasWinningLandShareOnDisconnect()).toBe(true);

    // Reconnect
    pA.markDisconnected(false);
    expect(pA.wasAliveOnDisconnect()).toBe(false);

    // Team lost ground, disconnect again at 50%
    pA.markDisconnected(true, 120, 50, 100);
    expect(pA.hasWinningLandShareOnDisconnect()).toBe(false);

    const team = pA.team()!;
    const winner = game.makeWinner(team);
    expect(winner?.slice(2)).not.toContain("clientA");
    expect(winner?.slice(2)).toContain("clientB");
  });

  test("MarkDisconnectedExecution integrates team land tiles into player state", async () => {
    const { game, pA, landTiles } = await createTeamGame();

    pA.setSpawnTile(landTiles[0]);
    pA.conquer(landTiles[0]);

    const exec = new MarkDisconnectedExecution(pA, true);
    exec.init(game, 42);

    expect(pA.isDisconnected()).toBe(true);
    expect(pA.wasAliveOnDisconnect()).toBe(true);
    expect(pA.teamTilesOnDisconnect()).toBeGreaterThan(0);
  });

  test("Test 6: Clan members overflowing maxTeamSize are converted to spectators", () => {
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
    // Total players in start info is 7 (4 CLAN + 3 OTHER)
    expect(startPlayers).toHaveLength(7);
  });

  test("Test 7: Pinned / matchmade games exempt clan members from spectator conversion", () => {
    const game = makeGame({
      matchmakingTeams: [
        ["p1", "p2"],
        ["p3", "p4"],
      ],
      config: {
        gameMode: GameMode.Team,
        playerTeams: 2,
      },
    });

    const clients = [
      makeClient({ clientID: cid("c1"), publicId: "p1", clanTag: "CLAN" }),
      makeClient({ clientID: cid("c2"), publicId: "p2", clanTag: "CLAN" }),
      makeClient({ clientID: cid("c3"), publicId: "p3", clanTag: "CLAN" }),
      makeClient({ clientID: cid("c4"), publicId: "p4", clanTag: "CLAN" }),
    ];

    for (const c of clients) {
      game.joinClient(c);
    }

    startGame(game);

    const startMsg = mockWsOf(clients[0])
      .sent()
      .find((m): m is ServerStartGameMessage => m.type === "start");
    expect(startMsg).toBeDefined();
    const startPlayers = startMsg!.gameStartInfo.players;

    // All 4 players remain active players, none demoted to spectator
    expect(startPlayers).toHaveLength(4);
    for (const c of clients) {
      expect(c.spectator).toBe(false);
    }
  });

  test("Test 8: Queued intents from converted clan overflow spectators are pruned", () => {
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
    expect(serverAny.intents.some((i: any) => i.clientID === cid("c1"))).toBe(
      true,
    );
  });

  test("Test 9: Integer land share precision and threshold evaluation", async () => {
    const { game, pA } = await createTeamGame();

    // 699 out of 1000 tiles (69.9%) -> not winning
    pA.markDisconnected(true, 10, 699, 1000);
    expect(pA.hasWinningLandShareOnDisconnect()).toBe(false);
    expect(pA.teamTilesOnDisconnect()).toBe(699);
    expect(pA.totalLandOnDisconnect()).toBe(1000);

    // Reconnect and disconnect at exactly 700 / 1000 (70.0%) -> winning
    pA.markDisconnected(false);
    pA.markDisconnected(true, 20, 700, 1000);
    expect(pA.hasWinningLandShareOnDisconnect()).toBe(true);
    expect(pA.teamTilesOnDisconnect()).toBe(700);

    // Reconnect and disconnect at 7 / 10 -> winning
    pA.markDisconnected(false);
    pA.markDisconnected(true, 30, 7, 10);
    expect(pA.hasWinningLandShareOnDisconnect()).toBe(true);
    expect(game.config().teamLandShareWinThresholdTenths()).toBe(7);
  });

  test("Test 10: Fixed team size modes (Quads, Trios, Duos) strictly cap clan sizes to 4, 3, 2", () => {
    // Quads: 5 clan members join, 5th must become spectator
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

    // Trios: 4 clan members join, 4th must become spectator
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

    // Duos: 3 clan members join, 3rd must become spectator
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

  test("Test 11: Variable player size with nations accounts for nation slider count", () => {
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

  test("Test 12: Clan overflow accounts for default map nation count in variable team sizing", () => {
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
