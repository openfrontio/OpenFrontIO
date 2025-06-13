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
    const vote = game.runningVote();
    if (
      max.numTilesOwned() > minTileCountToWin &&
      (max.numTilesOwned() / numTilesWithoutFallout) * 100 >
        game.config().percentageTilesOwnedToWin()
    ) {
      game.setWinner(max, game.stats().stats(), false);
      console.log(`${max.name()} has won the game`);
      this.active = false;
    } else if (vote === null) {
      const coalitions: Player[][] = this.getUniqueCoalitions();
      let indexOfLargestCoalition = 0;
      let largestPercentageOfLandOwned = 0;
      coalitions.forEach((coalition, index) => {
        let percentageOfLandOwned: number = 0;
        coalition.forEach((player) => {
          const playerLandOwnedPercent =
            (player.numTilesOwned() / numTilesWithoutFallout) * 100;
          percentageOfLandOwned += playerLandOwnedPercent;
        });
        if (percentageOfLandOwned > largestPercentageOfLandOwned) {
          indexOfLargestCoalition = index;
          largestPercentageOfLandOwned = percentageOfLandOwned;
        }
      });

      // We only want to create one vote, so that only the largest "coalition" is allowed to vote.
      if (
        largestPercentageOfLandOwned > game.config().percentageTilesOwnedToWin()
      ) {
        game.createVoteForPeace(coalitions[indexOfLargestCoalition]);
      }
    } else if (vote !== null) {
      let votePercentage = 0;
      const approvals: Player[] = [];
      vote.results.forEach((vote, voterID) => {
        const voter: Player = game.player(voterID);
        if (vote === true) {
          approvals.push(voter);
        }
      });
      approvals.forEach((voter) => {
        if (vote.results.get(voter.id()) === true) {
          const playerLandOwnedPercent =
            (voter.numTilesOwned() / numTilesWithoutFallout) * 100;
          votePercentage += playerLandOwnedPercent;
        }
      });
      if (votePercentage >= game.config().percentageTilesOwnedToWin()) {
        const players = approvals.sort(
          (a, b) => b.numTilesOwned() - a.numTilesOwned(),
        );
        game.setWinner(players[0], game.stats().stats(), true);
        this.active = false;
      } else if (game.getVoteExpireTick() <= game.ticks()) {
        game.setCurrentVote(null);
        game.setVoteExpireTick(null);
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
      this.mg.setWinner(max[0], this.mg.stats().stats(), false);
      console.log(`${max[0]} has won the game`);
      this.active = false;
    }
  }

  /**
   * Condenses an array of player groups, removing duplicates.
   * A duplicate group is one that contains the exact same set of players, regardless of order.
   * @param coalitions - The array of player arrays (Player[][]) to process.
   * @returns A new array containing only the unique "Coalitions"
   */
  getUniqueCoalitions(): Player[][] {
    if (this.mg === null) throw new Error("Not initialized");

    const uniqueCoalitionsMap = new Map<string, Player[]>();

    for (const player of this.mg.players()) {
      if (player.allies().length > 0) {
        const coalition = [player, ...player.allies()];
        const key = coalition
          .map((p) => p.smallID())
          .sort((a, b) => a - b)
          .join(",");

        uniqueCoalitionsMap.set(key, coalition);
      }
    }

    return Array.from(uniqueCoalitionsMap.values());
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
