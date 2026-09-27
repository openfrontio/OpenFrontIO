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
    pA.markDisconnected(true, {
      currentTick: 100,
      teamTiles: 40,
      totalLand: 100,
      wasAlive: false,
    });

    expect(pA.isAlive()).toBe(false);
    expect(pA.disconnectSnapshot()?.wasAlive).toBe(false);

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
    pA.markDisconnected(true, {
      currentTick: 50,
      teamTiles: 40,
      totalLand: 100,
      wasAlive: true,
    });
    expect(pA.disconnectSnapshot()?.wasAlive).toBe(true);

    // Later Player A's tile is eaten/conquered
    pA.relinquish(landTiles[0]);
    expect(pA.isAlive()).toBe(false);
    expect(pA.disconnectSnapshot()?.wasAlive).toBe(true);

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
    pA.markDisconnected(true, {
      currentTick: 150,
      teamTiles: 75,
      totalLand: 100,
      wasAlive: true,
    });
    expect(pA.disconnectSnapshot()?.wasAlive).toBe(true);

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
    pA.markDisconnected(true, {
      currentTick: 50,
      teamTiles: 40,
      totalLand: 100,
      wasAlive: true,
    });
    expect(pA.isDisconnected()).toBe(true);
    expect(pA.disconnectSnapshot()?.wasAlive).toBe(true);
    expect(pA.disconnectedAtTick()).toBe(50);

    // Reconnect
    pA.markDisconnected(false);
    expect(pA.isDisconnected()).toBe(false);
    expect(pA.disconnectSnapshot()).toBeNull();
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
    pA.markDisconnected(true, {
      currentTick: 50,
      teamTiles: 40,
      totalLand: 100,
      wasAlive: true,
    });
    expect(pA.disconnectSnapshot()?.wasAlive).toBe(true);

    // Reconnect
    pA.markDisconnected(false);

    // Disconnect again later at 75%
    pA.markDisconnected(true, {
      currentTick: 120,
      teamTiles: 75,
      totalLand: 100,
      wasAlive: true,
    });
    expect(pA.disconnectSnapshot()?.wasAlive).toBe(true);

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
    pA.markDisconnected(true, {
      currentTick: 50,
      teamTiles: 75,
      totalLand: 100,
      wasAlive: true,
    });

    // Reconnect
    pA.markDisconnected(false);
    expect(pA.disconnectSnapshot()).toBeNull();

    // Team lost ground, disconnect again at 50%
    pA.markDisconnected(true, {
      currentTick: 120,
      teamTiles: 50,
      totalLand: 100,
      wasAlive: true,
    });

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
    const snap = pA.disconnectSnapshot();
    expect(snap).not.toBeNull();
    expect(snap?.wasAlive).toBe(true);
    expect(snap?.teamTiles).toBeGreaterThan(0);
  });

  test("Test 9: Integer land share precision and threshold evaluation", async () => {
    const { game, pA, pB, landTiles } = await createTeamGame();

    pA.setSpawnTile(landTiles[0]);
    pA.conquer(landTiles[0]);
    pB.setSpawnTile(landTiles[1]);
    pB.conquer(landTiles[1]);
    const team = pA.team()!;

    // 699 out of 1000 tiles (69.9%) -> not winning
    pA.markDisconnected(true, {
      currentTick: 10,
      teamTiles: 699,
      totalLand: 1000,
      wasAlive: true,
    });
    expect(pA.disconnectSnapshot()?.teamTiles).toBe(699);
    expect(pA.disconnectSnapshot()?.totalLand).toBe(1000);
    expect(game.makeWinner(team)?.slice(2)).not.toContain("clientA");

    // Reconnect and disconnect at exactly 700 / 1000 (70.0%) -> winning
    pA.markDisconnected(false);
    pA.markDisconnected(true, {
      currentTick: 20,
      teamTiles: 700,
      totalLand: 1000,
      wasAlive: true,
    });
    expect(pA.disconnectSnapshot()?.teamTiles).toBe(700);
    expect(game.makeWinner(team)?.slice(2)).toContain("clientA");

    // Reconnect and disconnect at 7 / 10 -> winning
    pA.markDisconnected(false);
    pA.markDisconnected(true, {
      currentTick: 30,
      teamTiles: 7,
      totalLand: 10,
      wasAlive: true,
    });
    expect(game.makeWinner(team)?.slice(2)).toContain("clientA");
    expect(game.config().teamLandShareWinThresholdTenths()).toBe(7);
  });
});
