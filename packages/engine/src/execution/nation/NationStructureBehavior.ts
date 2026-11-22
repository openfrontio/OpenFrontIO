import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Difficulty,
  GameMode,
  Gold,
  MAX_UPGRADE_AMOUNT,
  PlayerType,
  Relation,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  readVersioned,
  snapshotType,
  Versioned,
  zInt,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { assertNever } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { MIRV_BASE_COST } from "../../configuration/EngineConfig";
import { Attack, Game, Player, Unit } from "../../game/Game";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { ConstructionExecution } from "../ConstructionExecution";
import { UpgradeStructureExecution } from "../UpgradeStructureExecution";
import { isMirvWorthSavingFor } from "./NationMIRVBehavior";
import { NationStructurePlacement } from "./NationStructurePlacement";
import {
  hasHighStartingGold,
  isSaveUpWithinReach,
  randTerritoryTileArray,
} from "./NationUtils";

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

/** Port ratio per city in team games (not on Easy), where teammates are safe trade partners */
const TEAM_PORT_RATIO = 1;

/**
 * Returns structure ratios relative to city count, adjusted by difficulty and game mode.
 * Cities are always prioritized and built first.
 * When cities are disabled, we use TILES_PER_CITY_EQUIVALENT. That's not ideal, nations won't properly upgrade structures, but it's better than nothing. Probably 99.9% of players won't disable cities anyway.
 */
function getStructureRatios(
  difficulty: Difficulty,
  gameMode: GameMode,
): Partial<Record<UnitType, StructureRatioConfig>> {
  const teamPorts =
    gameMode === GameMode.Team && difficulty !== Difficulty.Easy;
  return {
    [UnitType.Port]: {
      ratioPerCity: teamPorts ? TEAM_PORT_RATIO : 0.75,
      perceivedCostIncreasePerOwned: 1,
    },
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

/** Cities owned before saving up for nukes inflates structure costs, keyed by difficulty */
const CITIES_BEFORE_SAVING: Record<Difficulty, number> = {
  [Difficulty.Easy]: 0,
  [Difficulty.Medium]: 3,
  [Difficulty.Hard]: 4,
  [Difficulty.Impossible]: 5,
};

/** Scales the perceived cost increase of cities, ports and factories while saving up, keyed by difficulty */
const INCOME_STRUCTURE_SAVING_WEIGHT: Record<Difficulty, number> = {
  [Difficulty.Easy]: 1,
  [Difficulty.Medium]: 0.8,
  [Difficulty.Hard]: 0.6,
  [Difficulty.Impossible]: 0.4,
};

/** Factory ratio multiplier when the nation has coastal tiles, keyed by difficulty */
const FACTORY_COASTAL_RATIO_MULTIPLIER: Record<Difficulty, number> = {
  [Difficulty.Easy]: 0.33,
  [Difficulty.Medium]: 0.45,
  [Difficulty.Hard]: 0.55,
  [Difficulty.Impossible]: 0.6,
};

/** Structures a nation wants under SAM cover */
const SAM_PROTECTED_TYPES: readonly UnitType[] = [
  UnitType.City,
  UnitType.Factory,
  UnitType.MissileSilo,
  UnitType.Port,
];

/** Percent chance to upgrade a SAM instead of building one when SAMs already cover every structure */
const SAM_UPGRADE_WHEN_COVERED_CHANCE: Record<Difficulty, number> = {
  [Difficulty.Easy]: 0,
  [Difficulty.Medium]: 50,
  [Difficulty.Hard]: 100,
  [Difficulty.Impossible]: 100,
};

/** Lowest SAM level whose range beats a hydrogen bomb's blast radius */
const SAM_HYDRO_PROOF_LEVEL = 5;

/** Spare gold beyond the save-up target from which Hard & Impossible also cover land without structures with SAMs */
const SAM_LAND_COVER_SPARE_GOLD = 30_000_000n;

/** Territory tiles checked for SAM cover */
const SAM_LAND_COVER_SAMPLES = 20;

/** Most levels a structure gets without a finished SAM over it once an enemy owns a missile silo, keyed by difficulty */
const UNCOVERED_MAX_LEVEL: Partial<Record<Difficulty, number>> = {
  [Difficulty.Hard]: 8,
  [Difficulty.Impossible]: 4,
};

/** Most missile silo levels a nation builds or upgrades to */
const MAX_MISSILE_SILOS = 3;

/** One more missile silo level per this much starting nuke reserve */
const NUKE_RESERVE_PER_EXTRA_SILO = 25_000_000n;

/** Percent of a high starting gold that structures leave for nukes, keyed by difficulty */
const NUKE_RESERVE_PERCENT: Record<Difficulty, bigint> = {
  [Difficulty.Easy]: 0n,
  [Difficulty.Medium]: 3n,
  [Difficulty.Hard]: 6n,
  [Difficulty.Impossible]: 10n,
};

const NUKE_TYPES = [
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
] as const;

/** Ratio per city used for the first missile silo so nations start nuking earlier */
const FIRST_MISSILE_SILO_RATIO = 0.4;

/** If we have more than this many structures per tiles, prefer upgrading over building */
const UPGRADE_DENSITY_THRESHOLD = 1 / 1500;

/** Most levels bought in one upgrade, as far as the gold beyond the save-up target pays for them, keyed by difficulty */
const MAX_UPGRADES_AT_ONCE: Record<Difficulty, number> = {
  [Difficulty.Easy]: 3,
  [Difficulty.Medium]: 10,
  [Difficulty.Hard]: MAX_UPGRADE_AMOUNT,
  [Difficulty.Impossible]: MAX_UPGRADE_AMOUNT,
};

/** Structures counted for that density; cheap defense posts would push nations into upgrading early */
const DENSITY_STRUCTURE_TYPES: readonly UnitType[] = Structures.types.filter(
  (t) => t !== UnitType.DefensePost,
);

/** Estimated number of tiles per city equivalent, used when cities are disabled */
const TILES_PER_CITY_EQUIVALENT = 2000;

/**
 * When map-wide nation density (nations per land tile) is above this threshold,
 * a nation's very first structure is a port (or factory if no water access)
 */
const HIGH_NATION_DENSITY_THRESHOLD = 1 / 7500;

/**
 * Starting gold below which high-starting-gold nations wait between their first structures, so they
 * don't cluster inside a single nuke blast radius; Hard & Impossible with more release the rest over a ramp.
 */
const PACED_STARTING_GOLD_LIMIT = 10_000_000n;

/** Seconds over which rich Hard & Impossible nations release their starting gold beyond the paced limit to structures */
const RICH_START_GOLD_RAMP_SECONDS = 240;

/** Rich Hard & Impossible nations first build one of each structure type in this order; a missile silo first nukes before enemy SAMs stand */
const RICH_START_FIRST_TYPES: readonly UnitType[] = [
  UnitType.MissileSilo,
  UnitType.SAMLauncher,
  UnitType.Port,
  UnitType.Factory,
  UnitType.City,
];

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
 * Incoming attack troop count as a fraction of own troops below which
 * the nation does not build defensive structures.
 */
const UNDER_ATTACK_THREAT_RATIO = 0.35;

/**
 * Hard / Impossible: one additional defense post is allowed per this fraction
 * of the incoming-to-own-troop ratio (e.g. 0.4 → 1 post at 0–40%, 2 at
 * 40–80%, 3 at 80–120%, …).
 */
const DEFENSE_POST_RATIO_PER_POST = 0.4;

/** Closest a reactive defense post goes to the attack front, in post ranges; Hard/Impossible go further back per unit of incoming-to-own troop ratio */
const DEFENSE_POST_FRONT_MIN_DIST = 2 / 3;
const DEFENSE_POST_FRONT_DIST_PER_RATIO = 1 / 3;
const DEFENSE_POST_FRONT_RATIO_CAP = 2;
/** Depth of the band a reactive defense post may go in, in post ranges */
const DEFENSE_POST_FRONT_BAND = 1 / 2;

/** Distance band from a threatening neighbor's border for a defense post built before it attacks, in post ranges */
const PROACTIVE_DEFENSE_POST_MIN_DIST = 1 / 2;
const PROACTIVE_DEFENSE_POST_MAX_DIST = 1;
/** Cities owned before Hard/Impossible nations fortify borders that aren't under attack yet */
const PROACTIVE_DEFENSE_POST_MIN_CITIES = 2;
/** Defense posts owned per city above which nations stop fortifying borders that aren't under attack */
const PROACTIVE_DEFENSE_POSTS_PER_CITY = 0.5;
/** Share of our troops a hostile neighbor needs before we fortify against it, keyed by difficulty */
const PROACTIVE_DEFENSE_POST_HOSTILE_TROOP_RATIO: Partial<
  Record<Difficulty, number>
> = {
  [Difficulty.Hard]: 1,
  [Difficulty.Impossible]: 0.5,
};

/** Random tiles tried when looking for a defense post spot */
const DEFENSE_POST_SAMPLE_ATTEMPTS = 150;

// Reusable neighbor buffer for hot loops; the simulation is single-threaded.
const NEIGHBOR_SCRATCH: TileRef[] = [0, 0, 0, 0];

export class NationStructureBehavior {
  private placement: NationStructurePlacement;
  private lastStructureTick: number | null = null;
  private placementsCount = 0;
  private builtCrowdedMapFirstStructure = false;
  private _hasHighStartingGold: boolean | null = null;
  private _postSaveUpStartTick: number | null = null;
  private mirvWorthSavingMemo: { tick: number; worth: boolean } | null = null;

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
  ) {
    this.placement = new NationStructurePlacement(random, game, player);
  }

  /**
   * The placement only caches what doHandleStructures reads in its own tick.
   * mirvWorthSavingMemo only holds for the tick it was computed in.
   */
  snapshot(w: SnapshotWriter): Versioned {
    return w.versioned(NationStructureBehaviorSnapshot, {
      lastStructureTick: this.lastStructureTick,
      placementsCount: this.placementsCount,
      builtCrowdedMapFirstStructure: this.builtCrowdedMapFirstStructure,
      hasHighStartingGold: this._hasHighStartingGold,
      postSaveUpStartTick: this._postSaveUpStartTick,
    });
  }

  /** Fills a prototype-only shell; only assigns (see README). */
  restoreSnapshot(
    raw: unknown,
    r: SnapshotReader,
    random: PseudoRandom,
    player: Player,
  ): void {
    const s = readVersioned(NationStructureBehaviorSnapshot, raw);
    this.random = random;
    this.game = r.game;
    this.player = player;
    this.placement = new NationStructurePlacement(random, r.game, player);
    this.mirvWorthSavingMemo = null;
    this.lastStructureTick = s.lastStructureTick;
    this.placementsCount = s.placementsCount;
    this.builtCrowdedMapFirstStructure = s.builtCrowdedMapFirstStructure;
    this._hasHighStartingGold = s.hasHighStartingGold;
    this._postSaveUpStartTick = s.postSaveUpStartTick;
  }

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
   * Tries to place one defense post behind an active attack front, including
   * landed boat attacks, far enough back to be finished before the attack arrives.
   * Not called on Easy. Medium: 50% chance per call, 1 post total, fixed distance.
   * Hard/Impossible: ceil(ratio / 0.4) posts total, further back against stronger attacks.
   * Does not touch placementsCount or lastStructureTick.
   */
  private tryBuildDefensePost(): boolean {
    const { difficulty } = this.game.config().gameConfig();
    if (difficulty === Difficulty.Easy) return false;
    if (difficulty === Difficulty.Medium && !this.random.chance(2))
      return false;

    const player = this.player;
    const attacks = player.incomingAttacks();
    if (attacks.length === 0) return false;

    const ourTroops = player.troops();
    if (ourTroops <= 0) return false;

    const incomingTroops = attacks.reduce((sum, a) => sum + a.troops(), 0);
    const ratio = incomingTroops / ourTroops;
    if (ratio < UNDER_ATTACK_THREAT_RATIO) return false;

    let allowed: number;
    if (difficulty === Difficulty.Medium) {
      allowed = 1;
    } else {
      allowed = Math.ceil(ratio / DEFENSE_POST_RATIO_PER_POST);
    }

    const range = this.game.config().defensePostRange();
    const scaledRatio =
      difficulty === Difficulty.Medium
        ? 0
        : Math.min(ratio, DEFENSE_POST_FRONT_RATIO_CAP);
    const minDist =
      range *
      (DEFENSE_POST_FRONT_MIN_DIST +
        DEFENSE_POST_FRONT_DIST_PER_RATIO * scaledRatio);
    const maxDist = minDist + range * DEFENSE_POST_FRONT_BAND;

    const frontTiles = this.getAttackFrontTiles(attacks);
    if (
      this.countDefensePostsNearFront(frontTiles, maxDist, allowed) >= allowed
    )
      return false;

    return this.buildDefensePostBehind(frontTiles, minDist, maxDist);
  }

  /**
   * Hard/Impossible: covers the border with a hostile (recently attacking)
   * neighbor before it attacks again, as humans do. Hard only fears ones at
   * least as strong as itself, Impossible also weaker ones. One post per
   * threatening neighbor.
   */
  private maybeBuildProactiveDefensePost(): boolean {
    const config = this.game.config();
    const { difficulty } = config.gameConfig();
    const hostileTroopRatio =
      PROACTIVE_DEFENSE_POST_HOSTILE_TROOP_RATIO[difficulty];
    if (hostileTroopRatio === undefined) return false;
    if (config.isUnitDisabled(UnitType.DefensePost)) return false;
    const cityCount = this.cityCount();
    if (cityCount < PROACTIVE_DEFENSE_POST_MIN_CITIES) return false;

    const player = this.player;
    if (
      player.units(UnitType.DefensePost).length >=
      cityCount * PROACTIVE_DEFENSE_POSTS_PER_CITY
    )
      return false;
    if (player.gold() < this.cost(UnitType.DefensePost)) return false;

    const minTroops = player.troops() * hostileTroopRatio;
    const threats = new Set<Player>();
    for (const neighbor of player.nearby()) {
      if (!neighbor.isPlayer() || neighbor.type() === PlayerType.Bot) continue;
      if (player.isFriendly(neighbor)) continue;
      if (
        player.relation(neighbor) === Relation.Hostile &&
        neighbor.troops() >= minTroops
      ) {
        threats.add(neighbor);
      }
    }
    if (threats.size === 0) return false;

    const range = config.defensePostRange();
    const frontTiles = this.borderTilesFacing(threats);
    if (
      this.countDefensePostsNearFront(frontTiles, range * 1.5, threats.size) >=
      threats.size
    )
      return false;

    return this.buildDefensePostBehind(
      frontTiles,
      range * PROACTIVE_DEFENSE_POST_MIN_DIST,
      range * PROACTIVE_DEFENSE_POST_MAX_DIST,
    );
  }

  private buildDefensePostBehind(
    frontTiles: TileRef[],
    minDist: number,
    maxDist: number,
  ): boolean {
    const player = this.player;
    if (player.gold() < this.cost(UnitType.DefensePost)) return false;
    const tile = this.findDefensePostTile(frontTiles, minDist, maxDist);
    if (tile === null) return false;
    this.game.addExecution(
      new ConstructionExecution(player, UnitType.DefensePost, tile),
    );
    return true;
  }

  private defensePostNeeded(): boolean {
    const { difficulty } = this.game.config().gameConfig();
    if (difficulty === Difficulty.Easy) return false;
    const attacks = this.player.incomingAttacks();
    if (attacks.length === 0) return false;
    const ourTroops = this.player.troops();
    if (ourTroops <= 0) return false;
    const incomingTroops = attacks.reduce((sum, a) => sum + a.troops(), 0);
    return incomingTroops / ourTroops >= UNDER_ATTACK_THREAT_RATIO;
  }

  /**
   * Returns our border tiles adjacent to a land attacker's territory, plus the
   * landing frontier of boat attacks from players not attacking by land.
   */
  private getAttackFrontTiles(attacks: Attack[]): TileRef[] {
    const game = this.game;
    const player = this.player;
    const landAttackers = new Set<Player>();
    for (const a of attacks) {
      if (a.sourceTile() === null) landAttackers.add(a.attacker());
    }

    const frontTiles = this.borderTilesFacing(landAttackers);

    // A land attacker's beachheads are already in its adjacency front above.
    for (const a of attacks) {
      if (a.sourceTile() === null || landAttackers.has(a.attacker())) continue;
      a.borderTiles().forEach((t) => {
        if (game.owner(t) === player) frontTiles.push(t);
      });
    }
    return frontTiles;
  }

  /** Our border tiles adjacent to land owned by any of `players`. */
  private borderTilesFacing(players: ReadonlySet<Player>): TileRef[] {
    const game = this.game;
    const frontTiles: TileRef[] = [];
    if (players.size === 0) return frontTiles;
    // Set.forEach + a reused neighbor buffer: border sets are huge, and
    // for..of over a Set allocates an iterator-result object per element.
    // "Any neighbor is one of them" is order-insensitive.
    const nbuf = NEIGHBOR_SCRATCH;
    this.player.borderTiles().forEach((borderTile) => {
      const n = game.neighbors4(borderTile, nbuf);
      for (let i = 0; i < n; i++) {
        const owner = game.owner(nbuf[i]);
        if (players.has(owner as Player)) {
          frontTiles.push(borderTile);
          return;
        }
      }
    });
    return frontTiles;
  }

  /**
   * Counts defense posts within `range` of any front tile.
   * `cap` short-circuits the scan once that many are found.
   */
  private countDefensePostsNearFront(
    frontTiles: TileRef[],
    range: number,
    cap?: number,
  ): number {
    if (frontTiles.length === 0) return 0;

    const game = this.game;
    const rangeSquared = range ** 2;

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
   * Finds an own tile where a defense post can be built at a distance in
   * [minDist, maxDist] from the nearest front tile, sampled around the front.
   * Front tiles and candidates near existing defense posts are skipped, since
   * overlapping posts don't stack; a fully covered front yields null.
   */
  private findDefensePostTile(
    frontTiles: TileRef[],
    minDist: number,
    maxDist: number,
  ): TileRef | null {
    if (frontTiles.length === 0) return null;
    const game = this.game;
    const player = this.player;

    const spreadRangeSquared = (game.config().defensePostRange() * 1.5) ** 2;
    const existingDPTiles = player
      .units(UnitType.DefensePost)
      .map((u) => u.tile());
    const nearExistingPost = (t: TileRef) =>
      existingDPTiles.some(
        (dp) => game.euclideanDistSquared(t, dp) < spreadRangeSquared,
      );

    const anchors = frontTiles.filter((ft) => !nearExistingPost(ft));
    if (anchors.length === 0) return null;

    const minSquared = minDist ** 2;
    const maxSquared = maxDist ** 2;
    const searchRadius = Math.ceil(maxDist);
    for (let attempt = 0; attempt < DEFENSE_POST_SAMPLE_ATTEMPTS; attempt++) {
      const anchor = this.random.randElement(anchors);
      const ax = game.x(anchor);
      const ay = game.y(anchor);
      const x = this.random.nextInt(ax - searchRadius, ax + searchRadius + 1);
      const y = this.random.nextInt(ay - searchRadius, ay + searchRadius + 1);
      if (!game.isValidCoord(x, y)) continue;
      const t = game.ref(x, y);
      if (game.owner(t) !== player) continue;
      if (nearExistingPost(t)) continue;
      let nearestSquared = Infinity;
      for (const ft of frontTiles) {
        nearestSquared = Math.min(
          nearestSquared,
          game.euclideanDistSquared(t, ft),
        );
        if (nearestSquared < minSquared) break;
      }
      if (nearestSquared < minSquared || nearestSquared > maxSquared) continue;
      if (!player.canBuild(UnitType.DefensePost, t)) continue;
      return t;
    }
    return null;
  }

  private isOnStructureCooldown(): boolean {
    if (
      this.lastStructureTick === null ||
      !this.hasHighStartingGold() ||
      this.game.config().startingGold(this.player.info()) >=
        PACED_STARTING_GOLD_LIMIT
    ) {
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
  // Not while the gold covers the target twice, as bulk upgrades leave the target for nukes.
  private isInPostSaveUpBlockedPhase(): boolean {
    if (this.game.config().isUnitDisabled(UnitType.MissileSilo)) {
      return false;
    }
    const saveUpTarget = this.getSaveUpTarget();
    const gold = this.spendableGold();
    if (this._postSaveUpStartTick === null) {
      if (gold < saveUpTarget) {
        return false;
      }
      this._postSaveUpStartTick = this.game.ticks();
    }
    if (gold >= saveUpTarget * 2n) {
      return false;
    }
    const elapsed = this.game.ticks() - this._postSaveUpStartTick;
    return (
      elapsed % (TEAM_POST_SAVE_UP_PHASE_TICKS * 2) >=
      TEAM_POST_SAVE_UP_PHASE_TICKS
    );
  }

  private doHandleStructures(): boolean {
    this.placement.startRound();
    const config = this.game.config();
    const citiesDisabled = config.isUnitDisabled(UnitType.City);
    const cityCount = this.cityCount();
    const hasCoastalTiles = this.placement.hasCoastalTiles();

    const { difficulty } = config.gameConfig();
    const richStart = this.hasRichStart();
    if (richStart) {
      for (const type of RICH_START_FIRST_TYPES) {
        if (
          this.player.unitsOwned(type) === 0 &&
          this.usesStructure(type, hasCoastalTiles) &&
          this.maybeSpawnStructure(type)
        ) {
          return true;
        }
      }
    } else if (
      // Other high-starting-gold Hard/Impossible nations build a SAM first so their
      // next structures get SAM coverage and aren't clustered under the same nuke target.
      this.placementsCount === 0 &&
      this.isHardOrImpossible() &&
      !config.isUnitDisabled(UnitType.AtomBomb) &&
      !config.isUnitDisabled(UnitType.MissileSilo) &&
      !config.isUnitDisabled(UnitType.SAMLauncher) &&
      this.hasHighStartingGold() &&
      this.maybeSpawnStructure(UnitType.SAMLauncher)
    ) {
      return true;
    }

    // On crowded maps, and when teams start apart in their own spawn areas (not on Easy),
    // the first structure is a port (or factory if landlocked) instead of a city, so nations
    // can get income earlier. Crowded maps are mainly private 200+ nation HvN games.
    // Own one-shot flag, set only on success: unitsOwned(City) never clears
    // (starves cities forever) and placementsCount can get consumed by the
    // SAM-first branch above.
    if (
      !citiesDisabled &&
      !richStart &&
      !this.builtCrowdedMapFirstStructure &&
      (this.isHighNationDensity() ||
        (difficulty !== Difficulty.Easy && this.startsInTeamSpawnArea()))
    ) {
      const preferredFirst =
        hasCoastalTiles && !config.isUnitDisabled(UnitType.Port)
          ? UnitType.Port
          : UnitType.Factory;
      if (config.isUnitDisabled(preferredFirst)) {
        this.builtCrowdedMapFirstStructure = true;
      } else if (this.maybeSpawnStructure(preferredFirst)) {
        this.builtCrowdedMapFirstStructure = true;
        return true;
      }
    }

    if (this.maybeBuildProactiveDefensePost()) {
      return true;
    }

    // Build order for non-city structures (priority order)
    const buildOrder: UnitType[] = [
      UnitType.Port,
      UnitType.Factory,
      UnitType.SAMLauncher,
      UnitType.MissileSilo,
    ];

    for (const structureType of buildOrder) {
      if (!this.usesStructure(structureType, hasCoastalTiles)) {
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

  /** Whether the structure type is enabled and of use to us: ports need a coast, silos and SAMs need nukes. */
  private usesStructure(type: UnitType, hasCoastalTiles: boolean): boolean {
    const config = this.game.config();
    if (config.isUnitDisabled(type)) return false;
    const nukesEnabled = NUKE_TYPES.some((t) => !config.isUnitDisabled(t));
    switch (type) {
      case UnitType.Port:
        return hasCoastalTiles;
      case UnitType.MissileSilo:
        return nukesEnabled;
      case UnitType.SAMLauncher:
        return nukesEnabled && !config.isUnitDisabled(UnitType.MissileSilo);
      default:
        return true;
    }
  }

  // Cities owned, or a territory-based equivalent when cities are disabled
  private cityCount(): number {
    if (this.game.config().isUnitDisabled(UnitType.City)) {
      return Math.max(
        1,
        Math.floor(this.player.numTilesOwned() / TILES_PER_CITY_EQUIVALENT),
      );
    }
    return this.player.unitsOwned(UnitType.City);
  }

  private startsInTeamSpawnArea(): boolean {
    const team = this.player.team();
    return team !== null && this.game.teamSpawnArea(team) !== undefined;
  }

  private hasHighStartingGold(): boolean {
    this._hasHighStartingGold ??= hasHighStartingGold(this.game, this.player);
    return this._hasHighStartingGold;
  }

  private isHighNationDensity(): boolean {
    const landTiles = this.game.numLandTiles();
    if (landTiles <= 0) return false;
    return (
      this.game.nations().length / landTiles > HIGH_NATION_DENSITY_THRESHOLD
    );
  }

  private shouldBuildStructure(
    type: UnitType,
    cityCount: number,
    hasCoastalTiles: boolean,
  ): boolean {
    return this.levelsDue(type, cityCount, hasCoastalTiles) > 0;
  }

  /** Levels of this structure type the configured ratio to the city count still asks for. */
  private levelsDue(
    type: UnitType,
    cityCount: number,
    hasCoastalTiles: boolean,
  ): number {
    const gameConfig = this.game.config();
    const { difficulty, gameMode } = gameConfig.gameConfig();
    const ratios = getStructureRatios(difficulty, gameMode);
    const config = ratios[type];
    if (config === undefined) {
      return 0;
    }

    let ratio = config.ratioPerCity;

    // Reduce factory spawning if we have coastal tiles
    if (
      type === UnitType.Factory &&
      hasCoastalTiles &&
      !gameConfig.isUnitDisabled(UnitType.Port)
    ) {
      ratio *= FACTORY_COASTAL_RATIO_MULTIPLIER[difficulty];
    }

    const owned = this.player.unitsOwned(type);
    let targetCount: number;
    if (type === UnitType.MissileSilo) {
      // First missile silo uses a higher ratio so nations can start nuking earlier
      if (owned === 0) {
        ratio = FIRST_MISSILE_SILO_RATIO;
      }
      const cap =
        MAX_MISSILE_SILOS +
        Number(this.startingNukeReserve() / NUKE_RESERVE_PER_EXTRA_SILO);
      targetCount = Math.min(Math.floor(cityCount * ratio), cap);
    } else {
      targetCount = Math.floor(cityCount * ratio);
    }

    return targetCount - owned;
  }

  private cost(type: UnitType, extraUnits: number = 0): Gold {
    return this.game.unitInfo(type).cost(this.game, this.player, extraUnits);
  }

  private maybeSpawnStructure(type: UnitType): boolean {
    const game = this.game;
    const perceivedCost = this.getPerceivedCost(type);
    if (this.spendableGold() < perceivedCost) {
      return false;
    }

    // Another SAM would cover nothing new, but a higher level stops more of a salvo
    if (type === UnitType.SAMLauncher && this.shouldUpgradeSamInstead()) {
      return this.upgradeSam();
    }

    // Check if we should upgrade instead of building new; Hard & Impossible get here with a SAM only while SAM cover is missing
    const structures = this.player.units(type);
    const upgradable = game.config().unitInfo(type).upgradable === true;
    const samCoverMissing =
      type === UnitType.SAMLauncher && this.isHardOrImpossible();
    if (
      !samCoverMissing &&
      this.getTotalStructureDensity() > UPGRADE_DENSITY_THRESHOLD &&
      upgradable
    ) {
      if (this.maybeUpgradeStructure(type, structures)) {
        return true;
      }
      if (this.levelRooms(structures).includes(0)) {
        return this.buildCoveringSam();
      }
      // Density too high but couldn't upgrade (e.g. all under construction) — don't build new, wait for construction (most relevant for SAMs)
      if (structures.length > 0) {
        return false;
      }
      // No structures of this type exist yet — fall through to build the first one
      // (even if density is high - the nation is probably on a tiny island and we need to use all building spots we can find)
    }

    const tile = this.placement.spawnTile(
      type,
      type === UnitType.SAMLauncher && this.coversLandWithSams(),
    );
    if (tile === null) {
      // No room for a new one (e.g. a short coastline full of ports): upgrade one instead
      return (
        upgradable &&
        game.config().gameConfig().difficulty !== Difficulty.Easy &&
        this.maybeUpgradeStructure(type, structures)
      );
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
    if (
      saveUpTarget === 0n ||
      this.spendableGold() >= saveUpTarget ||
      !isSaveUpWithinReach(
        this.game,
        this.player,
        saveUpTarget + this.nukeReserve(),
      )
    ) {
      return realCost;
    }

    // Like humans, nations don't save up before their first few cities stand
    const { difficulty, gameMode } = this.game.config().gameConfig();
    if (this.cityCount() < CITIES_BEFORE_SAVING[difficulty]) {
      return realCost;
    }

    const owned = this.player.unitsOwned(type);

    let increasePerOwned: number;
    if (type === UnitType.City) {
      increasePerOwned = CITY_PERCEIVED_COST_INCREASE_PER_OWNED;
    } else {
      const ratios = getStructureRatios(difficulty, gameMode);
      const config = ratios[type];
      increasePerOwned = config?.perceivedCostIncreasePerOwned ?? 0.1;
    }
    // Income structures pay for themselves, so smarter nations keep building them while saving
    if (
      type === UnitType.City ||
      type === UnitType.Port ||
      type === UnitType.Factory
    ) {
      increasePerOwned *= INCOME_STRUCTURE_SAVING_WEIGHT[difficulty];
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

    // Not for a MIRV that SAMs would shoot down
    if (mirvEnabled && this.isMirvWorthSavingFor()) {
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

  private startingNukeReserve(): Gold {
    const config = this.game.config();
    if (
      !this.hasHighStartingGold() ||
      config.isUnitDisabled(UnitType.MissileSilo) ||
      NUKE_TYPES.every((type) => config.isUnitDisabled(type))
    ) {
      return 0n;
    }
    const percent = NUKE_RESERVE_PERCENT[config.gameConfig().difficulty];
    return (config.startingGold(this.player.info()) * percent) / 100n;
  }

  /** The starting nuke reserve less what our nukes have cost so far, MIRVs at the lowest price they sell for. */
  private nukeReserve(): Gold {
    let reserve = this.startingNukeReserve();
    for (const type of NUKE_TYPES) {
      if (reserve <= 0n) return 0n;
      const price = type === UnitType.MIRV ? MIRV_BASE_COST : this.cost(type);
      reserve -= BigInt(this.player.unitsConstructed(type)) * price;
    }
    return reserve > 0n ? reserve : 0n;
  }

  /** Hard & Impossible with a starting gold too big to pace by pauses. */
  private hasRichStart(): boolean {
    return (
      this.isHardOrImpossible() &&
      this.game.config().startingGold(this.player.info()) >=
        PACED_STARTING_GOLD_LIMIT
    );
  }

  /** The starting gold beyond the paced limit that a rich start hasn't released to structures yet. */
  private unreleasedStartingGold(): Gold {
    if (!this.hasRichStart()) return 0n;
    const left =
      1 - this.game.elapsedGameSeconds() / RICH_START_GOLD_RAMP_SECONDS;
    if (left <= 0) return 0n;
    const excess =
      this.game.config().startingGold(this.player.info()) -
      PACED_STARTING_GOLD_LIMIT;
    return BigInt(Math.floor(Number(excess) * left));
  }

  /** Gold beyond the nuke reserve and the starting gold not released yet. */
  private spendableGold(): Gold {
    const reserve = this.nukeReserve();
    const unreleased = this.unreleasedStartingGold();
    return this.player.gold() - (reserve > unreleased ? reserve : unreleased);
  }

  private isMirvWorthSavingFor(): boolean {
    const tick = this.game.ticks();
    if (this.mirvWorthSavingMemo?.tick !== tick) {
      this.mirvWorthSavingMemo = {
        tick,
        worth: isMirvWorthSavingFor(this.game, this.player),
      };
    }
    return this.mirvWorthSavingMemo.worth;
  }

  /** Upgrades the best of the given structures; false if none can be upgraded. */
  private maybeUpgradeStructure(type: UnitType, structures: Unit[]): boolean {
    if (type === UnitType.SAMLauncher && this.isHardOrImpossible()) {
      return this.upgradeSam();
    }
    const rooms = this.levelRooms(structures);
    const open = structures.filter((_, i) => rooms[i] > 0);
    const best = this.findBestStructureToUpgrade(open);
    if (best === null) return false;
    return this.upgradeStructure(best, rooms[structures.indexOf(best)]);
  }

  /** Per structure, the levels it may still get: Hard & Impossible keep big investments under finished SAMs once an enemy owns a missile silo. */
  private levelRooms(structures: Unit[]): number[] {
    const maxLevel =
      UNCOVERED_MAX_LEVEL[this.game.config().gameConfig().difficulty];
    if (
      maxLevel === undefined ||
      !this.usesSams() ||
      !this.enemyOwnsMissileSilo()
    ) {
      return structures.map(() => Infinity);
    }
    const sams = this.player
      .units(UnitType.SAMLauncher)
      .filter((sam) => !sam.isUnderConstruction());
    return structures.map((s) =>
      !SAM_PROTECTED_TYPES.includes(s.type()) ||
      this.isCoveredBySam(s.tile(), sams)
        ? Infinity
        : Math.max(0, maxLevel - s.level()),
    );
  }

  private usesSams(): boolean {
    return this.usesStructure(
      UnitType.SAMLauncher,
      this.placement.hasCoastalTiles(),
    );
  }

  private enemyOwnsMissileSilo(): boolean {
    return this.game
      .players()
      .some(
        (p) =>
          p.type() !== PlayerType.Bot &&
          !this.player.isFriendly(p) &&
          p.unitCount(UnitType.MissileSilo) > 0,
      );
  }

  /** Builds a SAM over some of our structures that no SAM covers yet, not even one under construction. */
  private buildCoveringSam(): boolean {
    if (
      !this.usesSams() ||
      this.spendableGold() < this.getPerceivedCost(UnitType.SAMLauncher)
    ) {
      return false;
    }
    const sams = this.player.units(UnitType.SAMLauncher);
    const uncovered = this.player
      .units(SAM_PROTECTED_TYPES)
      .filter((u) => !this.isCoveredBySam(u.tile(), sams));
    if (uncovered.length === 0) return false;
    const tile = this.placement.samTileNear(
      uncovered.map((u) => u.tile()),
      this.game.config().samRange(1),
    );
    if (tile === null) return false;
    this.game.addExecution(
      new ConstructionExecution(this.player, UnitType.SAMLauncher, tile),
    );
    return true;
  }

  private upgradeStructure(
    structure: Unit | null,
    maxLevels = Infinity,
  ): boolean {
    if (structure === null) {
      return false;
    }
    // canUpgradeUnit was already checked by the caller and is checked again in UpgradeStructureExecution
    this.game.addExecution(
      new UpgradeStructureExecution(
        this.player,
        structure.id(),
        Math.min(this.upgradeAmount(structure.type()), maxLevels),
      ),
    );
    return true;
  }

  /** Hard & Impossible first bring the SAM guarding the most structure levels up to where a hydrogen bomb can't outrange it. */
  private upgradeSam(): boolean {
    if (this.isHardOrImpossible()) {
      const sam = this.samProtectingMost(SAM_HYDRO_PROOF_LEVEL);
      if (sam !== null) {
        return this.upgradeStructure(sam, SAM_HYDRO_PROOF_LEVEL - sam.level());
      }
    }
    return this.upgradeStructure(this.samProtectingMost());
  }

  private isHardOrImpossible(): boolean {
    const { difficulty } = this.game.config().gameConfig();
    return (
      difficulty === Difficulty.Hard || difficulty === Difficulty.Impossible
    );
  }

  /** Hard & Impossible with plenty of spare gold also put SAMs over land without structures, so no nuke lands unopposed. */
  private coversLandWithSams(): boolean {
    return (
      this.isHardOrImpossible() &&
      this.spendableGold() - this.getSaveUpTarget() >= SAM_LAND_COVER_SPARE_GOLD
    );
  }

  /** One level, or as many as the gold beyond the save-up target pays for and the structure ratios ask for. */
  private upgradeAmount(type: UnitType): number {
    const { difficulty } = this.game.config().gameConfig();
    // Cities set the ratios, so only gold and the per-order cap limit them
    const due =
      type === UnitType.City
        ? Infinity
        : this.levelsDue(
            type,
            this.cityCount(),
            this.placement.hasCoastalTiles(),
          );
    const max = Math.min(MAX_UPGRADES_AT_ONCE[difficulty], due);
    let spare = this.spendableGold() - this.getSaveUpTarget();
    let amount = 0;
    while (amount < max) {
      const cost = this.cost(type, amount);
      if (cost > spare) break;
      spare -= cost;
      amount++;
    }
    return Math.max(1, amount);
  }

  /** Whether to upgrade a SAM instead of building one, because SAMs already cover every structure (and, when rich, our land). */
  private shouldUpgradeSamInstead(): boolean {
    const { difficulty } = this.game.config().gameConfig();
    const chance = SAM_UPGRADE_WHEN_COVERED_CHANCE[difficulty];
    const sams = this.player.units(UnitType.SAMLauncher);
    if (chance === 0 || sams.length === 0) {
      return false;
    }
    for (const unit of this.player.units(SAM_PROTECTED_TYPES)) {
      if (!this.isCoveredBySam(unit.tile(), sams)) {
        return false;
      }
    }
    if (
      this.coversLandWithSams() &&
      randTerritoryTileArray(
        this.random,
        this.game,
        this.player,
        SAM_LAND_COVER_SAMPLES,
      ).some((tile) => !this.isCoveredBySam(tile, sams))
    ) {
      return false;
    }
    return chance === 100 || this.random.nextInt(0, 100) < chance;
  }

  private isCoveredBySam(tile: TileRef, sams: Unit[]): boolean {
    const game = this.game;
    const config = game.config();
    return sams.some(
      (sam) =>
        game.euclideanDistSquared(tile, sam.tile()) <=
        config.samRange(sam.level()) ** 2,
    );
  }

  /** The upgradable SAM below `belowLevel` with the most structure levels in range, i.e. the likeliest nuke target. */
  private samProtectingMost(belowLevel = Infinity): Unit | null {
    const game = this.game;
    const config = game.config();
    const protectable = this.player.units(SAM_PROTECTED_TYPES);
    let best: Unit | null = null;
    // With a level cap, skip SAMs that guard nothing
    let bestLevels = belowLevel === Infinity ? -1 : 0;
    for (const sam of this.player.units(UnitType.SAMLauncher)) {
      if (sam.level() >= belowLevel) continue;
      if (!this.player.canUpgradeUnit(sam)) continue;
      const rangeSquared = config.samRange(sam.level()) ** 2;
      let levels = 0;
      for (const unit of protectable) {
        if (
          game.euclideanDistSquared(unit.tile(), sam.tile()) <= rangeSquared
        ) {
          levels += unit.level();
        }
      }
      if (levels > bestLevels) {
        best = sam;
        bestLevels = levels;
      }
    }
    return best;
  }

  /**
   * Calculates total structure density across player's territory.
   */
  private getTotalStructureDensity(): number {
    const tilesOwned = this.player.numTilesOwned();
    return tilesOwned > 0
      ? this.player.units(DENSITY_STRUCTURE_TYPES).length / tilesOwned
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
}

export const NationStructureBehaviorSnapshot = snapshotType({
  name: "NationStructureBehavior",
  version: 1,
  schema: z.object({
    lastStructureTick: zInt().nullable(),
    placementsCount: zInt(),
    builtCrowdedMapFirstStructure: z.boolean(),
    hasHighStartingGold: z.boolean().nullable(),
    postSaveUpStartTick: zInt().nullable(),
  }),
});
