import { GameEvent } from "../EventBus";
import {
  computeCompetitiveScores,
  TeamRawMetrics,
} from "../game/CompetitiveScoring";
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
import {
  computeTeamTiles,
  findCrownTeam,
  normalizeCrownSeconds,
} from "../game/TeamUtils";

export class WinEvent implements GameEvent {
  constructor(public readonly winner: Player) {}
}

export class WinCheckExecution implements Execution {
  private active = true;

  private mg: Game | null = null;
  private knownAliveTeams: Set<Team> = new Set();

  constructor() {}

  init(mg: Game, ticks: number) {
    this.mg = mg;
    // Seed alive teams so eliminations on the very first tick are detected.
    this.knownAliveTeams = this.computeAliveTeams();
  }

  tick(ticks: number) {
    if (ticks % 10 !== 0) {
      return;
    }
    if (this.mg === null) throw new Error("Not initialized");

    if (this.mg.config().gameConfig().gameMode === GameMode.FFA) {
      this.checkWinnerFFA();
    } else {
      if (this.mg.config().gameConfig().competitiveScoring) {
        this.trackTeamEliminations();
      }
      this.checkWinnerTeam();
    }
  }

  private computeAliveTeams(): Set<Team> {
    const alive = new Set<Team>();
    if (this.mg === null) return alive;
    for (const player of this.mg.players()) {
      const team = player.team();
      if (team === null || team === ColoredTeams.Bot) continue;
      if (player.numTilesOwned() > 0) {
        alive.add(team);
      }
    }
    return alive;
  }

  private trackTeamEliminations(): void {
    if (this.mg === null) return;

    const currentAlive = this.computeAliveTeams();

    // Record teams that just died
    for (const team of this.knownAliveTeams) {
      if (!currentAlive.has(team)) {
        this.mg.recordTeamElimination(team);
      }
    }

    this.knownAliveTeams = currentAlive;
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
      const humans = sorted.filter(
        (p) => p.type() === PlayerType.Human && !p.isDisconnected(),
      );
      if (humans.length === 1) {
        this.mg.setWinner(humans[0], this.mg.stats().stats());
        console.log(`${humans[0].name()} has won the game`);
        this.active = false;
        return;
      }
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
    for (const player of this.mg.allPlayers()) {
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
      // Pick the top non-Bot team as the winner.
      const winner = sorted.find((t) => t[0] !== ColoredTeams.Bot);
      if (winner === undefined) return;

      const scores = this.mg.config().gameConfig().competitiveScoring
        ? this.computeScores(this.mg, teamToTiles, numTilesWithoutFallout)
        : undefined;
      this.mg.setWinner(winner[0], this.mg.stats().stats(), scores);
      console.log(`${winner[0]} has won the game`);
      this.active = false;
    }
  }

  private computeScores(
    mg: Game,
    teamToTiles: Map<Team, number>,
    numTilesWithoutFallout: number,
  ) {
    const eliminationOrder = mg.teamEliminationOrder();
    const allTeams = Array.from(teamToTiles.keys()).filter(
      (t) => t !== ColoredTeams.Bot,
    );
    const totalGameTicks = mg.ticks() - mg.config().numSpawnPhaseTurns();

    // Rank surviving teams by current tiles (more tiles = better placement)
    const survivingTeams = allTeams.filter(
      (t) => !eliminationOrder.includes(t),
    );
    survivingTeams.sort(
      (a, b) => (teamToTiles.get(b) ?? 0) - (teamToTiles.get(a) ?? 0),
    );

    const nonBotTiles = computeTeamTiles(mg.allPlayers());
    const crownHolder = findCrownTeam(nonBotTiles);
    const elapsedSeconds = Math.floor(Math.max(0, totalGameTicks) / 10);
    const allCrownTicks = mg.allTeamCrownTicks();
    const teamCrownSeconds = normalizeCrownSeconds(
      allTeams,
      allCrownTicks,
      crownHolder,
      elapsedSeconds,
    );

    const metrics: TeamRawMetrics[] = allTeams.map((team) => {
      const peakTiles = mg.teamPeakTiles(team);
      const peakTilePercentage = (peakTiles / numTilesWithoutFallout) * 100;
      const crownTicks = allCrownTicks.get(team) ?? 0;
      const crownRatio = totalGameTicks > 0 ? crownTicks / totalGameTicks : 0;

      const elimIndex = eliminationOrder.indexOf(team);
      let placementRank: number;
      if (elimIndex === -1) {
        // Surviving teams ranked by current tiles (best = highest rank)
        const survivalIndex = survivingTeams.indexOf(team);
        placementRank =
          eliminationOrder.length + (survivingTeams.length - survivalIndex);
      } else {
        // First eliminated = 1, second = 2, etc.
        placementRank = elimIndex + 1;
      }

      const crownTimeSeconds = teamCrownSeconds.get(team) ?? 0;
      return {
        team,
        peakTilePercentage,
        crownRatio,
        crownTimeSeconds,
        placementRank,
      };
    });

    return computeCompetitiveScores(metrics);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
