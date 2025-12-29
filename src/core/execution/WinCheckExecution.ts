import { GameEvent } from "../EventBus";
import {
  ColoredTeams,
  Execution,
  Game,
  GameMode,
  Player,
  Team,
} from "../game/Game";

export class WinEvent implements GameEvent {
  constructor(public readonly winner: Player) {}
}

export class WinCheckExecution implements Execution {
  private active = true;

  private mg: Game | null = null;

  constructor() {}

  init(mg: Game, ticks: number) {
    this.mg = mg;
  }

  private getOverlord(player: Player): Player | null {
    return typeof (player as any).overlord === "function"
      ? (player as any).overlord()
      : null;
  }

  private getVassals(player: Player): Player[] {
    return typeof (player as any).vassals === "function"
      ? ((player as any).vassals() as Player[])
      : [];
  }

  // Count a player's owned tiles plus all of their vassals recursively.
  // Vassal tiles always count toward the overlord, regardless of team.
  private hierarchyTiles(player: Player): number {
    let total = player.numTilesOwned();
    for (const vassal of this.getVassals(player)) {
      total += this.hierarchyTiles(vassal);
    }
    return total;
  }

  // Only consider root players (no overlord) when attributing vassal territory.
  private rootPlayers(): Player[] {
    if (this.mg === null) return [];
    return this.mg.players().filter((p) => this.getOverlord(p) === null);
  }

  tick(ticks: number) {
    if (ticks % 10 !== 0) {
      return;
    }
    if (this.mg === null) throw new Error("Not initialized");

    if (this.mg.config().gameConfig().gameMode === GameMode.FFA) {
      this.checkWinnerFFA();
    } else {
      this.checkWinnerTeam();
    }
  }

  checkWinnerFFA(): void {
    if (this.mg === null) throw new Error("Not initialized");
    const sorted = this.rootPlayers().sort(
      (a, b) => this.hierarchyTiles(b) - this.hierarchyTiles(a),
    );
    if (sorted.length === 0) {
      return;
    }
    const max = sorted[0];
    const timeElapsed =
      (this.mg.ticks() - this.mg.config().numSpawnPhaseTurns()) / 10;
    const numTilesWithoutFallout =
      this.mg.numLandTiles() - this.mg.numTilesWithFallout();
    if (
      (this.hierarchyTiles(max) / numTilesWithoutFallout) * 100 >
        this.mg.config().percentageTilesOwnedToWin() ||
      (this.mg.config().gameConfig().maxTimerValue !== undefined &&
        timeElapsed - this.mg.config().gameConfig().maxTimerValue! * 60 >= 0)
    ) {
      this.mg.setWinner(max, this.mg.stats().stats());
      console.log(`${max.name()} has won the game`);
      this.active = false;
    }
  }

  checkWinnerTeam(): void {
    if (this.mg === null) throw new Error("Not initialized");
    const teamToTiles = new Map<Team, number>();
    // Attribute vassal land to the root overlord's team to avoid double counting.
    for (const root of this.rootPlayers()) {
      const team = root.team();
      if (team === null) continue;
      const tiles = this.hierarchyTiles(root);
      teamToTiles.set(team, (teamToTiles.get(team) ?? 0) + tiles);
    }
    const sorted = Array.from(teamToTiles.entries()).sort(
      (a, b) => b[1] - a[1],
    );
    if (sorted.length === 0) {
      return;
    }
    const max = sorted[0];
    const timeElapsed =
      (this.mg.ticks() - this.mg.config().numSpawnPhaseTurns()) / 10;
    const numTilesWithoutFallout =
      this.mg.numLandTiles() - this.mg.numTilesWithFallout();
    const percentage = (max[1] / numTilesWithoutFallout) * 100;
    if (
      percentage > this.mg.config().percentageTilesOwnedToWin() ||
      (this.mg.config().gameConfig().maxTimerValue !== undefined &&
        timeElapsed - this.mg.config().gameConfig().maxTimerValue! * 60 >= 0)
    ) {
      if (max[0] === ColoredTeams.Bot) return;
      this.mg.setWinner(max[0], this.mg.stats().stats());
      console.log(`${max[0]} has won the game`);
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
