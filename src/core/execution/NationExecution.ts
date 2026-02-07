import {
  Difficulty,
  Execution,
  Game,
  Nation,
  Player,
  PlayerID,
  Relation,
  TerrainType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { assertNever, simpleHash } from "../Util";
import { NationAllianceBehavior } from "./nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "./nation/NationEmojiBehavior";
import { NationMIRVBehavior } from "./nation/NationMIRVBehavior";
import { NationNukeBehavior } from "./nation/NationNukeBehavior";
import { NationStructureBehavior } from "./nation/NationStructureBehavior";
import { NationWarshipBehavior } from "./nation/NationWarshipBehavior";
import { SpawnExecution } from "./SpawnExecution";
import { AiAttackBehavior } from "./utils/AiAttackBehavior";

export class NationExecution implements Execution {
  private active = true;
  private random: PseudoRandom;
  private behaviorsInitialized = false;
  private emojiBehavior!: NationEmojiBehavior;
  private mirvBehavior!: NationMIRVBehavior;
  private attackBehavior!: AiAttackBehavior;
  private allianceBehavior!: NationAllianceBehavior;
  private warshipBehavior!: NationWarshipBehavior;
  private nukeBehavior!: NationNukeBehavior;
  private structureBehavior!: NationStructureBehavior;
  private mg: Game;
  private player: Player | null = null;

  private attackRate: number;
  private attackTick: number;
  private triggerRatio: number;
  private reserveRatio: number;
  private expandRatio: number;

  private readonly embargoMalusApplied = new Set<PlayerID>();

  constructor(
    private gameID: GameID,
    private nation: Nation, // Nation contains PlayerInfo with PlayerType.Nation
  ) {
    this.random = new PseudoRandom(
      simpleHash(nation.playerInfo.id) + simpleHash(gameID),
    );
    this.triggerRatio = this.random.nextInt(50, 60) / 100;
    this.reserveRatio = this.random.nextInt(30, 40) / 100;
    this.expandRatio = this.random.nextInt(10, 20) / 100;
  }

  init(mg: Game) {
    this.mg = mg;
    this.attackRate = this.getAttackRate();
    this.attackTick = this.random.nextInt(0, this.attackRate);

    if (!this.mg.hasPlayer(this.nation.playerInfo.id)) {
      this.player = this.mg.addPlayer(this.nation.playerInfo);
    } else {
      this.player = this.mg.player(this.nation.playerInfo.id);
    }
  }

  private getAttackRate(): number {
    const { difficulty } = this.mg.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return this.random.nextInt(65, 80); // Slower reactions
      case Difficulty.Medium:
        return this.random.nextInt(55, 70);
      case Difficulty.Hard:
        return this.random.nextInt(45, 60);
      case Difficulty.Impossible:
        return this.random.nextInt(30, 50); // Faster reactions
      default:
        assertNever(difficulty);
    }
  }

  tick(ticks: number) {
    // Ship tracking
    if (
      this.behaviorsInitialized &&
      this.player !== null &&
      this.player.isAlive() &&
      this.mg.config().gameConfig().difficulty !== Difficulty.Easy
    ) {
      this.warshipBehavior.trackShipsAndRetaliate();
    }

    if (ticks % this.attackRate !== this.attackTick) {
      // Call handleStructures twice between regular attack ticks (at 1/3 and 2/3 of the interval)
      // Otherwise it is possible that we earn more gold than we can spend
      // The alternative is placing multiple structures in handleStructures, but that causes problems
      if (
        this.behaviorsInitialized &&
        this.player !== null &&
        this.player.isAlive()
      ) {
        const offset = ticks % this.attackRate;
        const oneThird =
          (this.attackTick + Math.floor(this.attackRate / 3)) % this.attackRate;
        const twoThirds =
          (this.attackTick + Math.floor((this.attackRate * 2) / 3)) %
          this.attackRate;
        if (offset === oneThird || offset === twoThirds) {
          this.structureBehavior.handleStructures();
        }
      }
      return;
    }

    if (this.player === null) {
      return;
    }

    if (this.mg.inSpawnPhase()) {
      // Place nations without a spawn cell (Dynamically created for HumansVsNations) randomly by SpawnExecution
      if (this.nation.spawnCell === undefined) {
        this.mg.addExecution(
          new SpawnExecution(this.gameID, this.nation.playerInfo),
        );
        return;
      }

      // Select a tile near the position defined in the map manifest
      const rl = this.randomSpawnLand();

      if (rl === null) {
        console.warn(`cannot spawn ${this.nation.playerInfo.name}`);
        return;
      }

      this.mg.addExecution(
        new SpawnExecution(this.gameID, this.nation.playerInfo, rl),
      );
      return;
    }

    if (!this.player.isAlive()) {
      this.active = false;
      return;
    }

    if (!this.behaviorsInitialized) {
      this.initializeBehaviors();
      this.attackBehavior.forceSendAttack(this.mg.terraNullius());
      return;
    }

    this.emojiBehavior.maybeSendCasualEmoji();
    this.updateRelationsFromEmbargos();
    this.allianceBehavior.handleAllianceRequests();
    this.allianceBehavior.handleAllianceExtensionRequests();
    this.mirvBehavior.considerMIRV();
    this.structureBehavior.handleStructures();
    this.warshipBehavior.maybeSpawnWarship();
    this.handleEmbargoesToHostileNations();
    this.attackBehavior.maybeAttack();
    this.warshipBehavior.counterWarshipInfestation();
    this.nukeBehavior.maybeSendNuke();
  }

  private initializeBehaviors(): void {
    if (this.player === null) throw new Error("Player not initialized");

    this.emojiBehavior = new NationEmojiBehavior(
      this.random,
      this.mg,
      this.player,
    );
    this.mirvBehavior = new NationMIRVBehavior(
      this.random,
      this.mg,
      this.player,
      this.emojiBehavior,
    );
    this.allianceBehavior = new NationAllianceBehavior(
      this.random,
      this.mg,
      this.player,
      this.emojiBehavior,
    );
    this.warshipBehavior = new NationWarshipBehavior(
      this.random,
      this.mg,
      this.player,
      this.emojiBehavior,
    );
    this.attackBehavior = new AiAttackBehavior(
      this.random,
      this.mg,
      this.player,
      this.triggerRatio,
      this.reserveRatio,
      this.expandRatio,
      this.allianceBehavior,
      this.emojiBehavior,
    );
    this.nukeBehavior = new NationNukeBehavior(
      this.random,
      this.mg,
      this.player,
      this.attackBehavior,
      this.emojiBehavior,
    );
    this.structureBehavior = new NationStructureBehavior(
      this.random,
      this.mg,
      this.player,
    );
    this.behaviorsInitialized = true;
  }

  private randomSpawnLand(): TileRef | null {
    if (this.nation.spawnCell === undefined) throw new Error("not initialized");

    const delta = 25;
    let tries = 0;
    while (tries < 50) {
      tries++;
      const cell = this.nation.spawnCell;
      const x = this.random.nextInt(cell.x - delta, cell.x + delta);
      const y = this.random.nextInt(cell.y - delta, cell.y + delta);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (this.mg.isLand(tile) && !this.mg.hasOwner(tile)) {
        if (
          this.mg.terrainType(tile) === TerrainType.Mountain &&
          this.random.chance(2)
        ) {
          continue;
        }
        return tile;
      }
    }
    return null;
  }

  private updateRelationsFromEmbargos() {
    const player = this.player;
    if (player === null) return;
    const others = this.mg.players().filter((p) => p.id() !== player.id());

    others.forEach((other: Player) => {
      const embargoMalus = -20;
      if (
        other.hasEmbargoAgainst(player) &&
        !this.embargoMalusApplied.has(other.id())
      ) {
        player.updateRelation(other, embargoMalus);
        this.embargoMalusApplied.add(other.id());
      } else if (
        !other.hasEmbargoAgainst(player) &&
        this.embargoMalusApplied.has(other.id())
      ) {
        player.updateRelation(other, -embargoMalus);
        this.embargoMalusApplied.delete(other.id());
      }
    });
  }

  private handleEmbargoesToHostileNations() {
    const player = this.player;
    if (player === null) return;
    const others = this.mg.players().filter((p) => p.id() !== player.id());

    others.forEach((other: Player) => {
      /* When player is hostile starts embargo. Do not stop until neutral again */
      if (
        player.relation(other) <= Relation.Hostile &&
        !player.hasEmbargoAgainst(other) &&
        !player.isOnSameTeam(other)
      ) {
        player.addEmbargo(other, false);
      } else if (
        player.relation(other) >= Relation.Neutral &&
        player.hasEmbargoAgainst(other) &&
        this.mg.config().gameConfig().difficulty !== Difficulty.Hard &&
        this.mg.config().gameConfig().difficulty !== Difficulty.Impossible
      ) {
        player.stopEmbargo(other);
      } else if (
        player.relation(other) >= Relation.Friendly &&
        player.hasEmbargoAgainst(other) &&
        this.mg.config().gameConfig().difficulty !== Difficulty.Impossible
      ) {
        player.stopEmbargo(other);
      }
    });
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
