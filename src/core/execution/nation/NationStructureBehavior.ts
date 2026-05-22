import {
  Attack,
  Difficulty,
  Game,
  GameMode,
  Gold,
  Player,
  PlayerType,
  Structures,
  Unit,
  UnitType,
} from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { Cluster } from "../../game/TrainStation";
import { PseudoRandom } from "../../PseudoRandom";
import { assertNever } from "../../Util";
import { ConstructionExecution } from "../ConstructionExecution";
import { UpgradeStructureExecution } from "../UpgradeStructureExecution";
import { closestTile, closestTwoTiles } from "../Util";
import { randTerritoryTileArray } from "./NationUtils";

/**
 * Configuration for how many structures of each type a nation should build
 * relative to the number of cities it owns.
 */
interface StructureRatioConfig {
  /** How many of this structure per city (e.g., 0.75 means 3 ports for every 4 cities) */
  ratioPerCity: number;
  /** Perceived cost increase percentage per owned structure (e.g., 0.1 = 10% more expensive per owned) */
  perceivedCostIncreasePerOwned: number;
}

/** SAM launcher ratio per city, keyed by difficulty */
const SAM_RATIO_BY_DIFFICULTY: Record<Difficulty, number> = {
  [Difficulty.Easy]: 0.15,
  [Difficulty.Medium]: 0.2,
  [Difficulty.Hard]: 0.25,
  [Difficulty.Impossible]: 0.3,
};

/**
 * Returns structure ratios relative to city count, adjusted by difficulty.
 * Cities are always prioritized and built first.
 * When cities are disabled, we use TILES_PER_CITY_EQUIVALENT. That's not ideal, nations won't properly upgrade structures, but it's better than nothing. Probably 99.9% of players won't disable cities anyway.
 */
function getStructureRatios(
  difficulty: Difficulty,
): Partial<Record<UnitType, StructureRatioConfig>> {
  return {
    [UnitType.Port]: { ratioPerCity: 0.75, perceivedCostIncreasePerOwned: 1 },
    [UnitType.Factory]: {
      ratioPerCity: 0.75,
      perceivedCostIncreasePerOwned: 1,
    },
    [UnitType.SAMLauncher]: {
      ratioPerCity: SAM_RATIO_BY_DIFFICULTY[difficulty],
      perceivedCostIncreasePerOwned: 0.3,
    },
    [UnitType.MissileSilo]: {
      ratioPerCity: 0.2,
      perceivedCostIncreasePerOwned: 1,
    },
  };
}

/** Perceived cost increase percentage per city owned */
const CITY_PERCEIVED_COST_INCREASE_PER_OWNED = 1;

/** Factory ratio multiplier when the nation has coastal tiles */
const FACTORY_COASTAL_RATIO_MULTIPLIER = 0.33;

/** Maximum number of missile silos a nation will build */
const MAX_MISSILE_SILOS = 3;

/** Ratio per city used for the first missile silo so nations start nuking earlier */
const FIRST_MISSILE_SILO_RATIO = 0.4;

/** If we have more than this many structures per tiles, prefer upgrading over building */
const UPGRADE_DENSITY_THRESHOLD = 1 / 1500;

/** Estimated number of tiles per city equivalent, used when cities are disabled */
const TILES_PER_CITY_EQUIVALENT = 2000;

/**
 * When map-wide nation density (nations per land tile) is above this threshold,
 * a nation's very first structure is a port (or factory if no water access)
 */
const HIGH_NATION_DENSITY_THRESHOLD = 1 / 7500;

/**
 * Starting-gold threshold above which nations enter the
 * "high-gold" early game: they build a SAM first and wait between structure
 * placements. Without this, high-starting-gold games let a nation
 * drop many structures within a short timespan, which ballooned its maxTroops
 * before troop count caught up (delaying its attacks) and clustered the
 * new structures inside a single nuke blast radius.
 */
const HIGH_STARTING_GOLD_THRESHOLD = 3_000_000n;

/** Tick gap a high-starting-gold nation must wait before placing its Nth structure */
const HIGH_GOLD_STRUCTURE_COOLDOWN_TICKS: readonly number[] = [
  0, // before #1 (SAM) — no pause
  0, // before #2 — no pause
  250, // before #3 — 25s
  150, // before #4 — 15s
  100, // before #5 — 10s
];

/** Length in ticks of each on/off phase after the team-mode save-up target is first reached */
const TEAM_POST_SAVE_UP_PHASE_TICKS = 150; // 15s

/**
 * Incoming land-attack troop count as a fraction of own troops below which
 * the nation does not build defensive structures.
 */
const UNDER_ATTACK_THREAT_RATIO = 0.35;

/**
 * Hard / Impossible: one additional defense post is allowed per this fraction
 * of the incoming-to-own-troop ratio (e.g. 0.4 → 1 post at 0–40%, 2 at
 * 40–80%, 3 at 80–120%, …).
 */
const DEFENSE_POST_RATIO_PER_POST = 0.4;

export class NationStructureBehavior {
  private reachableStationsCache: Array<{
    tile: TileRef;
    cluster: Cluster | null;
    weight: number;
  }> | null = null;
  private _sharedWaterComponents: Set<number> | null = null;
  private lastStructureTick: number | null = null;
  private placementsCount = 0;
  private _hasHighStartingGold: boolean | null = null;
  private _postSaveUpStartTick: number | null = null;

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
  ) {}

  handleStructures(): boolean {
    // Defense posts are handled outside the normal pacing/counter system:
    // they don't increment placementsCount or lastStructureTick, and they
    // are never built as the very first structure.
    if (
      this.placementsCount > 0 &&
      !this.game.config().isUnitDisabled(UnitType.DefensePost)
    ) {
      if (this.tryBuildDefensePost()) {
        return true;
      }
      // If the attack threshold is met, block other structures even when
      // placement failed (no tile found / can't afford).
      if (this.defensePostNeeded()) {
        return false;
      }
    }

    if (this.isOnStructureCooldown()) {
      return false;
    }
    if (this.isInPostSaveUpBlockedPhase()) {
      return false;
    }
    const built = this.doHandleStructures();
    if (built) {
      this.lastStructureTick = this.game.ticks();
      this.placementsCount++;
    }
    return built;
  }

  /**
   * Tries to place one defense post near an active land-attack front.
   * Not called on Easy. Medium: 50% chance per call, 1 post total. Hard/Impossible:
   * ceil(ratio / 0.4) posts total. Boat attacks (sourceTile != null) are ignored.
   * Does not touch placementsCount or lastStructureTick.
   */
  private tryBuildDefensePost(): boolean {
    const { difficulty } = this.game.config().gameConfig();
    if (difficulty === Difficulty.Easy) return false;
    if (difficulty === Difficulty.Medium && !this.random.chance(2))
      return false;

    const player = this.player;
    const landAttacks = player
      .incomingAttacks()
      .filter((a) => a.sourceTile() === null);
    if (landAttacks.length === 0) return false;

    const ourTroops = player.troops();
    if (ourTroops <= 0) return false;

    const incomingTroops = landAttacks.reduce((sum, a) => sum + a.troops(), 0);
    const ratio = incomingTroops / ourTroops;
    if (ratio < UNDER_ATTACK_THREAT_RATIO) return false;

    let allowed: number;
    if (difficulty === Difficulty.Medium) {
      allowed = 1;
    } else {
      allowed = Math.ceil(ratio / DEFENSE_POST_RATIO_PER_POST);
    }

    const frontTiles = this.getAttackFrontTiles(landAttacks);
    if (this.countDefensePostsNearFront(frontTiles, allowed) >= allowed)
      return false;

    const cost = this.cost(UnitType.DefensePost);
    if (player.gold() < cost) return false;

    const tiles = this.sampleTilesNearFront(
      frontTiles,
      25,
      UnitType.DefensePost,
    );
    for (const tile of tiles) {
      if (!player.canBuild(UnitType.DefensePost, tile)) continue;
      this.game.addExecution(
        new ConstructionExecution(player, UnitType.DefensePost, tile),
      );
      return true;
    }
    return false;
  }

  private defensePostNeeded(): boolean {
    const { difficulty } = this.game.config().gameConfig();
    if (difficulty === Difficulty.Easy) return false;
    const landAttacks = this.player
      .incomingAttacks()
      .filter((a) => a.sourceTile() === null);
    if (landAttacks.length === 0) return false;
    const ourTroops = this.player.troops();
    if (ourTroops <= 0) return false;
    const incomingTroops = landAttacks.reduce((sum, a) => sum + a.troops(), 0);
    return incomingTroops / ourTroops >= UNDER_ATTACK_THREAT_RATIO;
  }

  /**
   * Returns our border tiles that are adjacent to a tile owned by any of the
   * attacking players.
   */
  private getAttackFrontTiles(landAttacks: Attack[]): TileRef[] {
    const game = this.game;
    const player = this.player;
    const attackerSet = new Set(landAttacks.map((a) => a.attacker()));
    if (attackerSet.size === 0) return [];

    const frontTiles: TileRef[] = [];
    outer: for (const borderTile of player.borderTiles()) {
      for (const neighbor of game.neighbors(borderTile)) {
        const owner = game.owner(neighbor);
        if (attackerSet.has(owner as Player)) {
          frontTiles.push(borderTile);
          continue outer;
        }
      }
    }
    return frontTiles;
  }

  /**
   * Counts defense posts within 1.5 × borderSpacing of any front tile.
   * `cap` short-circuits the scan once that many are found.
   */
  private countDefensePostsNearFront(
    frontTiles: TileRef[],
    cap?: number,
  ): number {
    if (frontTiles.length === 0) return 0;

    const game = this.game;
    const { borderSpacing } = this.spacingConstants();
    const rangeSquared = (borderSpacing * 1.5) ** 2;

    let count = 0;
    for (const dp of this.player.units(UnitType.DefensePost)) {
      for (const frontTile of frontTiles) {
        if (game.euclideanDistSquared(dp.tile(), frontTile) <= rangeSquared) {
          count++;
          if (cap !== undefined && count >= cap) return count;
          break;
        }
      }
    }
    return count;
  }

  /**
   * Samples territory tiles for defense-post placement, using the full attack
   * front as anchors. Only tiles where canBuild passes are collected.
   * Anchors near existing defense posts are filtered out first so successive
   * posts spread along the front rather than clustering together.
   *
   * Phase 1: tiles at depth [0.75×, 1.5×] borderSpacing from any border.
   * Fallback 1: relax depth constraint (territory smaller than borderSpacing).
   * Fallback 2: pure random territory sampling (canBuild checked by caller).
   */
  private sampleTilesNearFront(
    frontTiles: TileRef[],
    count: number,
    unitType: UnitType,
  ): TileRef[] {
    const game = this.game;
    const player = this.player;

    if (frontTiles.length === 0) {
      return [];
    }

    const { borderSpacing } = this.spacingConstants();
    const searchRadius = Math.ceil(borderSpacing * 1.5);
    const minBorderDist = Math.ceil(borderSpacing * 0.75);
    const maxBorderDist = Math.ceil(borderSpacing * 1.5);
    const borderTiles = player.borderTiles();

    // Spread: prefer front tiles far from existing defense posts so successive
    // posts don't cluster at the same spot along the attack line.
    const spreadRangeSquared = (borderSpacing * 1.5) ** 2;
    const existingDPTiles = player
      .units(UnitType.DefensePost)
      .map((u) => u.tile());

    let anchors: TileRef[];
    if (existingDPTiles.length > 0) {
      anchors = frontTiles.filter(
        (ft) =>
          !existingDPTiles.some(
            (dp) => game.euclideanDistSquared(ft, dp) < spreadRangeSquared,
          ),
      );
      if (anchors.length === 0) anchors = frontTiles;
    } else {
      anchors = frontTiles;
    }

    const result: TileRef[] = [];
    for (
      let attempt = 0;
      attempt < count * 6 && result.length < count;
      attempt++
    ) {
      const anchor = this.random.randElement(anchors);
      const ax = game.x(anchor);
      const ay = game.y(anchor);
      const x = this.random.nextInt(ax - searchRadius, ax + searchRadius + 1);
      const y = this.random.nextInt(ay - searchRadius, ay + searchRadius + 1);
      if (!game.isValidCoord(x, y)) continue;
      const t = game.ref(x, y);
      if (game.owner(t) !== player) continue;
      const [, borderDist] = closestTile(game, borderTiles, t);
      if (borderDist < minBorderDist || borderDist > maxBorderDist) continue;
      if (!player.canBuild(unitType, t)) continue;
      result.push(t);
    }

    if (result.length > 0) return result;

    // Fallback: relax border-depth constraint (territory too small for depth ring)
    const fallback: TileRef[] = [];
    for (
      let attempt = 0;
      attempt < count * 4 && fallback.length < count;
      attempt++
    ) {
      const anchor = this.random.randElement(anchors);
      const ax = game.x(anchor);
      const ay = game.y(anchor);
      const x = this.random.nextInt(ax - searchRadius, ax + searchRadius + 1);
      const y = this.random.nextInt(ay - searchRadius, ay + searchRadius + 1);
      if (!game.isValidCoord(x, y)) continue;
      const t = game.ref(x, y);
      if (game.owner(t) !== player) continue;
      fallback.push(t);
    }

    return fallback;
  }

  private isOnStructureCooldown(): boolean {
    // Only high-starting-gold nations pause
    if (this.lastStructureTick === null || !this.hasHighStartingGold()) {
      return false;
    }
    const requiredGap =
      HIGH_GOLD_STRUCTURE_COOLDOWN_TICKS[this.placementsCount] ?? 0;
    if (requiredGap === 0) {
      return false;
    }
    return this.game.ticks() - this.lastStructureTick < requiredGap;
  }

  // Spreads placements after the save-up target is first reached:
  // 15s ON / 15s OFF, alternating, to allow NationNukeBehavior to spend the gold.
  private isInPostSaveUpBlockedPhase(): boolean {
    if (this.game.config().isUnitDisabled(UnitType.MissileSilo)) {
      return false;
    }
    const saveUpTarget = this.getSaveUpTarget();
    if (this._postSaveUpStartTick === null) {
      if (this.player.gold() < saveUpTarget) {
        return false;
      }
      this._postSaveUpStartTick = this.game.ticks();
    }
    const elapsed = this.game.ticks() - this._postSaveUpStartTick;
    return (
      elapsed % (TEAM_POST_SAVE_UP_PHASE_TICKS * 2) >=
      TEAM_POST_SAVE_UP_PHASE_TICKS
    );
  }

  private doHandleStructures(): boolean {
    this.reachableStationsCache = null;
    const config = this.game.config();
    const citiesDisabled = config.isUnitDisabled(UnitType.City);
    const cityCount = citiesDisabled
      ? Math.max(
          1,
          Math.floor(this.player.numTilesOwned() / TILES_PER_CITY_EQUIVALENT),
        )
      : this.player.unitsOwned(UnitType.City);
    this._sharedWaterComponents = this.game.sharedWaterComponents(this.player);
    const hasCoastalTiles = this._sharedWaterComponents !== null;

    const missileSilosEnabled = !config.isUnitDisabled(UnitType.MissileSilo);

    // High-starting-gold Hard/Impossible nations build a SAM first so their
    // next structures get SAM coverage and aren't clustered under the same nuke target.
    const { difficulty } = config.gameConfig();
    if (
      this.placementsCount === 0 &&
      (difficulty === Difficulty.Hard ||
        difficulty === Difficulty.Impossible) &&
      !config.isUnitDisabled(UnitType.AtomBomb) &&
      missileSilosEnabled &&
      !config.isUnitDisabled(UnitType.SAMLauncher) &&
      this.hasHighStartingGold() &&
      this.maybeSpawnStructure(UnitType.SAMLauncher)
    ) {
      return true;
    }

    // On crowded maps the first structure is a port (or factory if landlocked)
    // instead of a city, so nations can get income earlier.
    // Mainly intended for private 200+ nation HvN games.
    if (
      !citiesDisabled &&
      this.player.unitsOwned(UnitType.City) === 0 &&
      this.isHighNationDensity()
    ) {
      const preferredFirst =
        hasCoastalTiles && !config.isUnitDisabled(UnitType.Port)
          ? UnitType.Port
          : UnitType.Factory;
      if (
        !config.isUnitDisabled(preferredFirst) &&
        this.maybeSpawnStructure(preferredFirst)
      ) {
        return true;
      }
    }

    // Build order for non-city structures (priority order)
    const buildOrder: UnitType[] = [
      UnitType.Port,
      UnitType.Factory,
      UnitType.SAMLauncher,
      UnitType.MissileSilo,
    ];

    const nukesEnabled =
      !config.isUnitDisabled(UnitType.AtomBomb) ||
      !config.isUnitDisabled(UnitType.HydrogenBomb) ||
      !config.isUnitDisabled(UnitType.MIRV);

    for (const structureType of buildOrder) {
      // Skip disabled structure types
      if (config.isUnitDisabled(structureType)) {
        continue;
      }

      // Skip ports if no coastal tiles
      if (structureType === UnitType.Port && !hasCoastalTiles) {
        continue;
      }

      // Skip missile silos and SAM launchers if all nukes are disabled
      if (
        !nukesEnabled &&
        (structureType === UnitType.MissileSilo ||
          structureType === UnitType.SAMLauncher)
      ) {
        continue;
      }

      // Skip SAM launchers if missile silos are disabled
      if (!missileSilosEnabled && structureType === UnitType.SAMLauncher) {
        continue;
      }

      if (
        this.shouldBuildStructure(structureType, cityCount, hasCoastalTiles)
      ) {
        if (this.maybeSpawnStructure(structureType)) {
          return true;
        }
      }
    }

    if (!citiesDisabled && this.maybeSpawnStructure(UnitType.City)) {
      return true;
    }

    return false;
  }

  private hasHighStartingGold(): boolean {
    this._hasHighStartingGold ??=
      this.game.config().startingGold(this.player.info()) >=
      HIGH_STARTING_GOLD_THRESHOLD;
    return this._hasHighStartingGold;
  }

  private isHighNationDensity(): boolean {
    const landTiles = this.game.numLandTiles();
    if (landTiles <= 0) return false;
    return (
      this.game.nations().length / landTiles > HIGH_NATION_DENSITY_THRESHOLD
    );
  }

  /**
   * Determines if we should build more of this structure type based on
   * the current city count and the configured ratio.
   */
  private shouldBuildStructure(
    type: UnitType,
    cityCount: number,
    hasCoastalTiles: boolean,
  ): boolean {
    const gameConfig = this.game.config();
    const { difficulty } = gameConfig.gameConfig();
    const ratios = getStructureRatios(difficulty);
    const config = ratios[type];
    if (config === undefined) {
      return false;
    }

    let ratio = config.ratioPerCity;

    // Heavily reduce factory spawning if we have coastal tiles
    if (
      type === UnitType.Factory &&
      hasCoastalTiles &&
      !gameConfig.isUnitDisabled(UnitType.Port)
    ) {
      ratio *= FACTORY_COASTAL_RATIO_MULTIPLIER;
    }

    const owned = this.player.unitsOwned(type);

    // Hard cap on missile silos
    if (type === UnitType.MissileSilo && owned >= MAX_MISSILE_SILOS) {
      return false;
    }

    // First missile silo uses a higher ratio so nations can start nuking earlier
    if (type === UnitType.MissileSilo && owned === 0) {
      ratio = FIRST_MISSILE_SILO_RATIO;
    }

    const targetCount = Math.floor(cityCount * ratio);

    return owned < targetCount;
  }

  private cost(type: UnitType): Gold {
    return this.game.unitInfo(type).cost(this.game, this.player);
  }

  private maybeSpawnStructure(type: UnitType): boolean {
    const game = this.game;
    const perceivedCost = this.getPerceivedCost(type);
    if (this.player.gold() < perceivedCost) {
      return false;
    }

    // Check if we should upgrade instead of building new
    const structures = this.player.units(type);
    if (
      this.getTotalStructureDensity() > UPGRADE_DENSITY_THRESHOLD &&
      game.config().unitInfo(type).upgradable
    ) {
      if (this.maybeUpgradeStructure(structures)) {
        return true;
      }
      // Density too high but couldn't upgrade (e.g. all under construction) — don't build new, wait for construction (most relevant for SAMs)
      if (structures.length > 0) {
        return false;
      }
      // No structures of this type exist yet — fall through to build the first one
      // (even if density is high - the nation is probably on a tiny island and we need to use all building spots we can find)
    }

    const tile = this.structureSpawnTile(type);
    if (tile === null) {
      return false;
    }
    const canBuild = this.player.canBuild(type, tile);
    if (canBuild === false) {
      return false;
    }
    game.addExecution(new ConstructionExecution(this.player, type, tile));
    return true;
  }

  /**
   * Calculates the perceived cost for a structure type.
   * The perceived cost increases by a percentage for each structure of that type already owned.
   * This makes nations save up gold for nukes.
   * Once the nation can afford its target stockpile, stop inflating costs.
   */
  private getPerceivedCost(type: UnitType): Gold {
    const realCost = this.cost(type);

    const saveUpTarget = this.getSaveUpTarget();
    if (saveUpTarget === 0n || this.player.gold() >= saveUpTarget) {
      return realCost;
    }

    const owned = this.player.unitsOwned(type);

    let increasePerOwned: number;
    if (type === UnitType.City) {
      increasePerOwned = CITY_PERCEIVED_COST_INCREASE_PER_OWNED;
    } else {
      const { difficulty } = this.game.config().gameConfig();
      const ratios = getStructureRatios(difficulty);
      const config = ratios[type];
      increasePerOwned = config?.perceivedCostIncreasePerOwned ?? 0.1;
    }

    // Each owned structure makes the next one feel more expensive
    // Formula: realCost * (1 + increasePerOwned * owned)
    const multiplier = 1 + increasePerOwned * owned;
    return BigInt(Math.ceil(Number(realCost) * multiplier));
  }

  /**
   * Determines the gold target we want to save up for based on which nukes are enabled.
   * Returns 0 if no saving is needed.
   */
  private getSaveUpTarget(): Gold {
    const config = this.game.config();

    // Just save up for SAMs if missile silos are disabled
    if (config.isUnitDisabled(UnitType.MissileSilo)) {
      return this.cost(UnitType.SAMLauncher);
    }

    // Save up a limited amount in team games, synced with NationNukeBehavior
    // Saving up for a MIRV is not relevant
    if (this.game.config().gameConfig().gameMode === GameMode.Team) {
      return this.cost(UnitType.HydrogenBomb);
    }

    const mirvEnabled = !config.isUnitDisabled(UnitType.MIRV);
    const hydroEnabled = !config.isUnitDisabled(UnitType.HydrogenBomb);
    const atomEnabled = !config.isUnitDisabled(UnitType.AtomBomb);

    if (mirvEnabled) {
      // Save up for MIRV + Hydrogen Bomb
      return this.cost(UnitType.MIRV) + this.cost(UnitType.HydrogenBomb);
    }
    if (hydroEnabled) {
      // Save up for 5 hydrogen bombs
      return this.cost(UnitType.HydrogenBomb) * 5n;
    }
    if (atomEnabled) {
      // Save up for 20 atom bombs
      return this.cost(UnitType.AtomBomb) * 20n;
    }
    // No nukes enabled, just save up for SAMs
    return this.cost(UnitType.SAMLauncher);
  }

  /**
   * Tries to upgrade an existing structure if density threshold is exceeded.
   * @param structures The pool of structures to consider for upgrading
   * @returns true if an upgrade was initiated, false otherwise
   */
  private maybeUpgradeStructure(structures: Unit[]): boolean {
    if (this.getTotalStructureDensity() <= UPGRADE_DENSITY_THRESHOLD) {
      return false;
    }
    if (structures.length === 0) {
      return false;
    }
    const structureToUpgrade = this.findBestStructureToUpgrade(structures);
    if (structureToUpgrade !== null) {
      //canUpgradeUnit already checked in findBestStructureToUpgrade and again in UpgradeStructureExecution
      this.game.addExecution(
        new UpgradeStructureExecution(this.player, structureToUpgrade.id()),
      );
      return true;
    }
    return false;
  }

  /**
   * Calculates total structure density across player's territory.
   */
  private getTotalStructureDensity(): number {
    const tilesOwned = this.player.numTilesOwned();
    return tilesOwned > 0
      ? this.player.units(...Structures.types).length / tilesOwned
      : 0; //ignoring levels for structures
  }

  /**
   * Finds the best structure to upgrade, preferring structures protected by a SAM.
   * In 50% of cases, picks the second or third best to add variety.
   */
  private findBestStructureToUpgrade(structures: Unit[]): Unit | null {
    const game = this.game;
    if (structures.length === 0) {
      return null;
    }

    // Filter to only upgradable structures
    const upgradable = structures.filter((s) => this.player.canUpgradeUnit(s));
    if (upgradable.length === 0) {
      return null;
    }

    // Based on difficulty, chance to just pick a random structure
    const { difficulty } = game.config().gameConfig();
    let randomChance: number;
    switch (difficulty) {
      case Difficulty.Easy:
        randomChance = 70;
        break;
      case Difficulty.Medium:
        randomChance = 40;
        break;
      case Difficulty.Hard:
        randomChance = 25;
        break;
      case Difficulty.Impossible:
        randomChance = 10;
        break;
      default:
        assertNever(difficulty);
    }

    if (this.random.nextInt(0, 100) < randomChance) {
      return this.random.randElement(upgradable);
    }

    const samLaunchers = this.player.units(UnitType.SAMLauncher);

    // Score each structure based on SAM protection
    const scored: { structure: Unit; score: number }[] = [];

    for (const structure of upgradable) {
      let score = 0;

      // Check if protected by any SAM, using per-SAM level-based range
      for (const sam of samLaunchers) {
        const samRange = game.config().samRange(sam.level());
        const samRangeSquared = samRange * samRange;
        const distSquared = game.euclideanDistSquared(
          structure.tile(),
          sam.tile(),
        );
        if (distSquared <= samRangeSquared) {
          // Protected by this SAM, add score based on SAM level
          score += 10;
          if (sam.level() > 1) {
            score += (sam.level() - 1) * 7.5;
          }
        }
      }

      // Add small random factor to break ties
      score += this.random.nextInt(0, 5);

      scored.push({ structure, score });
    }

    if (scored.length === 0) {
      return null;
    }

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    // 50% of the time, pick the second or third best for variety
    if (scored.length >= 2 && this.random.chance(2)) {
      const pickIndex =
        scored.length >= 3
          ? this.random.nextInt(1, 3) // pick index 1 or 2
          : 1; // only index 1 available
      return scored[pickIndex].structure;
    }

    return scored[0].structure;
  }

  private structureSpawnTile(type: UnitType): TileRef | null {
    const tiles =
      type === UnitType.Port
        ? this.randCoastalTileArray(25)
        : randTerritoryTileArray(this.random, this.game, this.player, 25);
    if (tiles.length === 0) return null;
    const valueFunction = this.structureSpawnTileValue(type);
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

  /** Samples shore tiles adjacent to water reachable by another player (=> trading possible) */
  private randCoastalTileArray(numTiles: number): TileRef[] {
    const shared = this._sharedWaterComponents;
    const tiles = Array.from(this.player.borderTiles()).filter((t) => {
      if (!this.game.isShore(t)) return false;
      if (shared === null) return false;
      for (const neighbor of this.game.neighbors(t)) {
        if (!this.game.isWater(neighbor)) continue;
        // Ocean is always considered shared, so any ocean neighbor makes the
        // tile a valid port site — skip the component lookup.
        if (this.game.isOcean(neighbor)) return true;
        const comp = this.game.getWaterComponent(neighbor);
        if (comp !== null && shared.has(comp)) return true;
      }
      return false;
    });
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

  private structureSpawnTileValue(
    type: UnitType,
  ): ((tile: TileRef) => number) | null {
    switch (type) {
      case UnitType.City:
        return this.cityValue();
      case UnitType.MissileSilo:
        return this.missileSiloValue();
      case UnitType.Factory:
        return this.factoryValue();
      case UnitType.Port:
        return this.portValue();
      case UnitType.SAMLauncher:
        return this.samLauncherValue();
      default:
        throw new Error(`Value function not implemented for ${type}`);
    }
  }

  /**
   * Value function for MissileSilo.
   * Prefers high elevation, distance from border, and spacing from same-type structures.
   */
  private missileSiloValue(): (tile: TileRef) => number {
    const game = this.game;
    const borderTiles = this.player.borderTiles();
    const otherUnits = this.player.units(UnitType.MissileSilo);
    const { borderSpacing, structureSpacing } = this.spacingConstants();

    return (tile) => {
      let w = 0;

      // Prefer higher elevations
      w += game.magnitude(tile);

      // Prefer to be away from the border
      const [, closestBorderDist] = closestTile(game, borderTiles, tile);
      w += Math.min(closestBorderDist, borderSpacing);

      // Prefer to be away from other structures of the same type
      const otherTiles: Set<TileRef> = new Set(otherUnits.map((u) => u.tile()));
      otherTiles.delete(tile);
      const closestOther = closestTwoTiles(game, otherTiles, [tile]);
      if (closestOther !== null) {
        const d = game.manhattanDist(closestOther.x, tile);
        w += Math.min(d, structureSpacing);
      }

      return w;
    };
  }

  /**
   * Value function for ports.
   * Prefers spacing from other ports.
   */
  private portValue(): (tile: TileRef) => number {
    const game = this.game;
    const otherUnits = this.player.units(UnitType.Port);

    return (tile) => {
      let w = 0;

      // Prefer to be as far as possible from other ports
      const otherTiles: Set<TileRef> = new Set(otherUnits.map((u) => u.tile()));
      otherTiles.delete(tile);
      const [, closestOtherDist] = closestTile(game, otherTiles, tile);
      w += closestOtherDist;

      return w;
    };
  }

  /**
   * Value function for factories.
   * Prefers high elevation, spacing from other factories, and distance from border.
   * Based on difficulty, scores connectivity by the number of distinct rail
   * clusters within train-station range, weighted by trade gold:
   * ally (1.0) > team/neutral (~0.71) > self (~0.29).
   * Embargoed and bot neighbors are excluded. Per cluster, the best reachable
   * trade relationship determines the weight.
   */
  private factoryValue(): (tile: TileRef) => number {
    const game = this.game;
    const player = this.player;
    const borderTiles = this.player.borderTiles();
    const otherUnits = player.units(UnitType.Factory);
    const { borderSpacing, structureSpacing } = this.spacingConstants();
    const stationRange = game.config().trainStationMaxRange();
    const stationRangeSquared = stationRange * stationRange;
    const { difficulty } = game.config().gameConfig();
    const useConnectionScore = this.shouldUseConnectivityScore(difficulty);

    const reachableStations = useConnectionScore
      ? this.getOrBuildReachableStations()
      : [];
    const minRangeSquared = game.config().trainStationMinRange() ** 2;

    // Cross-type spacing: prefer to be away from cities.
    const cityTiles: Set<TileRef> = new Set(
      player.units(UnitType.City).map((u) => u.tile()),
    );

    return (tile) => {
      let w = 0;

      // Prefer higher elevations
      w += game.magnitude(tile);

      // Prefer to be away from the border
      const [, closestBorderDist] = closestTile(game, borderTiles, tile);
      w += Math.min(closestBorderDist, borderSpacing);

      // Prefer to be away from other factories
      const otherTiles: Set<TileRef> = new Set(otherUnits.map((u) => u.tile()));
      otherTiles.delete(tile);
      const closestOther = closestTwoTiles(game, otherTiles, [tile]);
      if (closestOther !== null) {
        const d = game.manhattanDist(closestOther.x, tile);
        w += Math.min(d, stationRange);
      }

      // Prefer to be away from cities (cross-type spacing)
      const closestCity = closestTwoTiles(game, cityTiles, [tile]);
      if (closestCity !== null) {
        const d = game.manhattanDist(closestCity.x, tile);
        w += Math.min(d, structureSpacing);
      }

      if (!useConnectionScore) {
        return w;
      }

      w +=
        this.computeConnectivityScore(
          tile,
          reachableStations,
          minRangeSquared,
          stationRangeSquared,
        ) * structureSpacing;

      return w;
    };
  }

  /**
   * Given the game difficulty, decide if we should use connectivity scoring
   * to determine the best placement for factories and cities.
   */
  private shouldUseConnectivityScore(difficulty: Difficulty): boolean {
    let randomChance: number;
    switch (difficulty) {
      case Difficulty.Easy:
        randomChance = 0;
        break;
      case Difficulty.Medium:
        randomChance = 60;
        break;
      case Difficulty.Hard:
        randomChance = 75;
        break;
      case Difficulty.Impossible:
        randomChance = 100;
        break;
      default:
        assertNever(difficulty);
    }

    return this.random.nextInt(0, 100) < randomChance;
  }

  private getOrBuildReachableStations(): Array<{
    tile: TileRef;
    cluster: Cluster | null;
    weight: number;
  }> {
    this.reachableStationsCache ??= this.buildReachableStations();
    return this.reachableStationsCache;
  }

  /**
   * Precomputes trade-weighted station entries for connectivity scoring.
   * Iterates all stations once (O(total_stations)) to build a unit→cluster map,
   * then collects own and non-embargoed non-bot neighbor structures with a
   * normalized weight derived from config.trainGold().
   */
  private buildReachableStations(): Array<{
    tile: TileRef;
    cluster: Cluster | null;
    weight: number;
  }> {
    const game = this.game;
    const player = this.player;

    // Build unit → cluster lookup in one O(total_stations) pass.
    const stationManager = game.railNetwork().stationManager();
    const unitToCluster = new Map<Unit, Cluster | null>();
    for (const station of stationManager.getAll()) {
      unitToCluster.set(station.unit, station.getCluster());
    }

    const maxTradeGold = Math.max(
      Number(game.config().trainGold("ally", 0, player)),
      1,
    );
    const result: Array<{
      tile: TileRef;
      cluster: Cluster | null;
      weight: number;
    }> = [];

    // Own structures — weighted by "self" trade gold.
    const selfWeight =
      Number(game.config().trainGold("self", 0, player)) / maxTradeGold;
    for (const unit of player.units(
      UnitType.City,
      UnitType.Port,
      UnitType.Factory,
    )) {
      if (unitToCluster.has(unit)) {
        result.push({
          tile: unit.tile(),
          cluster: unitToCluster.get(unit)!,
          weight: selfWeight,
        });
      }
    }

    // Neighbor structures — all non-embargoed non-bot neighbors.
    for (const neighbor of player.nearby()) {
      if (!neighbor.isPlayer()) continue;
      if (neighbor.type() === PlayerType.Bot) continue;
      if (!player.canTrade(neighbor)) continue;
      const relType = player.isOnSameTeam(neighbor)
        ? "team"
        : player.isAlliedWith(neighbor)
          ? "ally"
          : "other";
      const weight =
        Number(game.config().trainGold(relType, 0, player)) / maxTradeGold;
      for (const unit of neighbor.units(
        UnitType.City,
        UnitType.Port,
        UnitType.Factory,
      )) {
        if (unitToCluster.has(unit)) {
          result.push({
            tile: unit.tile(),
            cluster: unitToCluster.get(unit)!,
            weight,
          });
        }
      }
    }

    return result;
  }

  /**
   * Returns the summed cluster-deduplicated connectivity weight for a candidate
   * tile. Stations outside [minRangeSquared, stationRangeSquared] are ignored.
   * Per cluster the max weight of any station in range is taken; isolated
   * stations (no cluster) contribute their individual weights.
   */
  private computeConnectivityScore(
    tile: TileRef,
    reachableStations: Array<{
      tile: TileRef;
      cluster: Cluster | null;
      weight: number;
    }>,
    minRangeSquared: number,
    stationRangeSquared: number,
  ): number {
    const clustersInRange = new Map<Cluster, number>();
    let isolatedWeight = 0;
    for (const { tile: stationTile, cluster, weight } of reachableStations) {
      const dist = this.game.euclideanDistSquared(tile, stationTile);
      if (dist < minRangeSquared || dist > stationRangeSquared) continue;
      if (cluster !== null) {
        clustersInRange.set(
          cluster,
          Math.max(clustersInRange.get(cluster) ?? 0, weight),
        );
      } else {
        isolatedWeight += weight;
      }
    }
    let score = isolatedWeight;
    for (const cw of clustersInRange.values()) score += cw;
    return score;
  }

  /**
   * Value function for cities.
   * Inherits interior placement criteria (elevation, border distance, spacing)
   * and adds cluster-connectivity scoring so cities prefer positions that extend
   * or bridge the existing rail network. Connectivity is difficulty-gated.
   */
  private cityValue(): (tile: TileRef) => number {
    const game = this.game;
    const player = this.player;
    const borderTiles = player.borderTiles();
    const otherUnits = player.units(UnitType.City);
    const { borderSpacing, structureSpacing } = this.spacingConstants();
    const stationRange = game.config().trainStationMaxRange();
    const stationRangeSquared = stationRange * stationRange;
    const { difficulty } = game.config().gameConfig();
    const useConnectionScore = this.shouldUseConnectivityScore(difficulty);

    const reachableStations = useConnectionScore
      ? this.getOrBuildReachableStations()
      : [];
    const minRangeSquared = game.config().trainStationMinRange() ** 2;

    // Cross-type spacing: prefer to be away from factories.
    const factoryTiles: Set<TileRef> = new Set(
      player.units(UnitType.Factory).map((u) => u.tile()),
    );

    return (tile) => {
      let w = 0;

      w += game.magnitude(tile);

      const [, closestBorderDist] = closestTile(game, borderTiles, tile);
      w += Math.min(closestBorderDist, borderSpacing);

      const otherTiles: Set<TileRef> = new Set(otherUnits.map((u) => u.tile()));
      otherTiles.delete(tile);
      const closestOther = closestTwoTiles(game, otherTiles, [tile]);
      if (closestOther !== null) {
        const d = game.manhattanDist(closestOther.x, tile);
        w += Math.min(d, structureSpacing);
      }

      // Prefer to be away from factories (cross-type spacing)
      const closestFactory = closestTwoTiles(game, factoryTiles, [tile]);
      if (closestFactory !== null) {
        const d = game.manhattanDist(closestFactory.x, tile);
        w += Math.min(d, structureSpacing);
      }

      if (!useConnectionScore) {
        return w;
      }

      w +=
        this.computeConnectivityScore(
          tile,
          reachableStations,
          minRangeSquared,
          stationRangeSquared,
        ) * structureSpacing;

      return w;
    };
  }

  /**
   * Value function for SAM launchers.
   * Prefers elevation, distance from border, spacing, and proximity to protectable structures.
   * On harder difficulties, weights by structure level and considers existing SAM coverage.
   */
  private samLauncherValue(): (tile: TileRef) => number {
    const game = this.game;
    const player = this.player;
    const borderTiles = player.borderTiles();
    const otherUnits = player.units(UnitType.SAMLauncher);
    const { borderSpacing, structureSpacing } = this.spacingConstants();

    const { difficulty } = game.config().gameConfig();
    const weightByLevel =
      difficulty === Difficulty.Hard || difficulty === Difficulty.Impossible;

    const protectEntries: { tile: TileRef; weight: number }[] = [];
    for (const unit of player.units()) {
      switch (unit.type()) {
        case UnitType.City:
        case UnitType.Factory:
        case UnitType.MissileSilo:
        case UnitType.Port:
          protectEntries.push({
            tile: unit.tile(),
            weight: weightByLevel ? unit.level() : 1,
          });
      }
    }
    const range = game.config().defaultSamRange();
    const rangeSquared = range * range;

    const useCoverageWeighting =
      difficulty !== Difficulty.Easy && this.random.nextInt(0, 100) < 25;

    // Pre-compute existing SAM coverage for each protectable structure
    let structureCoverage: Map<TileRef, number> | null = null;
    if (useCoverageWeighting) {
      structureCoverage = new Map<TileRef, number>();
      const existingSams = player.units(UnitType.SAMLauncher);
      for (const entry of protectEntries) {
        let coverageScore = 0;
        for (const sam of existingSams) {
          const samRange = game.config().samRange(sam.level());
          const dist = game.euclideanDistSquared(entry.tile, sam.tile());
          if (dist <= samRange * samRange) {
            coverageScore += sam.level();
          }
        }
        structureCoverage.set(entry.tile, coverageScore);
      }
    }

    return (tile) => {
      let w = 0;

      // Prefer higher elevations
      w += game.magnitude(tile);

      // Prefer to be away from the border
      const closestBorder = closestTwoTiles(game, borderTiles, [tile]);
      if (closestBorder !== null) {
        const d = game.manhattanDist(closestBorder.x, tile);
        w += Math.min(d, borderSpacing);
      }

      // Prefer to be away from other structures of the same type
      const otherTiles: Set<TileRef> = new Set(otherUnits.map((u) => u.tile()));
      otherTiles.delete(tile);
      const closestOther = closestTwoTiles(game, otherTiles, [tile]);
      if (closestOther !== null) {
        const d = game.manhattanDist(closestOther.x, tile);
        w += Math.min(d, structureSpacing);
      }

      // Prefer to be in range of other structures (skip on easy difficulty)
      if (difficulty !== Difficulty.Easy) {
        for (const entry of protectEntries) {
          const distanceSquared = game.euclideanDistSquared(tile, entry.tile);
          if (distanceSquared > rangeSquared) continue;
          if (useCoverageWeighting && structureCoverage !== null) {
            const coverage = structureCoverage.get(entry.tile) ?? 0;
            const coverageWeight = 1 / (1 + coverage);
            w += structureSpacing * entry.weight * coverageWeight;
          } else {
            w += structureSpacing * entry.weight;
          }
        }
      }

      return w;
    };
  }

  /** Shared spacing constants derived from atom bomb range. */
  private spacingConstants(): {
    borderSpacing: number;
    structureSpacing: number;
  } {
    const borderSpacing = this.game
      .config()
      .nukeMagnitudes(UnitType.AtomBomb).outer;
    return { borderSpacing, structureSpacing: borderSpacing * 2 };
  }
}
