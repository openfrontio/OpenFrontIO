import {
  AllPlayers,
  Difficulty,
  Game,
  Gold,
  Player,
  PlayerType,
  Unit,
  UnitType,
} from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { ConstructionExecution } from "../ConstructionExecution";
import {
  EMOJI_WARSHIP_RETALIATION,
  NationEmojiBehavior,
} from "./NationEmojiBehavior";

export class NationWarshipBehavior {
  // Track our transport ships we currently own
  private trackedTransportShips: Set<Unit> = new Set();
  // Track our trade ships we currently own
  private trackedTradeShips: Set<Unit> = new Set();

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private emojiBehavior: NationEmojiBehavior,
  ) {}

  trackShipsAndRetaliate(): void {
    this.trackTransportShipsAndRetaliate();
    this.trackTradeShipsAndRetaliate();
  }

  // Send out a warship if our transport ship got captured
  private trackTransportShipsAndRetaliate(): void {
    // Add any currently owned transport ships to our tracking set
    this.player
      .units(UnitType.TransportShip)
      .forEach((u) => this.trackedTransportShips.add(u));

    // Iterate tracked transport ships; if it got destroyed by an enemy: retaliate
    for (const ship of Array.from(this.trackedTransportShips)) {
      if (!ship.isActive()) {
        // Distinguish between arrival/retreat and enemy destruction
        if (ship.wasDestroyedByEnemy() && ship.destroyer() !== undefined) {
          this.maybeRetaliateWithWarship(ship.tile(), ship.destroyer()!);
        }
        this.trackedTransportShips.delete(ship);
      }
    }
  }

  // Send out a warship if our trade ship got captured
  private trackTradeShipsAndRetaliate(): void {
    // Add any currently owned trade ships to our tracking map
    this.player
      .units(UnitType.TradeShip)
      .forEach((u) => this.trackedTradeShips.add(u));

    // Iterate tracked trade ships; if we no longer own it, it was captured: retaliate
    for (const ship of Array.from(this.trackedTradeShips)) {
      if (!ship.isActive()) {
        this.trackedTradeShips.delete(ship);
        continue;
      }
      if (ship.owner().id() !== this.player.id()) {
        // Ship was ours and is now owned by someone else -> captured
        this.maybeRetaliateWithWarship(ship.tile(), ship.owner());
        this.trackedTradeShips.delete(ship);
      }
    }
  }

  private maybeRetaliateWithWarship(tile: TileRef, enemy: Player): void {
    const { difficulty } = this.game.config().gameConfig();
    // In Easy never retaliate. In Medium retaliate with 15% chance. Hard with 50%, Impossible with 80%.
    if (
      (difficulty === Difficulty.Medium && this.random.nextInt(0, 100) < 15) ||
      (difficulty === Difficulty.Hard && this.random.nextInt(0, 100) < 50) ||
      (difficulty === Difficulty.Impossible && this.random.nextInt(0, 100) < 80)
    ) {
      const canBuild = this.player.canBuild(UnitType.Warship, tile);
      if (canBuild === false) {
        return;
      }
      this.game.addExecution(
        new ConstructionExecution(this.player, UnitType.Warship, tile),
      );
      this.emojiBehavior.maybeSendEmoji(enemy, EMOJI_WARSHIP_RETALIATION);
    }
  }

  // Prevent warship infestations: if current player is one of the 3 richest and an enemy has too many warships, send a counter-warship.
  // What is a warship infestation? A player tries to dominate the entire ocean to block all trade and transport boats.
  counterWarshipInfestation(): void {
    if (!this.shouldCounterWarshipInfestation()) {
      return;
    }

    const isTeamGame = this.player.team() !== null;

    if (!this.isRichPlayer(isTeamGame)) {
      return;
    }

    const target = this.findWarshipInfestationCounterTarget(isTeamGame);
    if (target !== null) {
      this.buildCounterWarship(target);
    }
  }

  private shouldCounterWarshipInfestation(): boolean {
    // Only the smart nations can do this
    const { difficulty } = this.game.config().gameConfig();
    if (
      difficulty !== Difficulty.Hard &&
      difficulty !== Difficulty.Impossible
    ) {
      return false;
    }

    // Quit early if there aren't many warships in the game
    if (this.game.unitCount(UnitType.Warship) <= 10) {
      return false;
    }

    // Quit early if we can't afford a warship
    if (this.cost(UnitType.Warship) > this.player.gold()) {
      return false;
    }

    // Quit early if we don't have a port to send warships from
    if (this.player.units(UnitType.Port).length === 0) {
      return false;
    }

    // Don't send too many warships
    if (this.player.units(UnitType.Warship).length >= 10) {
      return false;
    }

    return true;
  }

  // Check if current player is one of the 3 richest (We don't want poor nations to use their precious gold on this)
  private isRichPlayer(isTeamGame: boolean): boolean {
    const players = this.game.players().filter((p) => {
      if (p.type() === PlayerType.Human) return false;
      return isTeamGame ? p.team() === this.player.team() : true;
    });
    const topThree = players
      .sort((a, b) => Number(b.gold() - a.gold()))
      .slice(0, 3);
    return topThree.some((p) => p.id() === this.player.id());
  }

  private findWarshipInfestationCounterTarget(
    isTeamGame: boolean,
  ): { player: Player; warship: Unit } | null {
    return isTeamGame
      ? this.findTeamGameWarshipTarget()
      : this.findFreeForAllWarshipTarget();
  }

  private findTeamGameWarshipTarget(): {
    player: Player;
    warship: Unit;
  } | null {
    const enemyTeamWarships = new Map<
      string,
      { count: number; team: string; players: Player[] }
    >();

    for (const p of this.game.players()) {
      // Skip friendly players (our team and allies)
      if (this.player.isFriendly(p) || p.id() === this.player.id()) {
        continue;
      }

      const team = p.team();
      if (team === null) continue;

      const teamKey = team.toString();
      const warshipCount = p.units(UnitType.Warship).length;

      if (!enemyTeamWarships.has(teamKey)) {
        enemyTeamWarships.set(teamKey, {
          count: 0,
          team: teamKey,
          players: [],
        });
      }
      const teamData = enemyTeamWarships.get(teamKey)!;
      teamData.count += warshipCount;
      teamData.players.push(p);
    }

    // Find team with more than 15 warships
    for (const [, teamData] of enemyTeamWarships.entries()) {
      if (teamData.count > 15) {
        // Find player in that team with most warships
        const playerWithMostWarships = teamData.players.reduce(
          (max, p) => {
            const count = p.units(UnitType.Warship).length;
            const maxCount = max ? max.units(UnitType.Warship).length : 0;
            return count > maxCount ? p : max;
          },
          null as Player | null,
        );

        if (playerWithMostWarships) {
          const warships = playerWithMostWarships.units(UnitType.Warship);
          if (warships.length > 3) {
            return {
              player: playerWithMostWarships,
              warship: this.random.randElement(warships),
            };
          }
        }
      }
    }

    return null;
  }

  private findFreeForAllWarshipTarget(): {
    player: Player;
    warship: Unit;
  } | null {
    const enemies = this.game
      .players()
      .filter((p) => !this.player.isFriendly(p) && p.id() !== this.player.id());

    for (const enemy of enemies) {
      const enemyWarships = enemy.units(UnitType.Warship);
      if (enemyWarships.length > 10) {
        return {
          player: enemy,
          warship: this.random.randElement(enemyWarships),
        };
      }
    }

    return null;
  }

  private buildCounterWarship(target: { player: Player; warship: Unit }): void {
    const canBuild = this.player.canBuild(
      UnitType.Warship,
      target.warship.tile(),
    );
    if (canBuild === false) {
      return;
    }

    this.game.addExecution(
      new ConstructionExecution(
        this.player,
        UnitType.Warship,
        target.warship.tile(),
      ),
    );
    this.emojiBehavior.sendEmoji(AllPlayers, EMOJI_WARSHIP_RETALIATION);
  }

  private cost(type: UnitType): Gold {
    return this.game.unitInfo(type).cost(this.game, this.player);
  }
}
