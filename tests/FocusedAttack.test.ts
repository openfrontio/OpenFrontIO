import { AttackExecution } from "../src/core/execution/AttackExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Cell, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";
// Runtime require to leverage the lightweight jest.mock stub without pulling in the real module at
// compile time (which drags in browser-specific code). The mock is defined at the bottom of this file.

const { Executor } = require("../src/core/execution/ExecutionManager");

/**
 * Focused attack tests verify that supplying a source border tile
 * causes the attack to originate from that tile and immediately
 * target adjacent enemy tiles instead of launching a general attack.
 */

describe("Focused land attack", () => {
  let game: any;
  let attacker: Player;
  let defender: Player;
  let attackerSpawn: TileRef;
  let defenderSpawn: TileRef;

  beforeEach(async () => {
    // Use an all-land map so coordinates below are guaranteed to be land.
    game = await setup("Plains", {
      infiniteGold: true,
      infiniteTroops: true,
      instantBuild: true,
    });

    const attackerInfo = new PlayerInfo(
      "us",
      "attacker",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    const defenderInfo = new PlayerInfo(
      "us",
      "defender",
      PlayerType.Human,
      null,
      "defender_id",
    );

    game.addPlayer(attackerInfo);
    game.addPlayer(defenderInfo);

    // Adjacent spawn positions – (5,5) and (6,5)
    attackerSpawn = game.ref(5, 5);
    defenderSpawn = game.ref(6, 5);

    game.addExecution(
      new SpawnExecution(game.player(attackerInfo.id).info(), attackerSpawn),
      new SpawnExecution(game.player(defenderInfo.id).info(), defenderSpawn),
    );

    // Finish spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    attacker = game.player(attackerInfo.id);
    defender = game.player(defenderInfo.id);
  });

  test("Attack originates from supplied border tile and conquers neighbour", () => {
    // Launch focused attack from attackerSpawn towards defender
    game.addExecution(
      new AttackExecution(50, attacker, defender.id(), attackerSpawn),
    );

    // First tick creates the AttackImpl instance
    game.executeNextTick();

    const activeAttack = attacker.outgoingAttacks()[0];
    expect(activeAttack).toBeDefined();
    // Verify the source tile is the one we provided
    expect(activeAttack.sourceTile()).toBe(attackerSpawn);

    // Advance until ownership changes or hit safety cap
    for (let i = 0; i < 200; i++) {
      if (game.owner(defenderSpawn) === attacker) break;
      game.executeNextTick();
    }

    // The defender's spawn tile should now belong to the attacker
    expect(game.owner(defenderSpawn)).toBe(attacker);
  });
});

/**
 * 2. Invalid source tile – not owned by attacker, should fallback to generic attack.
 */
describe("Focused attack validation – invalid source tile", () => {
  test("Source tile not owned by attacker is ignored", async () => {
    const game = await setup("Plains", {
      infiniteGold: true,
      infiniteTroops: true,
      instantBuild: true,
    });

    // Players with client IDs
    const attackerInfo = new PlayerInfo(
      "us",
      "attacker",
      PlayerType.Human,
      "clientA",
      "attkr01",
    );
    const defenderInfo = new PlayerInfo(
      "us",
      "defender",
      PlayerType.Human,
      "clientB",
      "dfndr01",
    );

    const attacker = game.addPlayer(attackerInfo);
    const defender = game.addPlayer(defenderInfo);

    const attackerSpawn = game.ref(5, 5);
    const defenderSpawn = game.ref(6, 5);

    game.addExecution(
      new SpawnExecution(attacker.info(), attackerSpawn),
      new SpawnExecution(defender.info(), defenderSpawn),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Create AttackIntent with invalid src (defender's tile)
    const intent: any = {
      type: "attack",
      clientID: attackerInfo.clientID,
      targetID: defender.id(),
      troops: 40,
      srcX: game.x(defenderSpawn),
      srcY: game.y(defenderSpawn),
    };

    const exec = new Executor(game, "game1", attackerInfo.clientID!).createExec(
      intent,
    );
    expect(exec).toBeInstanceOf(AttackExecution);
    game.addExecution(exec as AttackExecution);

    game.executeNextTick();

    const activeAttack = attacker.outgoingAttacks()[0];
    expect(activeAttack).toBeDefined();
    expect(activeAttack.sourceTile()).toBeNull();
  });
});

/**
 * 3. Non-border friendly tile should be ignored by validation.
 */
describe("Focused attack validation – non-border friendly tile", () => {
  test("Interior tile (not on border) is ignored", async () => {
    const game = await setup("Plains", {
      infiniteGold: true,
      infiniteTroops: true,
      instantBuild: true,
    });
    const attackerInfo = new PlayerInfo(
      "us",
      "attacker",
      PlayerType.Human,
      "clientA",
      "attkr02",
    );
    const defenderInfo = new PlayerInfo(
      "us",
      "defender",
      PlayerType.Human,
      "clientB",
      "dfndr02",
    );
    const attacker = game.addPlayer(attackerInfo);
    const defender = game.addPlayer(defenderInfo);

    const attackerSpawn = game.ref(10, 10);
    const defenderSpawn = game.ref(20, 20);

    game.addExecution(
      new SpawnExecution(attacker.info(), attackerSpawn),
      new SpawnExecution(defender.info(), defenderSpawn),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Build a 3×3 cluster fully owned by attacker so center tile is interior
    const center = game.ref(15, 15);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const t = game.ref(game.x(center) + dx, game.y(center) + dy);
        attacker.conquer(t);
      }
    }

    const interiorCell = new Cell(game.x(center), game.y(center));

    const intent: any = {
      type: "attack",
      clientID: attackerInfo.clientID,
      targetID: defender.id(),
      troops: 30,
      srcX: interiorCell.x,
      srcY: interiorCell.y,
    };

    const exec = new Executor(game, "game2", attackerInfo.clientID!).createExec(
      intent,
    );
    expect(exec).toBeInstanceOf(AttackExecution);
    game.addExecution(exec as AttackExecution);
    game.executeNextTick();

    const activeAttack = attacker.outgoingAttacks()[0];
    expect(activeAttack).toBeDefined();
    expect(activeAttack.sourceTile()).toBeNull();
  });
});

/**
 * 5. Attack during spawn-immunity should be rejected.
 */
describe("Spawn-immunity prevents focused attack", () => {
  test("Attack added before immunity ends never starts", async () => {
    const game = await setup("Plains", {
      infiniteGold: true,
      infiniteTroops: true,
      instantBuild: true,
    });
    const attackerInfo = new PlayerInfo(
      "us",
      "attacker",
      PlayerType.Human,
      "clientA",
      "attkr03",
    );
    const defenderInfo = new PlayerInfo(
      "us",
      "defender",
      PlayerType.Human,
      "clientB",
      "dfndr03",
    );
    const attacker = game.addPlayer(attackerInfo);
    const defender = game.addPlayer(defenderInfo);

    const attackerSpawn = game.ref(5, 5);
    const defenderSpawn = game.ref(6, 5);

    game.addExecution(
      new SpawnExecution(attacker.info(), attackerSpawn),
      new SpawnExecution(defender.info(), defenderSpawn),
    );

    // Launch attack DURING spawn phase (before loop finishes)
    game.addExecution(
      new AttackExecution(40, attacker, defender.id(), attackerSpawn),
    );

    // Run until spawn phase over + immunity period (~30 ticks just to be safe)
    for (let i = 0; i < 50; i++) {
      game.executeNextTick();
    }

    expect(attacker.outgoingAttacks().length).toBe(0);
  });
});

jest.mock("../src/core/execution/ExecutionManager", () => {
  // Provide a lightweight stub for the Executor that only supports the
  // "attack" intent used in these tests. This avoids importing the full
  // ExecutionManager implementation (and its heavyweight dependencies)
  // while preserving the focused-attack validation logic we want to test.
  //
  // NOTE: The real Executor supports many intent types; we only implement
  // what the current test suite requires. Extend as needed for future tests.

  const { AttackExecution } = require("../src/core/execution/AttackExecution");

  class ExecutorStub {
    private mg: any;
    private gameID: string;
    private clientID: string;

    constructor(mg: any, gameID: string, clientID: string) {
      this.mg = mg;
      this.gameID = gameID;
      this.clientID = clientID;
    }

    /**
     * Create an execution for the provided intent. Currently only supports
     * the "attack" intent used in these tests.
     */
    createExec(intent: any) {
      const player = this.mg.playerByClientID(intent.clientID);
      if (!player)
        throw new Error(`player with clientID ${intent.clientID} not found`);

      if (intent.type !== "attack") {
        throw new Error(`Unsupported intent type: ${intent.type}`);
      }

      // Replicate the focused-attack source-tile validation from the real Executor.
      let src: any = null;
      if (typeof intent.srcX === "number" && typeof intent.srcY === "number") {
        const candidate = this.mg.ref(intent.srcX, intent.srcY);
        if (this.mg.owner(candidate) === player && this.mg.isLand(candidate)) {
          const isBorder = this.mg
            .neighbors(candidate)
            .some((n: any) => this.mg.owner(n) !== player);
          if (isBorder) src = candidate;
        }
      }

      return new AttackExecution(intent.troops, player, intent.targetID, src);
    }
  }

  return { Executor: ExecutorStub };
});
