import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import {
  ColoredTeams,
  GameMode,
  Team,
  UnitType,
} from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import {
  formatPercentage,
  renderNumber,
  renderTroops,
  translateText,
} from "../../Utils";
import { Layer } from "./Layer";

function formatCrownTime(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type ViewMode = "control" | "units" | "competitive";

interface TeamEntry {
  teamName: string;
  isMyTeam: boolean;
  totalScoreStr: string;
  peakScoreStr: string;
  totalGold: string;
  totalMaxTroops: string;
  totalSAMs: string;
  totalLaunchers: string;
  totalWarShips: string;
  totalCities: string;
  totalScoreSort: number;
  crownSeconds: number;
  players: PlayerView[];
}

@customElement("team-stats")
export class TeamStats extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;

  @property({ type: Boolean }) visible = false;
  teams: TeamEntry[] = [];
  private _shownOnInit = false;
  private viewMode: ViewMode = "control";
  private _myTeam: Team | null = null;
  /** Crown time in game ticks accumulated per team (client-side tracking). */
  private _crownTicks: Map<Team, number> = new Map();
  /** Peak tile count per team (client-side tracking). */
  private _peakTiles: Map<Team, number> = new Map();
  /** Last game tick we processed metrics for. */
  private _lastMetricsTick: number = 0;
  /** Whether the game has ended (win detected). */
  private _gameOver: boolean = false;

  createRenderRoot() {
    return this; // use light DOM for Tailwind
  }

  init() {}

  getTickIntervalMs() {
    return 100;
  }

  tick() {
    if (this.game.config().gameConfig().gameMode !== GameMode.Team) return;

    if (!this._shownOnInit && !this.game.inSpawnPhase()) {
      this._shownOnInit = true;
      this._lastMetricsTick = this.game.ticks();
      this.updateTeamStats();
    }

    // Track crown time and peak tiles based on game ticks
    if (!this.game.inSpawnPhase() && !this._gameOver) {
      this.trackMetrics();
    }

    if (!this.visible) return;

    this.updateTeamStats();
  }

  private trackMetrics() {
    const currentTick = this.game.ticks();
    const tickDelta = currentTick - this._lastMetricsTick;
    this._lastMetricsTick = currentTick;
    if (tickDelta <= 0) return;

    const players = this.game.playerViews();
    const teamToTiles = new Map<Team, number>();
    for (const player of players) {
      const team = player.team();
      if (team === null || team === ColoredTeams.Bot) continue;
      teamToTiles.set(
        team,
        (teamToTiles.get(team) ?? 0) + player.numTilesOwned(),
      );
    }

    const hasWinUpdate = this.hasWinUpdate();
    const winConditionMet = this.isTeamWinConditionMet(
      teamToTiles,
      currentTick,
    );

    // Fallback for missed WinUpdate polling: stop immediately once we detect
    // the board already satisfies the team win condition.
    if (!hasWinUpdate && winConditionMet) {
      this._gameOver = true;
      return;
    }

    // Track peak tiles
    for (const [team, tiles] of teamToTiles) {
      const prev = this._peakTiles.get(team) ?? 0;
      if (tiles > prev) {
        this._peakTiles.set(team, tiles);
      }
    }

    // Track crown time (in game ticks)
    let maxTiles = 0;
    let crownTeam: Team | null = null;
    for (const [team, tiles] of teamToTiles) {
      if (tiles > maxTiles) {
        maxTiles = tiles;
        crownTeam = team;
      }
    }
    if (crownTeam !== null && maxTiles > 0) {
      this._crownTicks.set(
        crownTeam,
        (this._crownTicks.get(crownTeam) ?? 0) + tickDelta,
      );
    }

    if (hasWinUpdate || winConditionMet) {
      this._gameOver = true;
    }
  }

  private hasWinUpdate(): boolean {
    const updates = this.game.updatesSinceLastTick();
    const winUpdates = updates !== null ? updates[GameUpdateType.Win] : [];
    return winUpdates.length > 0;
  }

  private isTeamWinConditionMet(
    teamToTiles: Map<Team, number>,
    currentTick: number,
  ): boolean {
    const numTilesWithoutFallout =
      this.game.numLandTiles() - this.game.numTilesWithFallout();
    if (numTilesWithoutFallout <= 0 || teamToTiles.size === 0) return false;

    const maxTiles = Math.max(...Array.from(teamToTiles.values()));
    const percentage = (maxTiles / numTilesWithoutFallout) * 100;
    const territoryWin =
      percentage > this.game.config().percentageTilesOwnedToWin();

    const maxTimer = this.game.config().gameConfig().maxTimerValue;
    const timeElapsedSeconds =
      (currentTick - this.game.config().numSpawnPhaseTurns()) / 10;
    const timerWin =
      maxTimer !== undefined && timeElapsedSeconds - maxTimer * 60 >= 0;

    return territoryWin || timerWin;
  }

  private updateTeamStats() {
    const players = this.game.playerViews();
    const grouped: Record<Team, PlayerView[]> = {};

    if (this._myTeam === null) {
      const myPlayer = this.game.myPlayer();
      this._myTeam = myPlayer?.team() ?? null;
    }

    for (const player of players) {
      const team = player.team();
      if (team === null) continue;
      grouped[team] ??= [];
      grouped[team].push(player);
    }

    const numTilesWithoutFallout =
      this.game.numLandTiles() - this.game.numTilesWithFallout();

    this.teams = Object.entries(grouped)
      .map(([teamStr, teamPlayers]) => {
        let totalGold = 0n;
        let totalMaxTroops = 0;
        let totalScoreSort = 0;
        let totalSAMs = 0;
        let totalLaunchers = 0;
        let totalWarShips = 0;
        let totalCities = 0;

        for (const p of teamPlayers) {
          if (p.isAlive()) {
            totalMaxTroops += this.game.config().maxTroops(p);
            totalGold += p.gold();
            totalScoreSort += p.numTilesOwned();
            totalLaunchers += p.totalUnitLevels(UnitType.MissileSilo);
            totalSAMs += p.totalUnitLevels(UnitType.SAMLauncher);
            totalWarShips += p.totalUnitLevels(UnitType.Warship);
            totalCities += p.totalUnitLevels(UnitType.City);
          }
        }

        const totalScorePercent = totalScoreSort / numTilesWithoutFallout;
        const peakTiles = this._peakTiles.get(teamStr) ?? 0;
        const peakPercent = peakTiles / numTilesWithoutFallout;

        return {
          teamName: teamStr,
          isMyTeam: teamStr === this._myTeam,
          totalScoreStr: formatPercentage(totalScorePercent),
          peakScoreStr: formatPercentage(peakPercent),
          totalScoreSort,
          totalGold: renderNumber(totalGold),
          totalMaxTroops: renderTroops(totalMaxTroops),
          players: teamPlayers,
          crownSeconds: Math.floor((this._crownTicks.get(teamStr) ?? 0) / 10),

          totalLaunchers: renderNumber(totalLaunchers),
          totalSAMs: renderNumber(totalSAMs),
          totalWarShips: renderNumber(totalWarShips),
          totalCities: renderNumber(totalCities),
        };
      })
      .sort((a, b) => b.totalScoreSort - a.totalScoreSort);

    this.requestUpdate();
  }

  private cycleViewMode() {
    const modes: ViewMode[] = ["control", "units", "competitive"];
    const idx = modes.indexOf(this.viewMode);
    this.viewMode = modes[(idx + 1) % modes.length];
    this.requestUpdate();
  }

  private get viewModeButtonLabel(): string {
    switch (this.viewMode) {
      case "control":
        return translateText("leaderboard.show_units");
      case "units":
        return "Show Competitive";
      case "competitive":
        return translateText("leaderboard.show_control");
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {}

  shouldTransform(): boolean {
    return false;
  }

  private renderHeader() {
    const cell = (text: string, title?: string) => html`
      <div
        class="p-1.5 md:p-2.5 text-center border-b border-slate-500"
        title=${title ?? ""}
      >
        ${text}
      </div>
    `;

    switch (this.viewMode) {
      case "control":
        return html`
          ${cell(translateText("leaderboard.team"))}
          ${cell(translateText("leaderboard.owned"))}
          ${cell(translateText("leaderboard.gold"))}
          ${cell(translateText("leaderboard.maxtroops"))}
        `;
      case "units":
        return html`
          ${cell(translateText("leaderboard.team"))}
          ${cell(translateText("leaderboard.launchers"))}
          ${cell(translateText("leaderboard.sams"))}
          ${cell(translateText("leaderboard.warships"))}
          ${cell(translateText("leaderboard.cities"))}
        `;
      case "competitive":
        return html`
          ${cell(translateText("leaderboard.team"))} ${cell("Current %")}
          ${cell("Peak %")}
          <div
            class="p-1.5 md:p-2.5 text-center border-b border-slate-500"
            title="Crown time (time holding most territory)"
          >
            👑
          </div>
        `;
    }
  }

  private renderRow(team: TeamEntry) {
    const rowClass = `contents hover:bg-slate-600/60 text-center cursor-pointer ${team.isMyTeam ? "font-bold" : ""}`;
    const td = (text: string) =>
      html`<div class="py-1.5 border-b border-slate-500">${text}</div>`;

    switch (this.viewMode) {
      case "control":
        return html`
          <div class="${rowClass}">
            ${td(team.teamName)} ${td(team.totalScoreStr)} ${td(team.totalGold)}
            ${td(team.totalMaxTroops)}
          </div>
        `;
      case "units":
        return html`
          <div class="${rowClass}">
            ${td(team.teamName)} ${td(team.totalLaunchers)}
            ${td(team.totalSAMs)} ${td(team.totalWarShips)}
            ${td(team.totalCities)}
          </div>
        `;
      case "competitive":
        return html`
          <div class="${rowClass}">
            ${td(team.teamName)} ${td(team.totalScoreStr)}
            ${td(team.peakScoreStr)} ${td(formatCrownTime(team.crownSeconds))}
          </div>
        `;
    }
  }

  render() {
    if (!this.visible) return html``;

    const numCols = this.viewMode === "units" ? 5 : 4;
    const teamsToRender =
      this.viewMode === "competitive"
        ? this.teams.filter((team) => team.teamName !== ColoredTeams.Bot)
        : this.teams;

    return html`
      <div
        class="max-h-[30vh] overflow-x-hidden overflow-y-auto grid bg-slate-800/85 w-full text-white text-xs md:text-sm mt-2 rounded-lg"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div
          class="grid w-full grid-cols-[repeat(var(--cols),1fr)]"
          style="--cols:${numCols};"
        >
          <!-- Header -->
          <div class="contents font-bold bg-slate-700/60">
            ${this.renderHeader()}
          </div>

          <!-- Data rows -->
          ${teamsToRender.map((team) => this.renderRow(team))}
        </div>
        <button class="team-stats-button" @click=${() => this.cycleViewMode()}>
          ${this.viewModeButtonLabel}
        </button>
      </div>
    `;
  }
}
