import {
  Difficulty,
  Execution,
  Game,
  GameMode,
  Gold,
  Nation,
  Player,
  PlayerID,
  Relation,
  TerrainType,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { assertNever, simpleHash } from "../Util";
import { ConstructionExecution } from "./ConstructionExecution";
import { NationAllianceBehavior } from "./nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "./nation/NationEmojiBehavior";
import { NationMIRVBehavior } from "./nation/NationMIRVBehavior";
import { NationNukeBehavior } from "./nation/NationNukeBehavior";
import { randTerritoryTileArray } from "./nation/NationUtils";
import { NationWarshipBehavior } from "./nation/NationWarshipBehavior";
import { structureSpawnTileValue } from "./nation/structureSpawnTileValue";
import { SpawnExecution } from "./SpawnExecution";
import { AiAttackBehavior } from "./utils/AiAttackBehavior";

export class NationExecution implements Execution {
  private active = true;
  private random: PseudoRandom;
  private emojiBehavior: NationEmojiBehavior | null = null;
  private mirvBehavior: NationMIRVBehavior | null = null;
  private attackBehavior: AiAttackBehavior | null = null;
  private allianceBehavior: NationAllianceBehavior | null = null;
  private warshipBehavior: NationWarshipBehavior | null = null;
  private nukeBehavior: NationNukeBehavior | null = null;
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
      this.warshipBehavior !== null &&
      this.player !== null &&
      this.player.isAlive() &&
      this.mg.config().gameConfig().difficulty !== Difficulty.Easy
    ) {
      this.warshipBehavior.trackShipsAndRetaliate();
    }

    if (ticks % this.attackRate !== this.attackTick) {
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

    if (
      this.emojiBehavior === null ||
      this.mirvBehavior === null ||
      this.attackBehavior === null ||
      this.allianceBehavior === null ||
      this.warshipBehavior === null ||
      this.nukeBehavior === null
    ) {
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

      // Send an attack on the first tick
      this.attackBehavior.forceSendAttack(this.mg.terraNullius());
      return;
    }

    this.emojiBehavior.maybeSendCasualEmoji();
    this.updateRelationsFromEmbargos();
    this.allianceBehavior.handleAllianceRequests();
    this.allianceBehavior.handleAllianceExtensionRequests();
    this.mirvBehavior.considerMIRV();
    this.handleUnits();
    this.handleEmbargoesToHostileNations();
    this.attackBehavior.maybeAttack();
    this.warshipBehavior.counterWarshipInfestation();
    this.nukeBehavior.maybeSendNuke();
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

  private handleUnits() {
    if (this.warshipBehavior === null) throw new Error("not initialized");
    const hasCoastalTiles = this.hasCoastalTiles();
    const isTeamGame = this.mg.config().gameConfig().gameMode === GameMode.Team;
    return (
      this.maybeSpawnStructure(UnitType.City, (num) => num) ||
      this.maybeSpawnStructure(UnitType.Port, (num) => num) ||
      this.warshipBehavior.maybeSpawnWarship() ||
      this.maybeSpawnStructure(UnitType.Factory, (num) =>
        hasCoastalTiles ? num * 3 : num,
      ) ||
      this.maybeSpawnStructure(UnitType.DefensePost, (num) => (num + 2) ** 2) ||
      this.maybeSpawnStructure(UnitType.SAMLauncher, (num) =>
        isTeamGame ? num : num ** 2,
      ) ||
      this.maybeSpawnStructure(UnitType.MissileSilo, (num) => num ** 2)
    );
  }

  private hasCoastalTiles(): boolean {
    if (this.player === null) throw new Error("not initialized");
    for (const tile of this.player.borderTiles()) {
      if (this.mg.isOceanShore(tile)) return true;
    }
    return false;
  }

  private maybeSpawnStructure(
    type: UnitType,
    multiplier: (num: number) => number,
  ) {
    if (this.player === null) throw new Error("not initialized");
    const owned = this.player.unitsOwned(type);
    const perceivedCostMultiplier = multiplier(owned + 1);
    const realCost = this.cost(type);
    const perceivedCost = realCost * BigInt(perceivedCostMultiplier);
    if (this.player.gold() < perceivedCost) {
      return false;
    }
    const tile = this.structureSpawnTile(type);
    if (tile === null) {
      return false;
    }
    const canBuild = this.player.canBuild(type, tile);
    if (canBuild === false) {
      return false;
    }
    this.mg.addExecution(new ConstructionExecution(this.player, type, tile));
    return true;
  }

  private structureSpawnTile(type: UnitType): TileRef | null {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (this.player === null) throw new Error("Not initialized");
    const tiles =
      type === UnitType.Port
        ? this.randCoastalTileArray(25)
        : randTerritoryTileArray(this.random, this.mg, this.player, 25);
    if (tiles.length === 0) return null;
    const valueFunction = structureSpawnTileValue(this.mg, this.player, type);
    if (valueFunction === null) return null;
    let bestTile: TileRef | null = null;
    let bestValue = 0;
    for (const t of tiles) {
      const v = valueFunction(t);
      if (v <= bestValue && bestTile !== null) continue;
      if (!this.player.canBuild(type, t)) continue;
      // Found a better tile
      bestTile = t;
      bestValue = v;
    }
    return bestTile;
  }

  private randCoastalTileArray(numTiles: number): TileRef[] {
    const tiles = Array.from(this.player!.borderTiles()).filter((t) =>
      this.mg.isOceanShore(t),
    );
    return Array.from(this.arraySampler(tiles, numTiles));
  }

  private *arraySampler<T>(a: T[], sampleSize: number): Generator<T> {
    if (a.length <= sampleSize) {
      // Return all elements
      yield* a;
    } else {
      // Sample `sampleSize` elements
      const remaining = new Set<T>(a);
      while (sampleSize--) {
        const t = this.random.randFromSet(remaining);
        remaining.delete(t);
        yield t;
      }
    }
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
        this.mg.config().gameConfig().difficulty !== Difficulty.Impossible
      ) {
        player.stopEmbargo(other);
      }
    });
  }

  private cost(type: UnitType): Gold {
    if (this.player === null) throw new Error("not initialized");
    return this.mg.unitInfo(type).cost(this.mg, this.player);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
