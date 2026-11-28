import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  AllPlayers,
  Difficulty,
  Gold,
  PlayerType,
  Team,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  readVersioned,
  snapshotType,
  Versioned,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { assertNever } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { Game, Player, Unit } from "../../game/Game";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { MirvExecution } from "../MIRVExecution";
import { calculateTerritoryCenter } from "../Util";
import {
  EMOJI_NUKE,
  NationEmojiBehavior,
  respondToMIRV,
} from "./NationEmojiBehavior";
import { randTerritoryTileArray, runawayLeaderToNuke } from "./NationUtils";

// 30 seconds at 10 ticks/second
const MIRV_COOLDOWN_TICKS = 300;

/** Share of a MIRV's warheads that must get past SAMs for it to be worth saving for or launching, keyed by difficulty */
const MIN_MIRV_LEAK_SHARE: Record<Difficulty, number> = {
  [Difficulty.Easy]: 0, // Never checks
  [Difficulty.Medium]: 0.1,
  [Difficulty.Hard]: 0.2,
  [Difficulty.Impossible]: 0.25,
};

/** Least land a MIRV target needs, as a share of what the hydrogen bombs its price buys would blast, keyed by difficulty */
const MIN_MIRV_TARGET_LAND_SHARE: Record<Difficulty, number> = {
  [Difficulty.Easy]: 0, // Never checks
  [Difficulty.Medium]: 0.1,
  [Difficulty.Hard]: 0.2,
  [Difficulty.Impossible]: 0.2,
};

/** MirvExecution's warhead cap, and the target land per warhead its spacing works out to */
const MIRV_MAX_WARHEADS = 350;
const LAND_TILES_PER_MIRV_WARHEAD = 2000;

/**
 * Whole percent of the land without fallout, as the win check counts it (80% in every mode), from which
 * nations MIRV a player or team to deny the win; unlike the win bar, it doesn't sink during overtime
 */
const VICTORY_DENIAL_THRESHOLD_PERCENT: Record<Difficulty, number> = {
  [Difficulty.Easy]: 70,
  [Difficulty.Medium]: 60,
  [Difficulty.Hard]: 50,
  [Difficulty.Impossible]: 35,
};

/** Hard & Impossible MIRV a bordering rival with at least this share of their land, ahead of a land attack */
const RIVAL_MIN_TILE_RATIO = 0.5;

/** Target tiles sampled to estimate SAM coverage */
const MIRV_COVERAGE_SAMPLES = 40;

/** Estimated share of a MIRV's warheads at `target` that SAMs, each shooting its level in warheads, would miss */
export function mirvLeakShare(
  game: Game,
  attacker: Player,
  target: Player,
): number {
  const warheads = Math.min(
    MIRV_MAX_WARHEADS,
    Math.max(1, target.numTilesOwned() / LAND_TILES_PER_MIRV_WARHEAD),
  );
  // Own seed, so the estimate is a pure function of the game state
  const random = new PseudoRandom(game.ticks() * 1024 + target.smallID());
  const samples = randTerritoryTileArray(
    random,
    game,
    target,
    MIRV_COVERAGE_SAMPLES,
  );
  if (samples.length === 0) return 1;

  const config = game.config();
  const warheadsPerSample = warheads / samples.length;
  const warheadsInRange = new Map<Unit, number>();
  let coveredSamples = 0;
  for (const tile of samples) {
    let covered = false;
    for (const { unit: sam, distSquared } of game.nearbyUnits(
      tile,
      config.maxSamRange(),
      UnitType.SAMLauncher,
    )) {
      const owner = sam.owner();
      if (owner === attacker || owner.isFriendly(attacker)) continue;
      if (distSquared > config.samRange(sam.level()) ** 2) continue;
      warheadsInRange.set(
        sam,
        (warheadsInRange.get(sam) ?? 0) + warheadsPerSample,
      );
      covered = true;
    }
    if (covered) coveredSamples++;
  }

  let shots = 0;
  warheadsInRange.forEach((inRange, sam) => {
    shots += Math.min(sam.level(), inRange);
  });
  const intercepted = Math.min(coveredSamples * warheadsPerSample, shots);
  return 1 - intercepted / warheads;
}

/** Whether enough of a MIRV's warheads would get past the SAMs at `target`; Easy doesn't check. */
export function mirvGetsThrough(
  game: Game,
  attacker: Player,
  target: Player,
): boolean {
  const minLeakShare =
    MIN_MIRV_LEAK_SHARE[game.config().gameConfig().difficulty];
  return (
    minLeakShare === 0 || mirvLeakShare(game, attacker, target) >= minLeakShare
  );
}

/** Easy saves up for a MIRV whenever anyone could be MIRVed; the others while one would hit the land leader, to have it ready once a player gets close to winning. */
export function isMirvWorthSavingFor(game: Game, player: Player): boolean {
  const targets = validMirvTargets(game, player);
  if (game.config().gameConfig().difficulty === Difficulty.Easy) {
    return targets.length > 0;
  }
  let landLeader: Player | null = null;
  for (const p of targets) {
    if (landLeader === null || p.numTilesOwned() > landLeader.numTilesOwned()) {
      landLeader = p;
    }
  }
  const target = victoryDenialTarget(game, player) ?? landLeader;
  return (
    target !== null &&
    isBigEnoughForMirv(game, player, target) &&
    mirvGetsThrough(game, player, target)
  );
}

/** The player with the most land over the victory denial threshold, or a team's biggest member by the team's land. */
export function victoryDenialTarget(game: Game, player: Player): Player | null {
  const land = game.numLandTiles() - game.numTilesWithFallout();
  if (land <= 0) return null;
  // Compared against tiles * 100, for exact integer math
  const scaledThreshold =
    land *
    VICTORY_DENIAL_THRESHOLD_PERCENT[game.config().gameConfig().difficulty];
  const teams = new Map<Team, { tiles: number; biggest: Player }>();
  for (const p of game.players()) {
    const team = p.team();
    if (team === null) continue;
    const entry = teams.get(team);
    if (entry === undefined) {
      teams.set(team, { tiles: p.numTilesOwned(), biggest: p });
      continue;
    }
    entry.tiles += p.numTilesOwned();
    if (p.numTilesOwned() > entry.biggest.numTilesOwned()) entry.biggest = p;
  }
  let best: Player | null = null;
  let bestTiles = 0;
  for (const p of validMirvTargets(game, player)) {
    const team = p.team();
    const entry = team === null ? undefined : teams.get(team);
    if (entry !== undefined && entry.biggest !== p) continue;
    const tiles = entry?.tiles ?? p.numTilesOwned();
    if (tiles * 100 >= scaledThreshold && tiles > bestTiles) {
      best = p;
      bestTiles = tiles;
    }
  }
  return best;
}

/** Whether the target owns enough land for what a MIRV costs; Easy doesn't check. */
function isBigEnoughForMirv(
  game: Game,
  player: Player,
  target: Player,
): boolean {
  const config = game.config();
  const share = MIN_MIRV_TARGET_LAND_SHARE[config.gameConfig().difficulty];
  const hydroCost = game.unitInfo(UnitType.HydrogenBomb).cost(game, player);
  if (share === 0 || hydroCost === 0n) return true;
  const mirvCost = game.unitInfo(UnitType.MIRV).cost(game, player);
  const hydros = Number(mirvCost) / Number(hydroCost);
  const { outer } = config.nukeMagnitudes(UnitType.HydrogenBomb);
  return target.numTilesOwned() >= share * hydros * Math.PI * outer ** 2;
}

function validMirvTargets(game: Game, player: Player): Player[] {
  return game
    .players()
    .filter(
      (p) =>
        p !== player &&
        p.isPlayer() &&
        p.type() !== PlayerType.Bot &&
        !player.isOnSameTeam(p),
    );
}

export class NationMIRVBehavior {
  // Shared across all NationMIRVBehavior instances.
  // Tracks the last tick a MIRV was sent at each player, so multiple nations don't pile-on the same target.
  // Especially important for games with very high starting gold settings.

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private emojiBehavior: NationEmojiBehavior,
  ) {}

  /** No state of its own; the owner supplies the shared references. */
  snapshot(w: SnapshotWriter): Versioned {
    return w.versioned(NationMIRVBehaviorSnapshot, {});
  }

  /** Fills a prototype-only shell; only assigns (see README). */
  restoreSnapshot(
    raw: unknown,
    r: SnapshotReader,
    random: PseudoRandom,
    player: Player,
    emojiBehavior: NationEmojiBehavior,
  ): void {
    readVersioned(NationMIRVBehaviorSnapshot, raw);
    this.random = random;
    this.game = r.game;
    this.player = player;
    this.emojiBehavior = emojiBehavior;
  }

  private get hesitationOdds(): number {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return 2; // More likely to hesitate
      case Difficulty.Medium:
        return 4;
      case Difficulty.Hard:
        return 8;
      case Difficulty.Impossible:
        return 16; // Rarely hesitates
      default:
        assertNever(difficulty);
    }
  }

  considerMIRV(): boolean {
    if (this.player === null) throw new Error("not initialized");
    if (this.game.config().isUnitDisabled(UnitType.MIRV)) {
      return false;
    }
    if (this.player.units(UnitType.MissileSilo).length === 0) {
      return false;
    }
    if (this.player.gold() < this.cost(UnitType.MIRV)) {
      return false;
    }

    if (this.random.chance(this.hesitationOdds)) {
      return false;
    }

    const inboundMIRVSender = this.selectCounterMirvTarget();
    if (inboundMIRVSender && this.isWorthMirving(inboundMIRVSender)) {
      this.maybeSendMIRV(inboundMIRVSender);
      return true;
    }

    const denialTarget = victoryDenialTarget(this.game, this.player);
    if (denialTarget && this.isWorthMirving(denialTarget)) {
      this.maybeSendMIRV(denialTarget);
      return true;
    }

    const runawayLeader = runawayLeaderToNuke(this.game, this.player);
    if (runawayLeader && this.isWorthMirving(runawayLeader)) {
      this.maybeSendMIRV(runawayLeader);
      return true;
    }

    const rivalTarget = this.selectRivalTarget();
    if (rivalTarget && this.isWorthMirving(rivalTarget)) {
      this.maybeSendMIRV(rivalTarget);
      return true;
    }

    return false;
  }

  private isWorthMirving(target: Player): boolean {
    return (
      !this.wasRecentlyMirved(target) &&
      isBigEnoughForMirv(this.game, this.player, target) &&
      mirvGetsThrough(this.game, this.player, target)
    );
  }

  // MIRV Strategy Methods
  private selectCounterMirvTarget(): Player | null {
    if (this.player === null) throw new Error("not initialized");
    const attackers = this.getValidMirvTargetPlayers().filter((p) =>
      this.isInboundMIRVFrom(p),
    );
    if (attackers.length === 0) return null;
    attackers.sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    return attackers[0];
  }

  /** Hard & Impossible: the biggest bordering player about our size, wiped out by a MIRV and our attack when it lands. */
  private selectRivalTarget(): Player | null {
    const { difficulty } = this.game.config().gameConfig();
    if (
      difficulty !== Difficulty.Hard &&
      difficulty !== Difficulty.Impossible
    ) {
      return null;
    }
    const minTiles = this.player.numTilesOwned() * RIVAL_MIN_TILE_RATIO;
    let best: Player | null = null;
    for (const p of this.getValidMirvTargetPlayers()) {
      if (this.player.isFriendly(p) || p.numTilesOwned() < minTiles) continue;
      if (best !== null && p.numTilesOwned() <= best.numTilesOwned()) continue;
      if (this.player.sharesBorderWith(p)) best = p;
    }
    return best;
  }

  // MIRV Cooldown Methods
  private wasRecentlyMirved(target: Player): boolean {
    const lastTick = this.game.nationMirvTargets().get(target.id());
    if (lastTick === undefined) return false;
    return this.game.ticks() - lastTick < MIRV_COOLDOWN_TICKS;
  }

  private recordMirvHit(target: Player): void {
    this.game.nationMirvTargets().set(target.id(), this.game.ticks());
  }

  // MIRV Helper Methods
  private getValidMirvTargetPlayers(): Player[] {
    if (this.player === null) throw new Error("not initialized");
    return validMirvTargets(this.game, this.player);
  }

  private isInboundMIRVFrom(attacker: Player): boolean {
    if (this.player === null) throw new Error("not initialized");
    const enemyMirvs = attacker.units(UnitType.MIRV);
    for (const mirv of enemyMirvs) {
      const dst = mirv.targetTile();
      if (!dst) continue;
      if (!this.game.hasOwner(dst)) continue;
      const owner = this.game.owner(dst);
      if (owner === this.player) {
        return true;
      }
    }
    return false;
  }

  // MIRV Execution Methods
  private maybeSendMIRV(enemy: Player): void {
    if (this.player === null) throw new Error("not initialized");

    this.emojiBehavior.maybeSendAttackEmoji(enemy);

    const centerTile = this.calculateTerritoryCenter(enemy);
    if (centerTile && this.player.canBuild(UnitType.MIRV, centerTile)) {
      this.game.addExecution(new MirvExecution(this.player, centerTile));
      this.recordMirvHit(enemy);
      this.emojiBehavior.sendEmoji(AllPlayers, EMOJI_NUKE);
      respondToMIRV(this.game, this.random, enemy);
    }
  }

  private calculateTerritoryCenter(target: Player): TileRef | null {
    return calculateTerritoryCenter(this.game, target);
  }

  private cost(type: UnitType): Gold {
    if (this.player === null) throw new Error("not initialized");
    return this.game.unitInfo(type).cost(this.game, this.player);
  }
}

export const NationMIRVBehaviorSnapshot = snapshotType({
  name: "NationMIRVBehavior",
  version: 1,
  schema: z.object({}),
});
