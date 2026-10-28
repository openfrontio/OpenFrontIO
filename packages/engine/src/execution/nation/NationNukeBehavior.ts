import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Difficulty,
  GameMode,
  Gold,
  PlayerType,
  Relation,
  Structures,
  TerraNullius,
  Tick,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { euclDistFN } from "@openfront/engine-lib/game/GameMapImpl";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  readVersioned,
  snapshotType,
  Versioned,
  zInt,
  zPlayerRef,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { assertNever, boundingBoxTiles } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { Game, Player, Unit } from "../../game/Game";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { NukeExecution } from "../NukeExecution";
import { UpgradeStructureExecution } from "../UpgradeStructureExecution";
import { closestTwoTiles } from "../Util";
import { NationAttackBehavior } from "./NationAttackBehavior";
import { EMOJI_NUKE, NationEmojiBehavior } from "./NationEmojiBehavior";
import { isMirvWorthSavingFor } from "./NationMIRVBehavior";
import {
  blastHitsFriendlyLand,
  enemyLandBlastCoverage,
  isNukeAlreadyLandingNear,
  isTrajectoryInterceptableBySam,
  NukeType,
  planSamSalvo,
  siloToUpgradeForSalvo,
} from "./NationNukePlanning";
import {
  findRunawayLeader,
  isSaveUpWithinReach,
  randTerritoryTileArray,
} from "./NationUtils";

/**
 * Level-weighted structure density (sum of structure levels per tile owned)
 * above which the richest impossible nation will pre-emptively nuke a player.
 */
const HIGH_DENSITY_NUKE_THRESHOLD = 1 / 75;

/** Minimum sum of structure levels a player needs to qualify as a high-density nuke target. */
const MIN_LEVEL_SUM_FOR_HIGH_DENSITY_NUKE = 5;

/** Share of the non-fallout land above which every FFA nation nukes the crown. */
const CROWN_NEAR_WIN_SHARE = 0.5;

/** Minimum share of a blast that must hit enemy land (not water, fallout or unowned land). */
const MIN_BLAST_COVERAGE: Record<NukeType, number> = {
  [UnitType.AtomBomb]: 0.25,
  // Below this, an atom bomb on solid enemy land destroys more tiles per gold
  [UnitType.HydrogenBomb]: 0.4,
};

/** Tile score bonus for a blast that hits nothing but enemy land. */
const FULL_BLAST_COVERAGE_VALUE = 50_000;

/** A strike target has at least this share of our troops; weaker ones fall to plain attacks. */
const STRIKE_MIN_TROOP_RATIO = 0.5;

/** Hard & Impossible strike only if the follow-up attack can send this share of the target's troops. */
const STRIKE_MIN_STACK_RATIO = 0.5;

/** Tiles kept between a strike's blast and our land, so the front survives for the follow-up attack. */
const STRIKE_BORDER_MARGIN = 10;

/** Ticks a strike waits for its bomb to spawn before it's dropped. */
const STRIKE_SPAWN_TICKS = 10;

/** Hard & Impossible: ticks after a launch until that nuke's perceived price is back down to its real price */
const NUKE_PRICE_MEMORY_TICKS = 3000;

interface Strike {
  target: Player;
  tile: TileRef;
  tick: Tick;
  nuke: Unit | null;
}

export class NationNukeBehavior {
  private recentlySentNukes: [
    Tick,
    TileRef,
    UnitType.AtomBomb | UnitType.HydrogenBomb,
  ][] = [];
  private atomBombsLaunched = 0;
  private atomBombPerceivedCost = this.cost(UnitType.AtomBomb);
  private atomBombLastLaunch: Tick | null = null;
  private hydrogenBombsLaunched = 0;
  private hydrogenBombPerceivedCost = this.cost(UnitType.HydrogenBomb);
  private hydrogenBombLastLaunch: Tick | null = null;
  // Hard & Impossible: nukes in flight that we follow up with an attack when they land
  private strikes: Strike[] = [];

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private attackBehavior: NationAttackBehavior,
    private emojiBehavior: NationEmojiBehavior,
  ) {}

  snapshot(w: SnapshotWriter): Versioned {
    return w.versioned(NationNukeBehaviorSnapshot, {
      recentlySentNukes: this.recentlySentNukes.map(
        ([tick, tile, type]) =>
          [tick, tile, type] as [number, number, NukeType],
      ),
      atomBombsLaunched: this.atomBombsLaunched,
      atomBombPerceivedCost: this.atomBombPerceivedCost,
      atomBombLastLaunch: this.atomBombLastLaunch,
      hydrogenBombsLaunched: this.hydrogenBombsLaunched,
      hydrogenBombPerceivedCost: this.hydrogenBombPerceivedCost,
      hydrogenBombLastLaunch: this.hydrogenBombLastLaunch,
      strikes: this.strikes.map((s) => ({
        target: w.player(s.target),
        tile: s.tile,
        tick: s.tick,
        nuke: w.unitOrNull(s.nuke),
      })),
    });
  }

  /** Fills a prototype-only shell; only assigns (see README). */
  restoreSnapshot(
    raw: unknown,
    r: SnapshotReader,
    random: PseudoRandom,
    player: Player,
    attackBehavior: NationAttackBehavior,
    emojiBehavior: NationEmojiBehavior,
  ): void {
    const s = readVersioned(NationNukeBehaviorSnapshot, raw);
    this.random = random;
    this.game = r.game;
    this.player = player;
    this.attackBehavior = attackBehavior;
    this.emojiBehavior = emojiBehavior;
    this.recentlySentNukes = s.recentlySentNukes.map(([tick, tile, type]) => [
      tick,
      tile,
      type,
    ]);
    this.atomBombsLaunched = s.atomBombsLaunched;
    this.atomBombPerceivedCost = s.atomBombPerceivedCost;
    this.atomBombLastLaunch = s.atomBombLastLaunch;
    this.hydrogenBombsLaunched = s.hydrogenBombsLaunched;
    this.hydrogenBombPerceivedCost = s.hydrogenBombPerceivedCost;
    this.hydrogenBombLastLaunch = s.hydrogenBombLastLaunch;
    this.strikes = s.strikes.map((strike) => ({
      target: r.player(strike.target),
      tile: strike.tile,
      tick: strike.tick,
      nuke: r.unitOrNull(strike.nuke),
    }));
  }

  maybeSendNuke() {
    const silos = this.player.units(UnitType.MissileSilo);
    const config = this.game.config();
    if (
      silos.length === 0 ||
      config.isUnitDisabled(UnitType.MissileSilo) ||
      (config.isUnitDisabled(UnitType.AtomBomb) &&
        config.isUnitDisabled(UnitType.HydrogenBomb))
    ) {
      return;
    }

    const choice = this.chooseNukeTarget();
    if (choice === null) {
      return;
    }
    const { target: nukeTarget, strike } = choice;

    if (
      nukeTarget.type() === PlayerType.Bot || // Don't nuke tribes (as opposed to nations and humans)
      this.player.isOnSameTeam(nukeTarget) ||
      this.attackBehavior.shouldAttack(nukeTarget) === false
    ) {
      return;
    }

    // While saving up for a MIRV, Hard & Impossible only nuke back at players hitting them, with atom bombs
    const saving = this.isSavingForMirv();
    if (saving && !this.isHittingUs(nukeTarget)) {
      return;
    }

    const nukeTypes = this.nukeTypesToTry(saving);
    if (nukeTypes.length === 0) {
      return;
    }

    const structures = nukeTarget.units(Structures.types);
    const difficulty = this.game.config().gameConfig().difficulty;
    // Use more random tiles on Impossible difficulty to improve chances of finding a perfect SAM outranging spot
    const numRandomTiles = difficulty === Difficulty.Impossible ? 30 : 10;
    const randomTiles = randTerritoryTileArray(
      this.random,
      this.game,
      nukeTarget,
      numRandomTiles,
    );
    const candidates = new Set(
      randomTiles.concat(structures.map((u) => u.tile())),
    );
    this.removeOldNukeEvents();

    for (const nukeType of nukeTypes) {
      const tile = this.findBestNukeTile(
        nukeType,
        nukeTarget,
        candidates,
        silos,
        structures,
        strike,
      );
      if (tile !== null) {
        this.sendNuke(tile, nukeType, nukeTarget);
        if (strike && this.followsUpStrikes()) {
          this.strikes.push({
            target: nukeTarget,
            tile,
            tick: this.game.ticks(),
            nuke: null,
          });
        }
        return;
      }
    }
    if (difficulty === Difficulty.Impossible && !saving) {
      this.maybeDestroyEnemySam(nukeTarget);
    }
  }

  /** Hydrogen bomb first; on Hard & Impossible, an atom bomb if no spot is worth a hydrogen bomb. */
  private nukeTypesToTry(atomOnly: boolean): NukeType[] {
    const config = this.game.config();
    const difficulty = config.gameConfig().difficulty;
    const types: NukeType[] = [];
    if (
      !atomOnly &&
      !config.isUnitDisabled(UnitType.HydrogenBomb) &&
      this.player.gold() >= this.getPerceivedNukeCost(UnitType.HydrogenBomb)
    ) {
      types.push(UnitType.HydrogenBomb);
    }
    if (
      (types.length === 0 ||
        difficulty === Difficulty.Hard ||
        difficulty === Difficulty.Impossible) &&
      !config.isUnitDisabled(UnitType.AtomBomb) &&
      this.player.gold() >= this.getPerceivedNukeCost(UnitType.AtomBomb)
    ) {
      types.push(UnitType.AtomBomb);
    }
    return types;
  }

  private findBestNukeTile(
    nukeType: NukeType,
    nukeTarget: Player,
    candidates: Set<TileRef>,
    silos: Unit[],
    structures: Unit[],
    strike: boolean,
  ): TileRef | null {
    const difficulty = this.game.config().gameConfig().difficulty;
    const range = this.game.config().nukeMagnitudes(nukeType).outer;
    const scored: { tile: TileRef; score: number }[] = [];

    outer: for (const tile of candidates) {
      // Cheap pre-filter, blastHitsFriendlyLand checks the whole blast of the winner
      const boundingBox = boundingBoxTiles(this.game, tile, range)
        // Add radius / 2 in case there is a piece of unwanted territory inside the outer radius that we miss.
        .concat(boundingBoxTiles(this.game, tile, Math.floor(range / 2)));
      for (const t of boundingBox) {
        if (!this.isValidNukeTile(t, nukeTarget)) {
          continue outer;
        }
      }
      const spawnTile = this.player.canBuild(nukeType, tile);
      if (spawnTile === false) continue;

      // Above Easy, skip spots that are already being nuked or where the blast would be mostly wasted
      let coverage = 0;
      if (difficulty !== Difficulty.Easy) {
        if (isNukeAlreadyLandingNear(this.game, tile, nukeType)) continue;
        coverage = enemyLandBlastCoverage(
          this.game,
          this.player,
          tile,
          nukeType,
        );
        if (coverage < MIN_BLAST_COVERAGE[nukeType]) continue;
      }

      // On Hard & Impossible, avoid trajectories that can be intercepted by enemy SAMs
      if (
        (difficulty === Difficulty.Hard ||
          difficulty === Difficulty.Impossible) &&
        isTrajectoryInterceptableBySam(this.game, this.player, spawnTile, tile)
      ) {
        continue;
      }

      const value = this.nukeTileScore(tile, silos, structures, nukeType);
      // Impossible only nukes spots with structure value, unless it's after the troops
      if (
        difficulty === Difficulty.Impossible && !strike ? value <= 0 : value < 0
      ) {
        continue;
      }
      scored.push({
        tile,
        score: value + coverage * FULL_BLAST_COVERAGE_VALUE,
      });
    }
    // Stable sort: on ties the earlier candidate wins
    scored.sort((a, b) => b.score - a.score);
    const margin = strike ? STRIKE_BORDER_MARGIN : 0;
    const best = scored.find(
      ({ tile }) =>
        !blastHitsFriendlyLand(this.game, this.player, tile, nukeType, margin),
    );
    return best?.tile ?? null;
  }

  /** Who to nuke, and whether it's a strike: a nuke that softens a player up for our attack. */
  private chooseNukeTarget(): { target: Player; strike: boolean } | null {
    const target = this.findBestNukeTarget();
    if (target === null) return null;
    const { difficulty } = this.game.config().gameConfig();
    let strike: boolean;
    switch (difficulty) {
      case Difficulty.Easy:
        strike = false;
        break;
      case Difficulty.Medium:
        strike = this.ourTroopsAttacking(target) > 0;
        break;
      case Difficulty.Hard:
      case Difficulty.Impossible:
        strike = this.canStrike(target);
        break;
      default:
        assertNever(difficulty);
    }
    return { target, strike };
  }

  findBestNukeTarget(): Player | null {
    // On Hard & Impossible with only 2 players left, target the only other one
    const { difficulty: diff } = this.game.config().gameConfig();
    if (
      (diff === Difficulty.Hard || diff === Difficulty.Impossible) &&
      this.game.players().length === 2
    ) {
      const other = this.game.players().find((p) => p !== this.player);
      if (other) {
        return other;
      }
    }

    // Retaliate against incoming attacks (Most important!)
    const incomingAttackPlayer = this.attackBehavior.findIncomingAttackPlayer();
    if (incomingAttackPlayer) {
      return incomingAttackPlayer;
    }

    const incomingNukePlayer = this.findIncomingNukePlayer();
    if (incomingNukePlayer) {
      return incomingNukePlayer;
    }

    // In Teams, back up teammates in their fights before starting our own
    const teammateFightTarget = this.findTeammateFightTarget();
    if (teammateFightTarget) {
      return teammateFightTarget;
    }

    // On impossible difficulty, prioritize nuking the crown if they have more than 50% of the map
    const { difficulty, gameMode } = this.game.config().gameConfig();
    if (difficulty === Difficulty.Impossible && gameMode === GameMode.FFA) {
      const numTilesWithoutFallout =
        this.game.numLandTiles() - this.game.numTilesWithFallout();
      if (numTilesWithoutFallout > 0) {
        const sortedByTiles = this.game
          .players()
          .slice()
          .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
        const crown = sortedByTiles[0];

        if (crown && crown !== this.player && !this.player.isFriendly(crown)) {
          const crownShare = crown.numTilesOwned() / numTilesWithoutFallout;
          if (crownShare > CROWN_NEAR_WIN_SHARE) {
            return crown;
          }
        }
      }
    }

    // Soften up a neighbor about as strong as us before attacking it
    const strikeTarget = this.findStrikeTarget();
    if (strikeTarget !== null) {
      return strikeTarget;
    }

    // On Impossible, the richest nation hunts very high structure density targets
    // Restricting to the richest nation prevents every impossible nation
    // from piling onto the same compact player.
    if (
      diff === Difficulty.Impossible &&
      this.isRichestNation() &&
      this.random.chance(2)
    ) {
      const denseTarget = this.findHighDensityTarget();
      if (denseTarget !== null) {
        return denseTarget;
      }
    }

    // Assist allies, check their targets (this is basically the same as in assistAllies, but without sending emojis)
    for (const ally of this.player.allies()) {
      if (ally.targets().length === 0) continue;
      if (this.player.relation(ally) < Relation.Friendly) continue;

      for (const target of ally.targets()) {
        if (target === this.player) continue;
        if (this.player.isFriendly(target)) continue;
        // Found a valid ally target to nuke
        return target;
      }
    }

    // Find the most hated player
    // Ignore much weaker players (we don't need nukes to deal with them)
    const myMaxTroops = this.game.config().maxTroops(this.player);
    for (const relation of this.player.allRelationsSorted()) {
      if (relation.relation !== Relation.Hostile) continue;
      const other = relation.player;
      if (this.player.isFriendly(other)) continue;

      const otherMaxTroops = this.game.config().maxTroops(other);
      if (myMaxTroops >= otherMaxTroops * 2) continue;

      return other;
    }

    // In FFAs, nuke the crown if they're far enough ahead
    const crownTarget = this.findFFACrownTarget();
    if (crownTarget) {
      return crownTarget;
    }

    // In Teams, nuke the strongest team
    const teamTarget = this.findStrongestTeamTarget();
    if (teamTarget) {
      return teamTarget;
    }

    return null;
  }

  /** A player not much weaker than us: Medium one it's attacking, Hard & Impossible the strongest neighbor they can follow up on. */
  private findStrikeTarget(): Player | null {
    const myTroops = this.player.troops();
    const isCandidate = (other: Player | TerraNullius): other is Player =>
      other.isPlayer() &&
      other.type() !== PlayerType.Bot &&
      !this.player.isFriendly(other) &&
      other.troops() >= myTroops * STRIKE_MIN_TROOP_RATIO;

    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return null;
      case Difficulty.Medium:
        for (const attack of this.player.outgoingAttacks()) {
          const target = attack.target();
          if (isCandidate(target)) return target;
        }
        return null;
      case Difficulty.Hard:
      case Difficulty.Impossible: {
        let best: Player | null = null;
        for (const other of this.player.nearby()) {
          if (!isCandidate(other)) continue;
          if (best !== null && other.troops() <= best.troops()) continue;
          if (this.canStrike(other)) best = other;
        }
        return best;
      }
      default:
        assertNever(difficulty);
    }
  }

  /** Whether the attack right after our nuke could send enough troops into target by land. */
  private canStrike(target: Player): boolean {
    return (
      target.type() !== PlayerType.Bot &&
      !this.player.isFriendly(target) &&
      this.attackBehavior.strikeTroops(target) >=
        target.troops() * STRIKE_MIN_STACK_RATIO &&
      this.player.sharesBorderWith(target)
    );
  }

  private followsUpStrikes(): boolean {
    const { difficulty } = this.game.config().gameConfig();
    return (
      difficulty === Difficulty.Hard || difficulty === Difficulty.Impossible
    );
  }

  /** Called every tick: attacks a strike's target the moment its bomb, or its MIRV's last warhead, lands. */
  followUpStrikes(): void {
    if (this.followsUpStrikes() && this.player.unitCount(UnitType.MIRV) > 0) {
      this.trackMirvStrikes();
    }
    if (this.strikes.length === 0) return;
    const pending: Strike[] = [];
    for (const strike of this.strikes) {
      strike.nuke ??= this.findStrikeNuke(strike.tile);
      if (strike.nuke === null) {
        if (this.game.ticks() - strike.tick <= STRIKE_SPAWN_TICKS) {
          pending.push(strike);
        }
        continue;
      }
      if (strike.nuke.isActive()) {
        pending.push(strike);
        continue;
      }
      if (strike.nuke.type() === UnitType.MIRV) {
        // A MIRV deletes itself when it splits into warheads
        if (this.player.unitCount(UnitType.MIRVWarhead) > 0) {
          pending.push(strike);
          continue;
        }
      } else if (!strike.nuke.reachedTarget()) {
        // Intercepted bombs leave the target's troops alone
        continue;
      }
      if (strike.target.isAlive()) {
        this.attackBehavior.strike(strike.target);
      }
    }
    this.strikes = pending;
  }

  /** Our MIRVs at bordering players are strikes too: a MIRV leaves next to no troops to defend with. */
  private trackMirvStrikes(): void {
    for (const mirv of this.player.units(UnitType.MIRV)) {
      if (this.strikes.some((s) => s.nuke === mirv)) continue;
      const target = mirv.targetPlayer();
      const tile = mirv.targetTile();
      if (target === undefined || !target.isPlayer() || tile === undefined) {
        continue;
      }
      if (this.player.isFriendly(target)) continue;
      if (!this.player.sharesBorderWith(target)) continue;
      this.strikes.push({ target, tile, tick: this.game.ticks(), nuke: mirv });
    }
  }

  private findStrikeNuke(tile: TileRef): Unit | null {
    for (const nuke of this.player.units(
      UnitType.AtomBomb,
      UnitType.HydrogenBomb,
    )) {
      if (
        nuke.targetTile() === tile &&
        !this.strikes.some((s) => s.nuke === nuke)
      ) {
        return nuke;
      }
    }
    return null;
  }

  private ourTroopsAttacking(target: Player): number {
    let troops = 0;
    for (const attack of this.player.outgoingAttacks()) {
      if (attack.target() === target) troops += attack.troops();
    }
    return troops;
  }

  private findIncomingNukePlayer(): Player | null {
    const nukes = this.game.units(UnitType.AtomBomb, UnitType.HydrogenBomb);
    for (const nuke of nukes) {
      const sender = nuke.owner();
      if (this.player.isFriendly(sender)) continue;
      const targetTile = nuke.targetTile();
      if (
        targetTile !== undefined &&
        this.game.owner(targetTile) === this.player
      ) {
        return sender;
      }
    }
    return null;
  }

  private isRichestNation(): boolean {
    const myGold = this.player.gold();
    for (const other of this.game.players()) {
      if (other === this.player) continue;
      if (other.type() !== PlayerType.Nation) continue;
      if (other.gold() > myGold) return false;
    }
    return true;
  }

  private findHighDensityTarget(): Player | null {
    let bestTarget: Player | null = null;
    let bestDensity = HIGH_DENSITY_NUKE_THRESHOLD;
    for (const other of this.game.players()) {
      if (other === this.player) continue;
      if (other.type() === PlayerType.Bot) continue;
      if (this.player.isFriendly(other)) continue;
      const tilesOwned = other.numTilesOwned();
      if (tilesOwned === 0) continue;
      const levelSum = structureLevels(other);
      // Skip players with too few structures regardless of density
      if (levelSum < MIN_LEVEL_SUM_FOR_HIGH_DENSITY_NUKE) continue;
      const density = levelSum / tilesOwned;
      if (density > bestDensity) {
        bestDensity = density;
        bestTarget = other;
      }
    }
    return bestTarget;
  }

  private findFFACrownTarget(): Player | null {
    const { difficulty, gameMode } = this.game.config().gameConfig();
    if (gameMode !== GameMode.FFA) {
      return null;
    }

    if (this.game.players().length <= 1) {
      return null;
    }

    const sortedByTiles = this.game
      .players()
      .slice()
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    const firstPlace = sortedByTiles[0];

    // Don't target ourselves or allies
    if (firstPlace === this.player || this.player.isFriendly(firstPlace)) {
      return null;
    }

    const numTilesWithoutFallout =
      this.game.numLandTiles() - this.game.numTilesWithFallout();
    if (numTilesWithoutFallout <= 0) {
      return null;
    }

    const firstPlaceShare = firstPlace.numTilesOwned() / numTilesWithoutFallout;
    if (firstPlaceShare > CROWN_NEAR_WIN_SHARE) {
      return firstPlace;
    }

    // Below that, only a runaway leader that is far enough ahead of us.
    // Its neighbors react first, everyone else once the gap is twice as big.
    if (findRunawayLeader(this.game) !== firstPlace) {
      return null;
    }

    let threshold: number;
    switch (difficulty) {
      case Difficulty.Easy:
        return null; // Never notices a runaway leader
      case Difficulty.Medium:
        threshold = 0.3; // 30%
        break;
      case Difficulty.Hard:
        threshold = 0.2; // 20%
        break;
      case Difficulty.Impossible:
        threshold = 0.1; // 10%
        break;
      default:
        assertNever(difficulty);
    }
    if (!this.player.sharesBorderWith(firstPlace)) {
      threshold *= 2;
    }

    const myShare = this.player.numTilesOwned() / numTilesWithoutFallout;
    if (firstPlaceShare - myShare > threshold) {
      return firstPlace;
    }

    return null;
  }

  /** Medium and up: the enemy attacking our teammates hardest, else the one they attack hardest. */
  private findTeammateFightTarget(): Player | null {
    const { difficulty, gameMode } = this.game.config().gameConfig();
    if (gameMode !== GameMode.Team || difficulty === Difficulty.Easy) {
      return null;
    }
    const teammates = this.game
      .players()
      .filter((p) => p !== this.player && this.player.isOnSameTeam(p));
    const isEnemy = (p: Player | TerraNullius): p is Player =>
      p.isPlayer() && p.type() !== PlayerType.Bot && !this.player.isFriendly(p);

    let best: Player | null = null;
    let bestTroops = 0;
    for (const mate of teammates) {
      for (const attack of mate.incomingAttacks()) {
        const attacker = attack.attacker();
        if (isEnemy(attacker) && attack.troops() > bestTroops) {
          best = attacker;
          bestTroops = attack.troops();
        }
      }
    }
    if (best !== null) return best;
    for (const mate of teammates) {
      for (const attack of mate.outgoingAttacks()) {
        const target = attack.target();
        if (isEnemy(target) && attack.troops() > bestTroops) {
          best = target;
          bestTroops = attack.troops();
        }
      }
    }
    return best;
  }

  private findStrongestTeamTarget(): Player | null {
    if (this.game.config().gameConfig().gameMode !== GameMode.Team) {
      return null;
    }

    if (this.game.players().length <= 1) {
      return null;
    }

    const teamTiles = new Map<string, number>();
    const teamPlayers = new Map<string, Player[]>();

    for (const p of this.game.players()) {
      const team = p.team();
      if (team === null) continue;

      teamTiles.set(team, (teamTiles.get(team) ?? 0) + p.numTilesOwned());
      let players = teamPlayers.get(team);
      if (!players) {
        players = [];
        teamPlayers.set(team, players);
      }
      players.push(p);
    }

    const sortedTeams = Array.from(teamTiles.entries()).sort(
      (a, b) => b[1] - a[1],
    );

    if (sortedTeams.length === 0) {
      return null;
    }

    let strongestTeam = sortedTeams[0][0];
    if (strongestTeam === this.player.team()) {
      if (sortedTeams.length > 1) {
        strongestTeam = sortedTeams[1][0];
      } else {
        return null;
      }
    }

    const targetTeamPlayers = teamPlayers.get(strongestTeam)!;

    // Filter out friendly players
    const validTargets = targetTeamPlayers.filter(
      (p) => !this.player.isFriendly(p),
    );

    if (validTargets.length === 0) {
      return null;
    }

    // Hard & Impossible: one of the three players with the most structure levels
    const { difficulty } = this.game.config().gameConfig();
    if (
      difficulty === Difficulty.Hard ||
      difficulty === Difficulty.Impossible
    ) {
      const mostStructures = validTargets
        .map((p) => ({ p, levels: structureLevels(p) }))
        .filter(({ levels }) => levels > 0)
        .sort((a, b) => b.levels - a.levels)
        .slice(0, 3);
      if (mostStructures.length > 0) {
        return this.random.randElement(mostStructures).p;
      }
    }

    if (this.random.chance(2)) {
      // Strongest player
      return validTargets.reduce((prev, current) =>
        this.game.config().maxTroops(prev) >
        this.game.config().maxTroops(current)
          ? prev
          : current,
      );
    } else {
      // Random player
      return this.random.randElement(validTargets);
    }
  }

  // Each launch makes the next nuke of its type feel pricier, to save up for a MIRV and pace launches
  private getPerceivedNukeCost(type: NukeType): Gold {
    if (this.paysRealNukePrice()) {
      return this.cost(type);
    }
    // Easy & Medium keep the price up for good, so only while a MIRV is worth saving for
    if (
      !this.forgetsNukePrices() &&
      !isMirvWorthSavingFor(this.game, this.player)
    ) {
      return this.cost(type);
    }
    return this.inflatedNukeCost(type);
  }

  private paysRealNukePrice(): boolean {
    // If only 2 players left, use actual cost (no point saving for MIRV)
    if (this.game.players().length === 2) {
      return true;
    }

    // If MIRVs are disabled, return the actual cost
    if (this.game.config().isUnitDisabled(UnitType.MIRV)) {
      return true;
    }

    // Save up a limited amount in team games, synced with NationStructureBehavior
    // Saving up for a MIRV is not relevant
    if (
      this.game.config().gameConfig().gameMode === GameMode.Team &&
      this.player.gold() > this.cost(UnitType.HydrogenBomb)
    ) {
      return true;
    }

    // Return the actual cost if we already have enough gold to buy both a MIRV and a hydro
    if (this.player.gold() > this.mirvSaveUpTarget()) {
      return true;
    }

    // On Hard & Impossible, ignore perceived cost when under heavy attack
    // The nation is probably going to get destroyed soon, so go all-in on nukes
    const difficulty = this.game.config().gameConfig().difficulty;
    return (
      (difficulty === Difficulty.Hard ||
        difficulty === Difficulty.Impossible) &&
      this.isUnderHeavyAttack()
    );
  }

  /** Hard & Impossible in FFA: the perceived price falls back to the real one within minutes of the last launch. */
  private forgetsNukePrices(): boolean {
    const { difficulty, gameMode } = this.game.config().gameConfig();
    return (
      (difficulty === Difficulty.Hard ||
        difficulty === Difficulty.Impossible) &&
      gameMode !== GameMode.Team
    );
  }

  private inflatedNukeCost(type: NukeType): Gold {
    const real = this.cost(type);
    const [perceived, lastLaunch] =
      type === UnitType.AtomBomb
        ? [this.atomBombPerceivedCost, this.atomBombLastLaunch]
        : [this.hydrogenBombPerceivedCost, this.hydrogenBombLastLaunch];
    if (perceived <= real) return real;
    if (!this.forgetsNukePrices()) return perceived;
    const left =
      lastLaunch === null
        ? 0
        : NUKE_PRICE_MEMORY_TICKS - (this.game.ticks() - lastLaunch);
    if (left <= 0) return real;
    return (
      real +
      ((perceived - real) * BigInt(left)) / BigInt(NUKE_PRICE_MEMORY_TICKS)
    );
  }

  /** Hard & Impossible in FFA: whether they're holding gold back for a MIRV their income will soon reach. */
  private isSavingForMirv(): boolean {
    return (
      this.forgetsNukePrices() &&
      !this.paysRealNukePrice() &&
      isMirvWorthSavingFor(this.game, this.player) &&
      isSaveUpWithinReach(this.game, this.player, this.mirvSaveUpTarget())
    );
  }

  private mirvSaveUpTarget(): Gold {
    return this.cost(UnitType.MIRV) + this.cost(UnitType.HydrogenBomb);
  }

  /** Whether the player is attacking us or has a bomb flying at our land. */
  private isHittingUs(other: Player): boolean {
    if (this.player.incomingAttacks().some((a) => a.attacker() === other)) {
      return true;
    }
    return other
      .units([
        UnitType.AtomBomb,
        UnitType.HydrogenBomb,
        UnitType.MIRV,
        UnitType.MIRVWarhead,
      ])
      .some((nuke) => {
        const tile = nuke.targetTile();
        return tile !== undefined && this.game.owner(tile) === this.player;
      });
  }

  private isUnderHeavyAttack(): boolean {
    // Get the total incoming attack troops
    const incomingAttacks = this.player.incomingAttacks();
    let totalIncomingTroops = 0;
    for (const attack of incomingAttacks) {
      totalIncomingTroops += attack.troops();
    }

    const myTroops = this.player.troops();

    return totalIncomingTroops >= myTroops;
  }

  private removeOldNukeEvents() {
    const maxAge = 600; // 600 ticks = 1 minute
    const tick = this.game.ticks();
    while (
      this.recentlySentNukes.length > 0 &&
      this.recentlySentNukes[0][0] + maxAge < tick
    ) {
      this.recentlySentNukes.shift();
    }
  }

  private isValidNukeTile(t: TileRef, nukeTarget: Player | null): boolean {
    const difficulty = this.game.config().gameConfig().difficulty;

    const owner = this.game.owner(t);
    if (owner === nukeTarget) return true;
    // On Hard & Impossible, allow TerraNullius (hit small islands) and other players unless they are teammates or allies (even AFK ones)
    if (
      (difficulty === Difficulty.Hard ||
        difficulty === Difficulty.Impossible) &&
      (!owner.isPlayer() || !this.player.isFriendly(owner, true))
    ) {
      return true;
    }
    // On Easy & Medium, only allow tiles owned by the target player (=> nuke away from the border) to reduce nuke usage
    return false;
  }

  private nukeTileScore(
    tile: TileRef,
    silos: Unit[],
    targets: Unit[],
    nukeType: UnitType.AtomBomb | UnitType.HydrogenBomb,
  ): number {
    const magnitude = this.game.config().nukeMagnitudes(nukeType);
    const dist = euclDistFN(tile, magnitude.outer, false);
    let tileValue = targets
      .filter((unit) => dist(this.game, unit.tile()))
      .map((unit): number => {
        const level = unit.level();
        switch (unit.type()) {
          case UnitType.City:
            return 25_000 * level;
          case UnitType.DefensePost:
            return 5_000 * level;
          case UnitType.MissileSilo:
            return 50_000 * level;
          case UnitType.Port:
            return 15_000 * level;
          case UnitType.Factory:
            return 15_000 * level;
          default:
            return 0;
        }
      })
      .reduce((prev, cur) => prev + cur, 0);

    const difficulty = this.game.config().gameConfig().difficulty;
    // On Easy, ignore SAMs entirely.
    // On Medium, apply a simple local SAM penalty.
    // On Hard & Impossible we rely on trajectory-based interception checks instead. See maybeSendNuke().
    if (difficulty === Difficulty.Medium) {
      const dist50 = euclDistFN(tile, 50, false);
      const hasSam = targets.some(
        (unit) =>
          unit.type() === UnitType.SAMLauncher &&
          dist50(this.game, unit.tile()),
      );
      if (hasSam) return -1;
    }

    // On Impossible difficulty and a hydrogen bomb, add value for SAMs that can be outranged
    if (
      difficulty === Difficulty.Impossible &&
      nukeType === UnitType.HydrogenBomb
    ) {
      const hydroMagnitude = this.game
        .config()
        .nukeMagnitudes(UnitType.HydrogenBomb);
      const nearbySams = this.game.nearbyUnits(
        tile,
        hydroMagnitude.outer,
        UnitType.SAMLauncher,
      );

      for (const sam of nearbySams) {
        const samLevel = sam.unit.level();
        if (samLevel >= 5) continue; // Can't outrange level 5+ SAMs

        const samRange = this.game.config().samRange(samLevel);
        const distToSam = Math.sqrt(
          this.game.euclideanDistSquared(tile, sam.unit.tile()),
        );

        // Check if we can outrange this SAM
        if (distToSam > samRange) {
          // Add significant value for destroying a SAM that we can outrange
          tileValue += 100_000 * samLevel;
        }
      }
    }

    // Prefer tiles that are closer to a silo (but preserve structure value)
    const siloTiles = silos.map((u) => u.tile());
    const result = closestTwoTiles(this.game, siloTiles, [tile]);
    if (result === null) throw new Error("Missing result");
    const { x: closestSilo } = result;
    const distanceSquared = this.game.euclideanDistSquared(tile, closestSilo);
    const distanceToClosestSilo = Math.sqrt(distanceSquared);
    const distancePenalty = distanceToClosestSilo * 30;
    const baseTileValue = tileValue;
    tileValue = Math.max(baseTileValue * 0.2, tileValue - distancePenalty); // Keep at least 20% of structure value

    // Don't target near recent targets
    tileValue -= this.recentlySentNukes
      .filter(([_tick, recentTile, recentNukeType]) => {
        const recentInnerRadius = this.game
          .config()
          .nukeMagnitudes(recentNukeType).inner;
        const distSquared = this.game.euclideanDistSquared(tile, recentTile);
        return distSquared <= recentInnerRadius * recentInnerRadius;
      })
      .map((_) => 1_000_000)
      .reduce((prev, cur) => prev + cur, 0);

    return tileValue;
  }

  private sendNuke(
    tile: TileRef,
    nukeType: UnitType.AtomBomb | UnitType.HydrogenBomb,
    targetPlayer: Player,
    waitTicks = 0,
  ) {
    const tick = this.game.ticks();
    this.recentlySentNukes.push([tick, tile, nukeType]);
    const perceived = this.inflatedNukeCost(nukeType);
    if (nukeType === UnitType.AtomBomb) {
      this.atomBombsLaunched++;
      // Increase perceived cost by 50% each time to simulate saving up for a MIRV (higher than hydro to make atom bombs less attractive for the lategame)
      this.atomBombPerceivedCost = (perceived * 150n) / 100n;
      this.atomBombLastLaunch = tick;
    } else if (nukeType === UnitType.HydrogenBomb) {
      this.hydrogenBombsLaunched++;
      // Increase perceived cost by 25% each time to simulate saving up for a MIRV
      this.hydrogenBombPerceivedCost = (perceived * 125n) / 100n;
      this.hydrogenBombLastLaunch = tick;
    }
    this.game.addExecution(
      new NukeExecution(nukeType, this.player, tile, null, -1, waitTicks),
    );
    this.emojiBehavior.maybeSendEmoji(targetPlayer, EMOJI_NUKE);
  }

  // On Impossible, when no spot is worth a nuke, overwhelm one of the target's SAMs with atom bombs
  private maybeDestroyEnemySam(nukeTarget: Player): void {
    if (this.game.config().isUnitDisabled(UnitType.AtomBomb)) {
      return;
    }

    // Don't launch another salvo if we already have atom bombs in flight
    const ourAtomBombs = this.player.units(UnitType.AtomBomb);
    if (ourAtomBombs.length > 0) {
      return;
    }

    const { salvo, failed } = planSamSalvo(this.game, this.player, nukeTarget);
    if (salvo !== null) {
      for (const waitTicks of salvo.waitTicks) {
        this.sendNuke(
          salvo.targetTile,
          UnitType.AtomBomb,
          nukeTarget,
          waitTicks,
        );
      }
      return;
    }

    // Couldn't destroy any SAM — upgrade silos only if capacity was the bottleneck.
    // If we only lack gold, don't waste it upgrading silos — just wait and save.
    const silo =
      failed === null
        ? null
        : siloToUpgradeForSalvo(this.game, this.player, failed);
    if (silo !== null) {
      this.game.addExecution(
        new UpgradeStructureExecution(this.player, silo.id()),
      );
    }
  }

  private cost(type: UnitType): Gold {
    return this.game.unitInfo(type).cost(this.game, this.player);
  }
}

function structureLevels(player: Player): number {
  let levels = 0;
  for (const s of player.units(Structures.types)) levels += s.level();
  return levels;
}

export const NationNukeBehaviorSnapshot = snapshotType({
  name: "NationNukeBehavior",
  version: 2,
  schema: z.object({
    recentlySentNukes: z.array(
      z.tuple([
        zInt(),
        zTile(),
        z.union([
          z.literal(UnitType.AtomBomb),
          z.literal(UnitType.HydrogenBomb),
        ]),
      ]),
    ),
    atomBombsLaunched: zInt(),
    atomBombPerceivedCost: z.bigint(),
    atomBombLastLaunch: zInt().nullable(),
    hydrogenBombsLaunched: zInt(),
    hydrogenBombPerceivedCost: z.bigint(),
    hydrogenBombLastLaunch: zInt().nullable(),
    strikes: z.array(
      z.object({
        target: zPlayerRef(),
        tile: zTile(),
        tick: zInt(),
        nuke: zRef().nullable(),
      }),
    ),
  }),
  migrations: {
    // v1 nations never followed up their nukes with attacks and never forgot nuke prices; the schema drops their isHydroNation
    1: (d) => ({
      ...d,
      atomBombLastLaunch: null,
      hydrogenBombLastLaunch: null,
      strikes: [],
    }),
  },
});
