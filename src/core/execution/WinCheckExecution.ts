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

  tick(ticks: number) {
    if (ticks % 10 !== 0) {
      return;
    }
    if (this.mg === null) throw new Error("Not initialized");

    const gameMode = this.mg.config().gameConfig().gameMode;
    if (gameMode === GameMode.FFA) {
      this.checkWinnerFFA();
    } else if (gameMode === GameMode.NukeWars) {
      this.checkWinnerNukeWars();
    } else {
      this.checkWinnerTeam();
    }
  }

  checkWinnerFFA(): void {
    if (this.mg === null) throw new Error("Not initialized");
    const sorted = this.mg
      .players()
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    if (sorted.length === 0) {
      return;
    }
    const max = sorted[0];
    const timeElapsed =
      (this.mg.ticks() - this.mg.config().numSpawnPhaseTurns()) / 10;
    const numTilesWithoutFallout =
      this.mg.numLandTiles() - this.mg.numTilesWithFallout();
    if (
      (max.numTilesOwned() / numTilesWithoutFallout) * 100 >
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
    for (const player of this.mg.players()) {
      const team = player.team();
      // Sanity check, team should not be null here
      if (team === null) continue;
      teamToTiles.set(
        team,
        (teamToTiles.get(team) ?? 0) + player.numTilesOwned(),
      );
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

  checkWinnerNukeWars(): void {
    if (this.mg === null) throw new Error("Not initialized");
    const teamToTiles = new Map<Team, number>();
    for (const player of this.mg.players()) {
      const team = player.team();
      // In Nuke Wars we require teams
      if (team === null) continue;
      teamToTiles.set(
        team,
        (teamToTiles.get(team) ?? 0) + player.numTilesOwned(),
      );
    }

    const numTilesWithoutFallout =
      this.mg.numLandTiles() - this.mg.numTilesWithFallout();

    // Check if any team has less than 5% territory
    const sorted = Array.from(teamToTiles.entries());
    for (const [team, tiles] of sorted) {
      const percentage = (tiles / numTilesWithoutFallout) * 100;
      if (percentage < 5 && team !== ColoredTeams.Bot) {
        // Find the other team (non-bot) that has more territory
        const otherTeam = sorted.find(
          ([t, _]) => t !== team && t !== ColoredTeams.Bot,
        );
        if (otherTeam) {
          this.mg.setWinner(otherTeam[0], this.mg.stats().stats());
          console.log(
            `${otherTeam[0]} has won the game by reducing ${team} territory below 5%`,
          );
          this.active = false;
          return;
        }
      }
    }

    // Also check if time has elapsed (inherited from team mode)
    const timeElapsed =
      (this.mg.ticks() - this.mg.config().numSpawnPhaseTurns()) / 10;
    if (
      this.mg.config().gameConfig().maxTimerValue !== undefined &&
      timeElapsed - this.mg.config().gameConfig().maxTimerValue! * 60 >= 0
    ) {
      // When time runs out, team with most territory wins
      const winner = sorted.reduce(
        (prev, curr) => {
          if (curr[0] === ColoredTeams.Bot) return prev;
          if (!prev || curr[1] > prev[1]) return curr;
          return prev;
        },
        null as [Team, number] | null,
      );

      if (winner) {
        this.mg.setWinner(winner[0], this.mg.stats().stats());
        console.log(
          `${winner[0]} has won the game by having most territory when time elapsed`,
        );
        this.active = false;
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
