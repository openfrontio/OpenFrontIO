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
    if (this.mg.config().gameConfig().gameMode === GameMode.FFA) {
      this.checkWinnerFFA();
    } else {
      this.checkWinnerTeam();
    }
  }

  checkWinnerFFA(): void {
    if (this.mg === null) throw new Error("Not initialized");
    const game = this.mg;
    const sorted = game
      .players()
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());

    if (sorted.length === 0) {
      return;
    }

    const playerCount = game.players().length;
    const max = sorted[0];
    const numTilesWithoutFallout =
      game.numLandTiles() - game.numTilesWithFallout();

    const minTileCountToWin = numTilesWithoutFallout / playerCount;
    if (
      max.numTilesOwned() > minTileCountToWin &&
      (max.numTilesOwned() / numTilesWithoutFallout) * 100 >
        game.config().percentageTilesOwnedToWin()
    ) {
      game.setWinner(max, game.stats().stats());
      console.log(`${max.name()} has won the game`);
      this.active = false;
    } else if (game.runningVote() === undefined) {
      const alliances: Player[][] = this.findUniqueAlliances();
      alliances.forEach((alliance) => {
        let percentageOfLandOwned: number = 0;
        alliance.forEach((player) => {
          const playerLandOwnedPercent =
            (player.numTilesOwned() / numTilesWithoutFallout) * 100;
          percentageOfLandOwned += playerLandOwnedPercent;
        });
        if (percentageOfLandOwned > game.config().percentageTilesOwnedToWin()) {
          game.createVoteForPeace(alliance);
        }
      });
    } else if (game.runningVote() !== undefined && game.runningVote !== null) {
      let votePercentage = 0;
      const vote = game.runningVote();
      const voters = [...vote.results.keys()];
      voters.forEach((voter) => {
        if (vote.results.get(voter) === true) {
          const playerLandOwnedPercent =
            (voter.numTilesOwned() / numTilesWithoutFallout) * 100;
          votePercentage += playerLandOwnedPercent;
        }
      });

      if (votePercentage >= game.config().percentageTilesOwnedToWin()) {
        const players = voters.sort(
          (a, b) => b.numTilesOwned() - a.numTilesOwned(),
        );
        game.setWinner(players[0], game.stats().stats());
        this.active = false;
      }
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
    const numTilesWithoutFallout =
      this.mg.numLandTiles() - this.mg.numTilesWithFallout();
    const percentage = (max[1] / numTilesWithoutFallout) * 100;
    if (percentage > this.mg.config().percentageTilesOwnedToWin()) {
      if (max[0] === ColoredTeams.Bot) return;
      this.mg.setWinner(max[0], this.mg.stats().stats());
      console.log(`${max[0]} has won the game`);
      this.active = false;
    }
  }

  findUniqueAlliances(): Player[][] {
    if (this.mg === null) throw new Error("Not initialized");
    const players = this.mg.players();
    const alliances: Player[][] = [];
    players.forEach((player) => {
      if (player.allies().length > 0) {
        const alliance = [player, ...player.allies()];
        alliance.sort((a, b) => a.numTilesOwned() - b.numTilesOwned());
        alliances.push(alliance);
      }
    });
    return alliances;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
