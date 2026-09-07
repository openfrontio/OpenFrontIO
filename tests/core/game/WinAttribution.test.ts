import { describe, expect, test } from "vitest";
import { MarkDisconnectedExecution } from "../../../src/core/execution/MarkDisconnectedExecution";
import { GameMode, PlayerInfo, PlayerType } from "../../../src/core/game/Game";
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
    pA.markDisconnected(true, 100, 0.4);

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
    pA.markDisconnected(true, 50, 0.4);
    expect(pA.wasAliveOnDisconnect()).toBe(true);
    expect(pA.teamLandShareOnDisconnect()).toBe(0.4);

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
    pA.markDisconnected(true, 150, 0.75);
    expect(pA.wasAliveOnDisconnect()).toBe(true);
    expect(pA.teamLandShareOnDisconnect()).toBe(0.75);

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
    pA.markDisconnected(true, 50, 0.4);
    expect(pA.isDisconnected()).toBe(true);
    expect(pA.wasAliveOnDisconnect()).toBe(true);
    expect(pA.disconnectedAtTick()).toBe(50);

    // Reconnect
    pA.markDisconnected(false);
    expect(pA.isDisconnected()).toBe(false);
    expect(pA.wasAliveOnDisconnect()).toBe(false);
    expect(pA.teamLandShareOnDisconnect()).toBe(0);
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
    pA.markDisconnected(true, 50, 0.4);
    expect(pA.wasAliveOnDisconnect()).toBe(true);
    expect(pA.teamLandShareOnDisconnect()).toBe(0.4);

    // Reconnect
    pA.markDisconnected(false);

    // Disconnect again later at 75%
    pA.markDisconnected(true, 120, 0.75);
    expect(pA.wasAliveOnDisconnect()).toBe(true);
    expect(pA.teamLandShareOnDisconnect()).toBe(0.75);

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
    pA.markDisconnected(true, 50, 0.75);

    // Reconnect
    pA.markDisconnected(false);

    // Team lost ground, disconnect again at 50%
    pA.markDisconnected(true, 120, 0.5);
    expect(pA.teamLandShareOnDisconnect()).toBe(0.5);

    const team = pA.team()!;
    const winner = game.makeWinner(team);
    expect(winner?.slice(2)).not.toContain("clientA");
    expect(winner?.slice(2)).toContain("clientB");
  });

  test("MarkDisconnectedExecution integrates teamLandShare into player state", async () => {
    const { game, pA, landTiles } = await createTeamGame();

    pA.setSpawnTile(landTiles[0]);
    pA.conquer(landTiles[0]);

    const exec = new MarkDisconnectedExecution(pA, true);
    exec.init(game, 42);

    expect(pA.isDisconnected()).toBe(true);
    expect(pA.wasAliveOnDisconnect()).toBe(true);
    expect(pA.teamLandShareOnDisconnect()).toBeGreaterThan(0);
  });

  test("Test 6: Clan members overflowing maxTeamSize are converted to spectators", () => {
    const game = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: 2,
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
});
