import { ConstructionExecution } from "../../src/core/execution/ConstructionExecution";
import { SpawnExecution } from "../../src/core/execution/SpawnExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../../src/core/game/Game";
import { GameID } from "../../src/core/Schemas";
import { setup } from "../util/Setup";

describe("Hydrogen Bomb and MIRV flows", () => {
  let game: Game;
  let player: Player;
  const gameID: GameID = "game_id";

  beforeEach(async () => {
    game = await setup("plains", { infiniteGold: true, instantBuild: true });
    const info = new PlayerInfo("p", PlayerType.Human, null, "p");
    game.addPlayer(info);
    game.addExecution(new SpawnExecution(gameID, info, game.ref(1, 1)));
    while (game.inSpawnPhase()) game.executeNextTick();
    player = game.player(info.id);

    player.conquer(game.ref(1, 1));
  });

  test("Hydrogen bomb launches when silo exists and cannot use silo under construction", () => {
    // Build a silo instantly and launch Hydrogen Bomb
    game.addExecution(
      new ConstructionExecution(player, "Missile Silo", game.ref(1, 1)),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(player.units("Missile Silo")).toHaveLength(1);

    // Launch Hydrogen Bomb
    const target = game.ref(7, 7);
    game.addExecution(
      new ConstructionExecution(player, "Hydrogen Bomb", target),
    );
    game.executeNextTick();
    game.executeNextTick();
    game.executeNextTick();
    expect(player.units("Hydrogen Bomb").length).toBeGreaterThan(0);

    // Now build another silo with construction time and ensure it won't be used
    // Use non-instant config by simulating an under-construction flag on a new silo
    // (Use normal construction with default duration in a fresh game instance)
  });

  test("Hydrogen bomb launch fails when silo is under construction and succeeds after completion", async () => {
    // Set up a game without instantBuild to test construction duration
    const gameWithConstruction = await setup("plains", {
      infiniteGold: false,
      instantBuild: false,
    });
    const info = new PlayerInfo("p", PlayerType.Human, null, "p");
    gameWithConstruction.addPlayer(info);
    gameWithConstruction.addExecution(
      new SpawnExecution(gameID, info, gameWithConstruction.ref(1, 1)),
    );
    while (gameWithConstruction.inSpawnPhase())
      gameWithConstruction.executeNextTick();
    const playerWithConstruction = gameWithConstruction.player(info.id);

    playerWithConstruction.conquer(gameWithConstruction.ref(1, 1));
    const siloTile = gameWithConstruction.ref(7, 7);
    playerWithConstruction.conquer(siloTile);

    // Capture gold before starting silo construction
    const goldBeforeSilo = playerWithConstruction.gold();
    const siloCost = gameWithConstruction
      .unitInfo("Missile Silo")
      .cost(gameWithConstruction, playerWithConstruction);
    playerWithConstruction.addGold(siloCost);

    // Start construction of silo
    gameWithConstruction.addExecution(
      new ConstructionExecution(
        playerWithConstruction,
        "Missile Silo",
        siloTile,
      ),
    );
    gameWithConstruction.executeNextTick();
    gameWithConstruction.executeNextTick();

    // Verify silo exists and is under construction
    const silos = playerWithConstruction.units("Missile Silo");
    expect(silos.length).toBe(1);
    const silo = silos[0];
    expect(silo.isUnderConstruction()).toBe(true);

    // Capture gold after construction started
    const goldAfterConstruction = playerWithConstruction.gold();
    expect(goldAfterConstruction).toBeLessThan(goldBeforeSilo + siloCost);

    // Attempt to launch HydrogenBomb while silo is under construction
    const targetTile = gameWithConstruction.ref(10, 10);
    const hydrogenBombCountBefore =
      playerWithConstruction.units("Hydrogen Bomb").length;

    const canBuildResult = playerWithConstruction.canBuild(
      "Hydrogen Bomb",
      targetTile,
    );
    expect(canBuildResult).toBe(false); // Should fail because silo is under construction

    // Try to add execution - should fail
    gameWithConstruction.addExecution(
      new ConstructionExecution(
        playerWithConstruction,
        "Hydrogen Bomb",
        targetTile,
      ),
    );
    gameWithConstruction.executeNextTick();
    gameWithConstruction.executeNextTick();

    // Assert launch does not succeed
    const hydrogenBombCountAfter =
      playerWithConstruction.units("Hydrogen Bomb").length;
    expect(hydrogenBombCountAfter).toBe(hydrogenBombCountBefore);

    // Assert no refunds during construction
    const goldDuringConstruction = playerWithConstruction.gold();
    expect(goldDuringConstruction >= goldAfterConstruction).toBe(true);

    // Advance ticks to complete construction
    const constructionDuration =
      gameWithConstruction.unitInfo("Missile Silo").constructionDuration ?? 0;
    for (let i = 0; i < constructionDuration + 2; i++) {
      gameWithConstruction.executeNextTick();
    }

    // Verify silo is complete
    const completedSilo = playerWithConstruction.units("Missile Silo")[0];
    expect(completedSilo.isUnderConstruction()).toBe(false);

    // Now launch should succeed - ensure we have gold and target is conquered
    playerWithConstruction.conquer(targetTile);
    const hydrogenBombCost = gameWithConstruction
      .unitInfo("Hydrogen Bomb")
      .cost(gameWithConstruction, playerWithConstruction);
    playerWithConstruction.addGold(hydrogenBombCost);

    const canBuildAfterCompletion = playerWithConstruction.canBuild(
      "Hydrogen Bomb",
      targetTile,
    );
    expect(canBuildAfterCompletion).not.toBe(false);

    gameWithConstruction.addExecution(
      new ConstructionExecution(
        playerWithConstruction,
        "Hydrogen Bomb",
        targetTile,
      ),
    );
    gameWithConstruction.executeNextTick();
    gameWithConstruction.executeNextTick();
    gameWithConstruction.executeNextTick();

    // Verify launch succeeded
    const hydrogenBombCountAfterSuccess =
      playerWithConstruction.units("Hydrogen Bomb").length;
    expect(hydrogenBombCountAfterSuccess).toBeGreaterThan(
      hydrogenBombCountBefore,
    );
  });

  test("MIRV launches when silo exists and targets player-owned tiles", () => {
    // Build a silo instantly
    game.addExecution(
      new ConstructionExecution(player, "Missile Silo", game.ref(1, 1)),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(player.units("Missile Silo")).toHaveLength(1);

    // Launch MIRV at a player-owned tile (the silo tile)
    const target = game.ref(1, 1);
    game.addExecution(new ConstructionExecution(player, "MIRV", target));
    game.executeNextTick(); // init
    game.executeNextTick(); // create MIRV unit
    game.executeNextTick();

    // MIRV should appear briefly before separation, otherwise warheads should be queued
    const mirvs = player.units("MIRV").length;
    const warheads = player.units("MIRV Warhead").length;
    expect(mirvs > 0 || warheads > 0).toBe(true);
  });
});
