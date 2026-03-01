import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import {
  ColoredTeams,
  GameMode,
  Team,
  UnitType,
} from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import {
  computeTeamTiles,
  findCrownTeam,
  normalizeCrownSeconds,
} from "../../../core/game/TeamUtils";
import { SendWinnerEvent } from "../../Transport";
import {
  formatPercentage,
  renderNumber,
  renderTroops,
  secondsToHms,
  translateText,
} from "../../Utils";
import { Layer } from "./Layer";

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
  /** Peak tile count per team (client-side tracking). */
  private _peakTiles: Map<Team, number> = new Map();
  /** Whether the game has ended (win detected). */
  private _gameOver: boolean = false;
  /** Frozen current % per team at game end. */
  private _frozenCurrentPercent: Map<Team, number> = new Map();
  /** Frozen peak % per team at game end. */
  private _frozenPeakPercent: Map<Team, number> = new Map();
  /** Game tick when game ended (for freezing elapsed time). */
  private _endTick: number | null = null;
  /** All teams we've ever seen (so eliminated teams still appear). */
  private _knownTeams: Set<Team> = new Set();

  createRenderRoot() {
    return this; // use light DOM for Tailwind
  }

  init() {
    this.eventBus.on(SendWinnerEvent, () => {
      this._gameOver = true;
      this._endTick = this.game.ticks();
      this.freezeScores();
    });
  }

  getTickIntervalMs() {
    return 100;
  }

  tick() {
    if (this.game.config().gameConfig().gameMode !== GameMode.Team) return;

    if (!this._shownOnInit && !this.game.inSpawnPhase()) {
      this._shownOnInit = true;
      if (this.game.config().gameConfig().competitiveScoring) {
        this.viewMode = "competitive";
        this.visible = true;
      }
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
    const teamToTiles = computeTeamTiles(this.game.playerViews());
    for (const team of teamToTiles.keys()) {
      this._knownTeams.add(team);
    }
    for (const [team, tiles] of teamToTiles) {
      const prev = this._peakTiles.get(team) ?? 0;
      if (tiles > prev) {
        this._peakTiles.set(team, tiles);
      }
    }
  }

  private freezeScores() {
    const numTilesWithoutFallout =
      this.game.numLandTiles() - this.game.numTilesWithFallout();
    const teamToTiles = computeTeamTiles(this.game.playerViews());
    for (const [team, tiles] of teamToTiles) {
      this._frozenCurrentPercent.set(team, tiles / numTilesWithoutFallout);
    }
    for (const [team, peakTiles] of this._peakTiles) {
      this._frozenPeakPercent.set(team, peakTiles / numTilesWithoutFallout);
    }
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

    // In competitive view, ensure eliminated teams still appear
    if (this.viewMode === "competitive") {
      for (const team of this._knownTeams) {
        if (!(team in grouped)) {
          grouped[team] = [];
        }
      }
    }

    const numTilesWithoutFallout =
      this.game.numLandTiles() - this.game.numTilesWithFallout();

    // Read per-team crown ticks from the server (authoritative source).
    // Normalize so displayed seconds sum to the sidebar elapsed seconds.
    const currentTick = this._endTick ?? this.game.ticks();
    const elapsedGameTicks = Math.max(
      0,
      currentTick - this.game.config().numSpawnPhaseTurns(),
    );
    const maxTimerValue = this.game.config().gameConfig().maxTimerValue;
    const elapsedSeconds =
      maxTimerValue !== undefined
        ? Math.min(Math.floor(elapsedGameTicks / 10), maxTimerValue * 60)
        : Math.floor(elapsedGameTicks / 10);
    const serverCrownTicks = this.game.teamCrownTicks() ?? {};
    const allTeamKeys = Object.keys(grouped);
    const crownHolder = findCrownTeam(
      computeTeamTiles(this.game.playerViews()),
    );
    const serverTicksMap = new Map<Team, number>(
      Object.entries(serverCrownTicks),
    );
    const crownSecondsMap = normalizeCrownSeconds(
      allTeamKeys,
      serverTicksMap,
      crownHolder,
      elapsedSeconds,
    );

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

        const totalScorePercent = this._gameOver
          ? (this._frozenCurrentPercent.get(teamStr) ??
            totalScoreSort / numTilesWithoutFallout)
          : totalScoreSort / numTilesWithoutFallout;
        const rawPeakPercent = this._gameOver
          ? (this._frozenPeakPercent.get(teamStr) ?? 0)
          : (this._peakTiles.get(teamStr) ?? 0) / numTilesWithoutFallout;
        const peakPercent = Math.max(rawPeakPercent, totalScorePercent);

        return {
          teamName: teamStr,
          isMyTeam: teamStr === this._myTeam,
          totalScoreStr: formatPercentage(totalScorePercent),
          peakScoreStr: formatPercentage(peakPercent),
          totalScoreSort,
          totalGold: renderNumber(totalGold),
          totalMaxTroops: renderTroops(totalMaxTroops),
          players: teamPlayers,
          crownSeconds:
            this._gameOver && this.game.competitiveScores()
              ? (this.game.competitiveScores()!.find((s) => s.team === teamStr)
                  ?.crownTimeSeconds ?? 0)
              : (crownSecondsMap.get(teamStr) ?? 0),

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
        return translateText("leaderboard.show_competitive");
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
        title="${title ?? ""}"
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
          ${cell(translateText("leaderboard.team"))}
          ${cell("Current %", "Percentage of land currently controlled")}
          ${cell("Peak %", "Highest percentage of land ever controlled")}
          ${cell("👑", "Total time spent holding the most territory")}
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
            ${td(team.peakScoreStr)} ${td(secondsToHms(team.crownSeconds))}
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
