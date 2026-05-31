import { GameEvent } from "../EventBus";
import {
  ColoredTeams,
  Execution,
  Game,
  GameMode,
  Player,
  PlayerType,
  RankedType,
  Team,
} from "../game/Game";

export class WinEvent implements GameEvent {
  constructor(public readonly winner: Player) {}
}

export class WinCheckExecution implements Execution {
  private active = true;

  private mg: Game | null = null;

  // Hard time limit (in seconds) to force a winner before the server's
  // maxGameDuration hard kill. 170mins (10 mins before 3hrs)
  private static readonly HARD_TIME_LIMIT_SECONDS = 170 * 60;

  // Grace period (in ticks) before declaring a winner due to disconnect
  // in 1v1 ranked. 300 ticks = 30 seconds at 100ms/tick.
  private static readonly DISCONNECT_GRACE_TICKS = 300;

  // The tick at which we first detected only one connected human in 1v1.
  // null means both players are currently connected (or grace not started).
  private disconnectGraceTick: number | null = null;

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
    const sorted = this.mg
      .players()
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    if (sorted.length === 0) {
      return;
    }

    if (this.mg.config().gameConfig().rankedType === RankedType.OneVOne) {
      const allHumans = sorted.filter((p) => p.type() === PlayerType.Human);
      const connectedHumans = allHumans.filter((p) => !p.isDisconnected());

      if (connectedHumans.length === 1 && allHumans.length === 2) {
        // One player is disconnected — start or continue grace period
        if (this.disconnectGraceTick === null) {
          this.disconnectGraceTick = this.mg.ticks();
          console.log(
            `1v1 disconnect grace period started at tick ${this.disconnectGraceTick}`,
          );
        }

        const elapsed = this.mg.ticks() - this.disconnectGraceTick;
        if (elapsed >= WinCheckExecution.DISCONNECT_GRACE_TICKS) {
          // Grace period expired — declare the connected player as winner
          this.mg.setWinner(connectedHumans[0], this.mg.stats().stats());
          console.log(
            `${connectedHumans[0].name()} has won the game (opponent disconnected for ${elapsed} ticks)`,
          );
          this.active = false;
          return;
        }
        // Still within grace period — wait for reconnect
        return;
      } else if (connectedHumans.length === 0 && allHumans.length === 2) {
        // Both players disconnected — don't reset grace, don't declare winner
        // The grace timer keeps running from when first disconnect was detected
        if (this.disconnectGraceTick !== null) {
          const elapsed = this.mg.ticks() - this.disconnectGraceTick;
          if (elapsed >= WinCheckExecution.DISCONNECT_GRACE_TICKS) {
            // Both disconnected past grace — pick the one with more tiles
            const winner = allHumans[0]; // already sorted by tiles desc
            this.mg.setWinner(winner, this.mg.stats().stats());
            console.log(
              `${winner.name()} has won the game (both disconnected, most tiles)`,
            );
            this.active = false;
            return;
          }
        }
        return;
      } else {
        // Both players are connected — reset grace timer
        if (this.disconnectGraceTick !== null) {
          console.log(`1v1 disconnect grace period reset (player reconnected)`);
          this.disconnectGraceTick = null;
        }
      }
    }

    const max = sorted[0];
    const timeElapsed = this.mg.elapsedGameSeconds();
    const numTilesWithoutFallout =
      this.mg.numLandTiles() - this.mg.numTilesWithFallout();

    if (numTilesWithoutFallout <= 0) {
      return;
    }
    if (
      (max.numTilesOwned() / numTilesWithoutFallout) * 100 >
        this.mg.config().percentageTilesOwnedToWin() ||
      (this.mg.config().gameConfig().maxTimerValue !== undefined &&
        timeElapsed - this.mg.config().gameConfig().maxTimerValue! * 60 >= 0) ||
      timeElapsed >= WinCheckExecution.HARD_TIME_LIMIT_SECONDS
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
    const timeElapsed = this.mg.elapsedGameSeconds();
    const numTilesWithoutFallout =
      this.mg.numLandTiles() - this.mg.numTilesWithFallout();
    if (numTilesWithoutFallout <= 0) {
      return;
    }
    const percentage = (max[1] / numTilesWithoutFallout) * 100;
    if (
      percentage > this.mg.config().percentageTilesOwnedToWin() ||
      (this.mg.config().gameConfig().maxTimerValue !== undefined &&
        timeElapsed - this.mg.config().gameConfig().maxTimerValue! * 60 >= 0) ||
      timeElapsed >= WinCheckExecution.HARD_TIME_LIMIT_SECONDS
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
