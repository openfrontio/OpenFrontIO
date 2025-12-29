import {
  AllPlayers,
  Difficulty,
  Game,
  Gold,
  Player,
  PlayerType,
  UnitType,
} from "../../game/Game";
import {
  hierarchyTiles,
  hierarchyPlayers,
  hierarchyShoreTiles,
  sharesHierarchy,
  teamHierarchyTiles,
} from "../../game/HierarchyUtils";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { assertNever } from "../../Util";
import { MirvExecution } from "../MIRVExecution";
import { calculateTerritoryCenter, closestTwoTiles } from "../Util";
import { EMOJI_NUKE, NationEmojiBehavior } from "./NationEmojiBehavior";

export class NationMIRVBehavior {
  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private emojiBehavior: NationEmojiBehavior,
  ) {}

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

  private get victoryDenialTeamThreshold(): number {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return 0.9; // Only react right before the game ends (95%)
      case Difficulty.Medium:
        return 0.8;
      case Difficulty.Hard:
        return 0.7;
      case Difficulty.Impossible:
        return 0.6; // Reacts early
      default:
        assertNever(difficulty);
    }
  }

  private get victoryDenialIndividualThreshold(): number {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return 0.75; // Only react right before the game ends (80%)
      case Difficulty.Medium:
        return 0.65;
      case Difficulty.Hard:
        return 0.55;
      case Difficulty.Impossible:
        return 0.4; // Reacts early
      default:
        assertNever(difficulty);
    }
  }

  private get steamrollCityGapMultiplier(): number {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return 1.5; // Needs larger gap to trigger
      case Difficulty.Medium:
        return 1.3;
      case Difficulty.Hard:
        return 1.2;
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
        return 15; // Needs more cities to trigger
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
    if (inboundMIRVSender) {
      this.maybeSendMIRV(inboundMIRVSender);
      return true;
    }

    const victoryDenialTarget = this.selectVictoryDenialTarget();
    if (victoryDenialTarget) {
      this.maybeSendMIRV(victoryDenialTarget);
      return true;
    }

    const steamrollStopTarget = this.selectSteamrollStopTarget();
    if (steamrollStopTarget) {
      this.maybeSendMIRV(steamrollStopTarget);
      return true;
    }

    return false;
  }

  // MIRV Strategy Methods
  private selectCounterMirvTarget(): Player | null {
    if (this.player === null) throw new Error("not initialized");
    const attackers = this.getValidMirvTargetPlayers().filter((p) =>
      this.isInboundMIRVFrom(p),
    );
    if (attackers.length === 0) return null;
    const myHierarchyPlayers = hierarchyPlayers(this.game, this.player);
    const myShoreTiles = hierarchyShoreTiles(this.game, this.player);
    attackers.sort(
      (a, b) =>
        this.threatScore(b, myHierarchyPlayers, myShoreTiles) -
        this.threatScore(a, myHierarchyPlayers, myShoreTiles),
    );
    const best = attackers[0];
    if (best === undefined) return null;
    return this.threatScore(best, myHierarchyPlayers, myShoreTiles) > 0
      ? best
      : null;
  }

  private selectVictoryDenialTarget(): Player | null {
    if (this.player === null) throw new Error("not initialized");
    const totalLand = this.game.numLandTiles();
    if (totalLand === 0) return null;
    let best: { p: Player; severity: number } | null = null;
    const teamToTiles = teamHierarchyTiles(this.game);
    const myHierarchyPlayers = hierarchyPlayers(this.game, this.player);
    const myShoreTiles = hierarchyShoreTiles(this.game, this.player);
    for (const p of this.getValidMirvTargetPlayers()) {
      let severity = 0;
      const team = p.team();
      if (team !== null) {
        const teamTerritory = teamToTiles.get(team) ?? 0;
        const teamShare = teamTerritory / totalLand;
        if (teamShare >= this.victoryDenialTeamThreshold) {
          // Team is close to winning; pick the highest threat within that team.
          const score = this.threatScore(p, myHierarchyPlayers, myShoreTiles);
          severity = score > 0 ? score : 0;
        }
      } else {
        const share = hierarchyTiles(p) / totalLand;
        if (share >= this.victoryDenialIndividualThreshold) {
          const score = this.threatScore(p, myHierarchyPlayers, myShoreTiles);
          severity = score > 0 ? score : 0;
        }
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

  // MIRV Helper Methods
  private getValidMirvTargetPlayers(): Player[] {
    if (this.player === null) throw new Error("not initialized");

    return this.game.players().filter((p) => {
      return (
        p !== this.player &&
        p.isPlayer() &&
        p.type() !== PlayerType.Bot &&
        !this.player!.isOnSameTeam(p) &&
        !sharesHierarchy(this.player!, p)
      );
    });
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
      this.emojiBehavior.sendEmoji(AllPlayers, EMOJI_NUKE);
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

  private effectiveTroops(player: Player): number {
    const overlord = player.overlord?.() ?? null;
    const support =
      overlord !== null
        ? Math.floor(overlord.troops() * overlord.vassalSupportRatio())
        : 0;
    return player.troops() + support;
  }

  private threatScore(
    enemy: Player,
    myHierarchyPlayers: Player[],
    myShoreTiles: TileRef[],
  ): number {
    const effective = this.effectiveTroops(enemy);
    if (effective < 100_000) return -Infinity;

    const troopScore =
      effective <= 500_000
        ? effective
        : 500_000 + (effective - 500_000) * 0.2;

    const distance = this.hierarchyDistanceToEnemy(
      enemy,
      myHierarchyPlayers,
      myShoreTiles,
    );
    const proximity =
      distance === Infinity ? 0 : Math.max(0, 1 - distance / 250);
    const multiplier = 1 + 2.5 * proximity;
    return troopScore * multiplier;
  }

  private hierarchyDistanceToEnemy(
    enemy: Player,
    myHierarchyPlayers: Player[],
    myShoreTiles: TileRef[],
  ): number {
    const enemyHierarchyPlayers = hierarchyPlayers(this.game, enemy);
    for (const mine of myHierarchyPlayers) {
      for (const theirs of enemyHierarchyPlayers) {
        if (mine.sharesBorderWith(theirs)) return 0;
      }
    }

    const enemyShoreTiles = hierarchyShoreTiles(this.game, enemy);
    if (myShoreTiles.length === 0 || enemyShoreTiles.length === 0) {
      return Infinity;
    }
    const closest = closestTwoTiles(this.game, myShoreTiles, enemyShoreTiles);
    if (!closest) return Infinity;
    return this.game.manhattanDist(closest.x, closest.y);
  }
}
