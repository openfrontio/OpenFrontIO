import { describe, expect, test } from "vitest";
import { MarkDisconnectedExecution } from "../../../src/core/execution/MarkDisconnectedExecution";
import { GameMode, PlayerInfo, PlayerType } from "../../../src/core/game/Game";
import { GameImpl } from "../../../src/core/game/GameImpl";
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
});
