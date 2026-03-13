import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { PlayerInfo, PlayerType } from "../src/core/game/Game";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";

describe("Block Player Feature", () => {
  it("Should block interactions between players", async () => {
    const game = await setup("ocean_and_land", {});
    const gameID: GameID = "game_id";

    const p1Info = new PlayerInfo("p1", PlayerType.Human, null, "p1_id");
    const p2Info = new PlayerInfo("p2", PlayerType.Human, null, "p2_id");

    game.addPlayer(p1Info);
    game.addPlayer(p2Info);

    const p1 = game.player(p1Info.id);
    const p2 = game.player(p2Info.id);

    // Spawn both players to ensure they are alive
    const spawnA = game.ref(0, 10);
    const spawnB = game.ref(0, 15);

    game.addExecution(
      new SpawnExecution(gameID, p1Info, spawnA),
      new SpawnExecution(gameID, p2Info, spawnB),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Initial state
    expect(p1.hasBlocked(p2)).toBe(false);
    expect(p2.isBlockedBy(p1)).toBe(false);
    expect(p1.canSendAllianceRequest(p2)).toBe(true);

    // Block player
    p1.blockPlayer(p2);

    expect(p1.hasBlocked(p2)).toBe(true);
    expect(p2.isBlockedBy(p1)).toBe(true);
    expect(p1.canSendAllianceRequest(p2)).toBe(false);

    // Blocking is two-way for alliance requests check
    expect(p2.canSendAllianceRequest(p1)).toBe(false);

    // Unblock player
    p1.unblockPlayer(p2);
    expect(p1.hasBlocked(p2)).toBe(false);
    expect(p1.canSendAllianceRequest(p2)).toBe(true);
  });

  it("Should break alliance when blocking", async () => {
    const game = await setup("ocean_and_land", {});
    const gameID: GameID = "game_id";
    const p1Info = new PlayerInfo("p1", PlayerType.Human, null, "p1_id");
    const p2Info = new PlayerInfo("p2", PlayerType.Human, null, "p2_id");

    game.addPlayer(p1Info);
    game.addPlayer(p2Info);

    const p1 = game.player(p1Info.id);
    const p2 = game.player(p2Info.id);

    // Spawn both players
    const spawnA = game.ref(0, 10);
    const spawnB = game.ref(0, 15);

    game.addExecution(
      new SpawnExecution(gameID, p1Info, spawnA),
      new SpawnExecution(gameID, p2Info, spawnB),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Establish alliance
    const request = p1.createAllianceRequest(p2);
    expect(request).not.toBeNull();
    if (request) {
      request.accept();
    }

    expect(p1.isAlliedWith(p2)).toBe(true);
    expect(p2.isAlliedWith(p1)).toBe(true);

    // Block player
    p1.blockPlayer(p2);

    // Alliance should be broken
    expect(p1.isAlliedWith(p2)).toBe(false);
    expect(p2.isAlliedWith(p1)).toBe(false);

    // Should check if they can donate (requires friendliness/alliance)
    expect(p1.canDonateGold(p2)).toBe(false);
    expect(p1.canDonateTroops(p2)).toBe(false);
  });

  it("Should reject pending alliance requests when blocking", async () => {
    const game = await setup("ocean_and_land", {});
    const gameID: GameID = "game_id";
    const p1Info = new PlayerInfo("p1", PlayerType.Human, null, "p1_id");
    const p2Info = new PlayerInfo("p2", PlayerType.Human, null, "p2_id");

    game.addPlayer(p1Info);
    game.addPlayer(p2Info);

    const p1 = game.player(p1Info.id);
    const p2 = game.player(p2Info.id);

    // Spawn both players
    const spawnA = game.ref(0, 10);
    const spawnB = game.ref(0, 15);

    game.addExecution(
      new SpawnExecution(gameID, p1Info, spawnA),
      new SpawnExecution(gameID, p2Info, spawnB),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // P1 sends request to P2
    p1.createAllianceRequest(p2);
    expect(p2.incomingAllianceRequests().length).toBe(1);

    // P2 blocks P1
    p2.blockPlayer(p1);

    // Request should be gone/rejected
    expect(p2.incomingAllianceRequests().length).toBe(0);

    // Setup another request if possible (need to unblock first to reset state properly or just use new players/game)
    // Since cooldowns might apply, let's just check the other direction with unblocking

    p2.unblockPlayer(p1);

    // Now P2 sends request to P1
    // We need to advance ticks or clear cooldowns if any.
    // Default cooldown is usually some ticks.
    // Let's force clear cooldown or just wait.
    for (let i = 0; i < 100; i++) game.executeNextTick();

    p1.createAllianceRequest(p2);
    expect(p1.outgoingAllianceRequests().length).toBe(1);

    p1.blockPlayer(p2);
    expect(p1.outgoingAllianceRequests().length).toBe(0);

    p2.createAllianceRequest(p1);
    expect(p1.incomingAllianceRequests().length).toBe(1);

    p1.blockPlayer(p2);
    expect(p1.incomingAllianceRequests().length).toBe(0);
  });
});
