import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  AllPlayers,
  Difficulty,
  Gold,
  PlayerType,
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
import { randTerritoryTileArray } from "./NationUtils";

// 30 seconds at 10 ticks/second
const MIRV_COOLDOWN_TICKS = 300;

/** Share of a MIRV's warheads that must get past SAMs for it to be worth saving for or launching, keyed by difficulty */
const MIN_MIRV_LEAK_SHARE: Record<Difficulty, number> = {
  [Difficulty.Easy]: 0, // Never checks
  [Difficulty.Medium]: 0.1,
  [Difficulty.Hard]: 0.2,
  [Difficulty.Impossible]: 0.25,
};

/** MirvExecution's warhead cap, and the target land per warhead its spacing works out to */
const MIRV_MAX_WARHEADS = 350;
const LAND_TILES_PER_MIRV_WARHEAD = 2000;

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

/** Whether a MIRV would get through at the land or city leader, the players nations MIRV. */
export function isMirvWorthSavingFor(game: Game, player: Player): boolean {
  let landLeader: Player | null = null;
  let cityLeader: Player | null = null;
  for (const p of validMirvTargets(game, player)) {
    if (landLeader === null || p.numTilesOwned() > landLeader.numTilesOwned()) {
      landLeader = p;
    }
    if (
      cityLeader === null ||
      p.unitCount(UnitType.City) > cityLeader.unitCount(UnitType.City)
    ) {
      cityLeader = p;
    }
  }
  if (landLeader !== null && mirvGetsThrough(game, player, landLeader)) {
    return true;
  }
  return (
    cityLeader !== null &&
    cityLeader !== landLeader &&
    mirvGetsThrough(game, player, cityLeader)
  );
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

  // Whole percent of the land, for exact integer comparison. One ladder for
  // teams and lone players: the win bar is 80% in every game mode. Rough
  // alignment only: the win check divides by non-fallout land and its bar
  // sinks during overtime; this divides by all land and stays fixed.
  private get victoryDenialThresholdPercent(): number {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return 75; // Only react right before the game ends (80%)
      case Difficulty.Medium:
        return 65;
      case Difficulty.Hard:
        return 55;
      case Difficulty.Impossible:
        return 40; // Reacts early
      default:
        assertNever(difficulty);
    }
  }

  private get steamrollCityGapMultiplier(): number {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return 2; // Needs larger gap to trigger
      case Difficulty.Medium:
        return 1.5;
      case Difficulty.Hard:
        return 1.25;
      case Difficulty.Impossible:
        return 1.15; // Reacts to smaller gaps
      default:
        assertNever(difficulty);
    }
  }

  private get steamrollMinLeaderCities(): number {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return 20; // Needs more cities to trigger
      case Difficulty.Medium:
      case Difficulty.Hard:
        return 10;
      case Difficulty.Impossible:
        return 8; // Reacts early
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

    const victoryDenialTarget = this.selectVictoryDenialTarget();
    if (victoryDenialTarget && this.isWorthMirving(victoryDenialTarget)) {
      this.maybeSendMIRV(victoryDenialTarget);
      return true;
    }

    const steamrollStopTarget = this.selectSteamrollStopTarget();
    if (steamrollStopTarget && this.isWorthMirving(steamrollStopTarget)) {
      this.maybeSendMIRV(steamrollStopTarget);
      return true;
    }

    return false;
  }

  private isWorthMirving(target: Player): boolean {
    return (
      !this.wasRecentlyMirved(target) &&
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

  private selectVictoryDenialTarget(): Player | null {
    if (this.player === null) throw new Error("not initialized");
    const totalLand = this.game.numLandTiles();
    if (totalLand === 0) return null;
    // Compared against tiles * 100; severity ranks by tile count, which
    // orders candidates the same as by share (same denominator).
    const scaledThreshold = totalLand * this.victoryDenialThresholdPercent;
    let best: { p: Player; severity: number } | null = null;
    for (const p of this.getValidMirvTargetPlayers()) {
      let severity = 0;
      const team = p.team();
      if (team !== null) {
        const teamMembers = this.game
          .players()
          .filter((x) => x.team() === team && x.isPlayer());
        const teamTerritory = teamMembers
          .map((x) => x.numTilesOwned())
          .reduce((a, b) => a + b, 0);
        if (teamTerritory * 100 >= scaledThreshold) {
          // Only consider the largest team member as the target when team exceeds threshold
          let largestMember: Player | null = null;
          let largestTiles = -1;
          for (const member of teamMembers) {
            const tiles = member.numTilesOwned();
            if (tiles > largestTiles) {
              largestTiles = tiles;
              largestMember = member;
            }
          }
          if (largestMember === p) {
            severity = teamTerritory;
          } else {
            severity = 0; // Skip non-largest members
          }
        }
      } else {
        const tiles = p.numTilesOwned();
        if (tiles * 100 >= scaledThreshold) severity = tiles;
      }
      if (severity > 0) {
        if (best === null || severity > best.severity) best = { p, severity };
      }
    }
    return best ? best.p : null;
  }

  private selectSteamrollStopTarget(): Player | null {
    if (this.player === null) throw new Error("not initialized");
    const validTargets = this.getValidMirvTargetPlayers();

    if (validTargets.length === 0) return null;

    const allPlayers = this.game
      .players()
      .filter((p) => p.isPlayer())
      .map((p) => ({ p, cityCount: this.countCities(p) }))
      .sort((a, b) => b.cityCount - a.cityCount);

    if (allPlayers.length < 2) return null;

    const topPlayer = allPlayers[0];

    if (topPlayer.cityCount <= this.steamrollMinLeaderCities) return null;

    const secondHighest = allPlayers[1].cityCount;

    const threshold = secondHighest * this.steamrollCityGapMultiplier;

    if (topPlayer.cityCount >= threshold) {
      return validTargets.some((p) => p === topPlayer.p) ? topPlayer.p : null;
    }

    return null;
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

  private countCities(p: Player): number {
    return p.unitCount(UnitType.City);
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
