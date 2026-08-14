import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus, GameEvent } from "../../../core/EventBus";
import { GameMode, GameType, Team } from "../../../core/game/Game";
import { Controller } from "../../Controller";
import { themeProvider } from "../../theme/ThemeProvider";
import { TransformHandler } from "../../TransformHandler";
import { formatPercentage, translateText } from "../../Utils";
import { GameView } from "../../view";

export class SpawnBarVisibleEvent implements GameEvent {
  constructor(public readonly visible: boolean) {}
}

@customElement("spawn-timer")
export class SpawnTimer extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public transformHandler: TransformHandler;

  private ratios = [0];
  private _barVisible = false;
  private teams: Team[] = [];
  private colors = [
    "rgb(from var(--color-bright-blue) r g b / 0.85)",
    "rgba(0, 0, 0, 0.5)",
  ];

  private isVisible = false;

  @state()
  private hoveredIndex: number | null = null;

  createRenderRoot() {
    this.style.position = "fixed";
    this.style.top = "0";
    this.style.left = "0";
    this.style.width = "100%";
    this.style.height = "9px";
    this.style.zIndex = "1000";
    this.style.pointerEvents = "none";
    return this;
  }

  init() {
    this.isVisible = true;
  }

  tick() {
    if (
      this.game.config().gameConfig().gameType === GameType.Singleplayer &&
      this.game.inSpawnPhase()
    ) {
      // Singleplayer has no spawn countdown.
      this.ratios = [];
      this.teams = [];
      this.colors = [];
      this.requestUpdate();
      return;
    }

    if (this.game.inSpawnPhase()) {
      // During spawn phase, only one segment filling full width
      this.ratios = [
        this.game.ticks() / this.game.config().numSpawnPhaseTurns(),
      ];
      this.teams = [];
      this.colors = ["rgb(from var(--color-bright-blue) r g b / 0.85)"];
    } else {
      this.ratios = [];
      this.teams = [];
      this.colors = [];

      if (this.game.config().gameConfig().gameMode === GameMode.Team) {
        const teamTiles: Map<Team, number> = new Map();
        for (const player of this.game.players()) {
          const team = player.team();
          if (team === null) continue;
          const tiles = teamTiles.get(team) ?? 0;
          teamTiles.set(team, tiles + player.numTilesOwned());
        }

        const theme = themeProvider.current();
        const total = sumIterator(teamTiles.values());
        if (total > 0) {
          for (const [team, count] of teamTiles) {
            const ratio = count / total;
            this.ratios.push(ratio);
            this.teams.push(team);
            this.colors.push(theme.teamColor(team).toRgbString());
          }
        }
      }
    }

    this.requestUpdate();
    this.emitBarVisibility();
  }

  private emitBarVisibility() {
    const nowVisible = this.isVisible && this.ratios.length > 0;
    if (nowVisible !== this._barVisible) {
      this._barVisible = nowVisible;
      this.eventBus?.emit(new SpawnBarVisibleEvent(this._barVisible));
    }
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    if (this.ratios.length === 0 || this.colors.length === 0) {
      return html``;
    }

    if (
      !this.game.inSpawnPhase() &&
      this.game.config().gameConfig().gameMode !== GameMode.Team
    ) {
      return html``;
    }

    return html`
      <div class="relative w-full h-full flex z-999">
        ${this.ratios.map((ratio, i) => {
          const color = this.colors[i] || "rgba(0, 0, 0, 0.5)";
          return html`
            <div
              class="h-full pointer-events-auto transition-all duration-100 ease-in-out w-(--width) bg-(--bg) border-b-3 border-r-2 border-black"
              style="--width: ${ratio * 100}%; --bg: ${color};"
              @mouseenter=${() => (this.hoveredIndex = i)}
              @mouseleave=${() => (this.hoveredIndex = null)}
            ></div>
          `;
        })}
        ${this.renderTooltip()}
      </div>
    `;
  }

  private renderTooltip() {
    const index = this.hoveredIndex;
    const team = index === null ? undefined : this.teams[index];
    if (index === null || team === undefined) {
      return nothing;
    }

    // Center the tooltip over its segment using cumulative segment widths.
    let cumulative = 0;
    let center = 0;
    for (let i = 0; i <= index; i++) {
      center = (cumulative + this.ratios[i] / 2) * 100;
      cumulative += this.ratios[i];
    }

    // Keep the tooltip fully on-screen: it sits centered over its segment, but
    // clamps toward the nearer edge so it never overflows the screen. The
    // element is kept to a bounded width (max-width) so the 64px clamp always
    // covers half its width, even for long translated or raw team names.
    const clampedLeft = `clamp(64px, ${center}%, calc(100% - 64px))`;

    // Fall back to the raw team name when it has no team_colors key (e.g.
    // numbered teams like "Team 1"), mirroring TeamStats.
    const labelKey = `team_colors.${team.toLowerCase()}`;
    const translatedName = translateText(labelKey);
    const teamName = translatedName === labelKey ? team : translatedName;

    return html`
      <div
        class="absolute top-3.5 -translate-x-1/2 z-999 px-2 py-1 rounded bg-black/85 text-white text-xs text-center break-words pointer-events-none"
        style="left: ${clampedLeft}; max-width: 128px"
      >
        ${translateText("spawn_timer.team_percent_tooltip", {
          team: teamName,
          percent: formatPercentage(this.ratios[index]),
        })}
      </div>
    `;
  }
}

function sumIterator(values: MapIterator<number>) {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}
