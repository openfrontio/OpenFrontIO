import { Gold, Player, PlayerType, Tick, UnitType } from "../../../game/Game";
import { TileRef } from "../../../game/GameMap";
import { MirvExecution } from "../../MIRVExecution";
import { BaseAdvisor } from "../core/BaseAdvisor";
import { ActionRecommendation, AdvisorPriority } from "../core/types";
import { calculateTerritoryCenter } from "../utils/utils";

/**
 * MIRV advisor handles MIRV strategy, targeting, and reserve management
 * Manages MIRV launches, counter-MIRV detection, victory denial, and economic thresholds
 */
export class MIRVAdvisor extends BaseAdvisor {
  /** MIRV Strategy Constants */
  private static readonly MIRV_COOLDOWN_TICKS = 600;
  private static readonly MIRV_HESITATION_ODDS = 7;
  private static readonly VICTORY_DENIAL_TEAM_THRESHOLD = 0.8;
  private static readonly VICTORY_DENIAL_INDIVIDUAL_THRESHOLD = 0.65;
  private static readonly STEAMROLL_CITY_GAP_MULTIPLIER = 1.8;

  /** MIRV Reserve Management Constants */
  private static readonly MIRV_RESERVE_MIN = 35_000_000n;
  private static readonly MIRV_RESERVE_TARGET = 40_000_000n;
  private static readonly MIRV_SAVING_URGENCY_MULTIPLIER = 0.5;

  private readonly lastMIRVSent: [Tick, TileRef][] = [];
  private mirvTargetsCache: {
    tick: number;
    players: Player[];
  } | null = null;

  /**
   * Analyze current game state and recommend MIRV actions
   */
  recommend(): ActionRecommendation | null {
    if (this.player.units(UnitType.MissileSilo).length === 0) return null;
    if (this.player.gold() < this.cost(UnitType.MIRV)) return null;

    this.removeOldMIRVEvents();
    if (this.lastMIRVSent.length > 0) return null;

    if (this.random.chance(MIRVAdvisor.MIRV_HESITATION_ODDS)) {
      this.triggerMIRVCooldown();
      return null;
    }

    // Check for counter-MIRV opportunity
    const counterTarget = this.selectCounterMirvTarget();
    if (counterTarget) {
      return this.createMIRVRecommendation(counterTarget, "Counter-MIRV");
    }

    // Check for victory denial opportunity
    const victoryDenialTarget = this.selectVictoryDenialTarget();
    if (victoryDenialTarget) {
      return this.createMIRVRecommendation(
        victoryDenialTarget,
        "Victory Denial",
      );
    }

    // Check for steamroll prevention
    const steamrollTarget = this.selectSteamrollStopTarget();
    if (steamrollTarget) {
      return this.createMIRVRecommendation(
        steamrollTarget,
        "Steamroll Prevention",
      );
    }

    return null;
  }

  /**
   * Get the current MIRV reserve threshold for economic planning
   */
  getMIRVReserveThreshold(): Gold {
    if (!this.shouldMaintainMIRVReserve()) {
      return 0n;
    }

    const otherPlayers = this.game
      .players()
      .filter((p) => p !== this.player && p.isPlayer() && p.isAlive());

    if (otherPlayers.length === 0) {
      return MIRVAdvisor.MIRV_RESERVE_MIN;
    }

    const otherGoldLevels = otherPlayers.map((p) => Number(p.gold()));
    const sortedGoldLevels = otherGoldLevels.sort((a, b) => b - a);

    const maxOtherGold = sortedGoldLevels[0];
    const avgOtherGold =
      otherGoldLevels.reduce((sum, gold) => sum + gold, 0) /
      otherGoldLevels.length;

    const top3Count = Math.min(3, sortedGoldLevels.length);
    const top3Avg =
      sortedGoldLevels
        .slice(0, top3Count)
        .reduce((sum, gold) => sum + gold, 0) / top3Count;

    const weightedBenchmark = top3Avg * 0.6 + avgOtherGold * 0.4;

    const baseThreshold = MIRVAdvisor.MIRV_RESERVE_MIN;
    const topPlayerGap = maxOtherGold - weightedBenchmark;
    const topGapRatio =
      weightedBenchmark > 0 ? topPlayerGap / weightedBenchmark : 0;

    const economicLevel = weightedBenchmark;
    const levelRatio = economicLevel / 20_000_000;

    let competitiveMultiplier = 1.0;

    if (topGapRatio > 0.6) {
      competitiveMultiplier = 1.3;
    } else if (topGapRatio > 0.3) {
      competitiveMultiplier = 1.2;
    } else if (topGapRatio > 0.1) {
      competitiveMultiplier = 1.1;
    }

    if (levelRatio > 1.5) {
      competitiveMultiplier = Math.max(competitiveMultiplier, 1.2);
    } else if (levelRatio > 1.0) {
      competitiveMultiplier = Math.max(competitiveMultiplier, 1.1);
    }

    if (maxOtherGold >= 25_000_000) {
      competitiveMultiplier = Math.max(competitiveMultiplier, 1.4);
    } else if (top3Avg >= 20_000_000) {
      competitiveMultiplier = Math.max(competitiveMultiplier, 1.2);
    }

    const competitiveThreshold = Math.max(
      Number(baseThreshold),
      weightedBenchmark * competitiveMultiplier,
      maxOtherGold * 0.7,
    );

    const maxThreshold = Number(MIRVAdvisor.MIRV_RESERVE_TARGET) * 1.5;
    const finalThreshold = Math.min(competitiveThreshold, maxThreshold);

    return BigInt(Math.floor(finalThreshold));
  }

  /**
   * Check if missile silos should be prioritized based on game state
   */
  shouldPrioritizeMissileSilos(): boolean {
    const currentSilos = this.player.units(UnitType.MissileSilo).length;
    const gameTime = this.game.ticks();
    const territorySize = this.player.numTilesOwned();

    if (currentSilos === 0 && gameTime > 60 * 5) {
      return true;
    }

    if (currentSilos < 2 && gameTime > 60 * 10) {
      return true;
    }

    const gold = Number(this.player.gold());
    if (currentSilos < 2 && gold > 10_000_000 && territorySize > 50) {
      return true;
    }

    const otherPlayers = this.game
      .players()
      .filter((p) => p !== this.player && p.isPlayer() && p.isAlive());
    if (otherPlayers.length > 0) {
      const maxOtherGold = Math.max(
        ...otherPlayers.map((p) => Number(p.gold())),
      );
      if (maxOtherGold > 20_000_000 && currentSilos < 2) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate how much gold can be spent considering MIRV reserves
   */
  getSpendableGold(): Gold {
    const totalGold = this.player.gold();
    const reserveThreshold = this.getMIRVReserveThreshold();

    if (totalGold <= reserveThreshold) {
      return 0n;
    }

    return totalGold - reserveThreshold;
  }

  /**
   * Check if the player can afford a cost considering MIRV reserves
   */
  canAffordWithReserve(cost: Gold): boolean {
    return this.getSpendableGold() >= cost;
  }

  private shouldMaintainMIRVReserve(): boolean {
    return this.player.units(UnitType.MissileSilo).length > 0;
  }

  private selectCounterMirvTarget(): Player | null {
    const attackers = this.getValidMirvTargetPlayers().filter((p) =>
      this.isInboundMIRVFrom(p),
    );
    if (attackers.length === 0) return null;
    attackers.sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    return attackers[0];
  }

  private selectVictoryDenialTarget(): Player | null {
    const totalLand = this.game.numLandTiles();
    if (totalLand === 0) return null;
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
        const teamShare = teamTerritory / totalLand;
        if (teamShare >= MIRVAdvisor.VICTORY_DENIAL_TEAM_THRESHOLD) {
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
            severity = teamShare;
          } else {
            severity = 0;
          }
        }
      } else {
        const share = p.numTilesOwned() / totalLand;
        if (share >= MIRVAdvisor.VICTORY_DENIAL_INDIVIDUAL_THRESHOLD)
          severity = share;
      }
      if (severity > 0) {
        if (best === null || severity > best.severity) best = { p, severity };
      }
    }
    return best ? best.p : null;
  }

  private selectSteamrollStopTarget(): Player | null {
    const validTargets = this.getValidMirvTargetPlayers()
      .map((p) => ({ p, cityCount: this.countCities(p) }))
      .sort((a, b) => b.cityCount - a.cityCount);

    if (validTargets.length === 0) return null;

    const topTarget = validTargets[0];
    const allPlayers = this.game
      .players()
      .filter((p) => p.isPlayer())
      .map((p) => ({ p, cityCount: this.countCities(p) }))
      .sort((a, b) => b.cityCount - a.cityCount);

    if (allPlayers.length < 2) return null;

    let secondHighest = 0;
    for (const { p, cityCount } of allPlayers) {
      if (p !== topTarget.p) {
        secondHighest = cityCount;
        break;
      }
    }

    const threshold = secondHighest * MIRVAdvisor.STEAMROLL_CITY_GAP_MULTIPLIER;

    if (topTarget.cityCount >= threshold) {
      return topTarget.p;
    }

    return null;
  }

  private getValidMirvTargetPlayers(): Player[] {
    const MIRV_TARGETS_CACHE_TICKS = 2 * 10;
    if (
      this.mirvTargetsCache &&
      this.game.ticks() - this.mirvTargetsCache.tick < MIRV_TARGETS_CACHE_TICKS
    ) {
      return this.mirvTargetsCache.players;
    }

    const players = this.game.players().filter((p) => {
      return (
        p !== this.player &&
        p.isPlayer() &&
        p.type() !== PlayerType.Bot &&
        !this.player.isOnSameTeam(p)
      );
    });

    this.mirvTargetsCache = { tick: this.game.ticks(), players };
    return players;
  }

  private isInboundMIRVFrom(attacker: Player): boolean {
    const enemyMirvs = attacker.units(UnitType.MIRV);
    for (const mirv of enemyMirvs) {
      const dst = mirv.targetTile();
      if (!dst) continue;
      if (!this.game.hasOwner(dst)) continue;
      const owner = this.game.owner(dst);
      if (owner === this.player) return true;
    }
    return false;
  }

  private countCities(p: Player): number {
    return p.unitCount(UnitType.City);
  }

  private createMIRVRecommendation(
    target: Player,
    reason: string,
  ): ActionRecommendation | null {
    const enemyTiles = Array.from(target.tiles());
    if (enemyTiles.length === 0) return null;

    const centerTile = calculateTerritoryCenter(this.game, target);
    let targetTile: TileRef | null = null;

    if (centerTile && this.player.canBuild(UnitType.MIRV, centerTile)) {
      targetTile = centerTile;
    } else {
      for (const tile of enemyTiles) {
        if (this.player.canBuild(UnitType.MIRV, tile)) {
          targetTile = tile;
          break;
        }
      }
    }

    if (!targetTile) return null;

    return {
      execute: () => {
        this.sendMIRV(targetTile!);
      },
      score: this.calculateMIRVScore(target, reason),
      priority: AdvisorPriority.High,
      description: `MIRV ${reason} against ${target.id()}`,
    };
  }

  private calculateMIRVScore(target: Player, reason: string): number {
    const baseScore = 200;
    const territoryBonus = target.numTilesOwned() * 2;
    const reasonMultiplier = reason === "Counter-MIRV" ? 1.5 : 1.0;
    return Math.floor((baseScore + territoryBonus) * reasonMultiplier);
  }

  private sendMIRV(tile: TileRef): void {
    this.triggerMIRVCooldown(tile);
    this.game.addExecution(new MirvExecution(this.player, tile));
  }

  private triggerMIRVCooldown(tile?: TileRef): void {
    this.removeOldMIRVEvents();
    const tick = this.game.ticks();
    const cooldownTile =
      tile ?? Array.from(this.player.tiles())[0] ?? this.game.ref(0, 0);
    this.lastMIRVSent.push([tick, cooldownTile]);
  }

  private removeOldMIRVEvents() {
    const maxAge = MIRVAdvisor.MIRV_COOLDOWN_TICKS;
    const tick = this.game.ticks();
    while (
      this.lastMIRVSent.length > 0 &&
      this.lastMIRVSent[0][0] + maxAge <= tick
    ) {
      this.lastMIRVSent.shift();
    }
  }
}
