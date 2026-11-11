import { GameMode, type Team } from "@openfront/engine-api/game/GameTypes";
import type { EventBus } from "@openfront/shared/EventBus";
import { Colord } from "colord";
import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import "../../components/OfIcon";
import { isCompactViewport } from "../../CompactViewport";
import type { Controller } from "../../Controller";
import { AlternateViewEvent } from "../../InputHandler";
import { Platform } from "../../Platform";
import type { StatsTableKind } from "../../StatsConstants";
import { themeProvider } from "../../theme/ThemeProvider";
import { getTranslatedPlayerTeamLabel, translateText } from "../../Utils";
import type { GameView } from "../../view";
import { keepPressKeysFromGame } from "../HudKeys";
import { HUD_ICON_BUTTON } from "../HudModal";
import type { ColumnPicker } from "./ColumnPicker";
import "./ColumnPicker";
import { gameIdButton } from "./GameIdButton";
import { ImmunityBarVisibleEvent } from "./ImmunityTimer";
import "./PlayerStats";
import type { PlayerStats } from "./PlayerStats";
import { SpawnBarVisibleEvent } from "./SpawnTimer";
import "./TeamStats";
import type { TeamStats } from "./TeamStats";

// Look. Sizes, colours, radii and spacing of each part live here, so a
// change of look is one edit. The templates below only hold structure.
const PANEL =
  "max-lg:fixed max-lg:top-0 max-lg:left-0 max-lg:z-900 lg:pointer-events-auto flex flex-col max-h-[calc(100vh-80px)] overflow-y-auto p-1 hud-panel rounded-br-lg text-white transition-[margin-top] duration-300";
const PANEL_OPEN = "max-[400px]:w-full max-[400px]:rounded-none";
// Below lg the timer bar is fixed over the top end of the panel, so the bar
// wraps before it instead of running under it.
const BAR =
  "flex flex-wrap items-center gap-1 max-lg:max-w-[calc(100vw-12.5rem)]";
const BAR_BUTTON = `${HUD_ICON_BUTTON} aria-pressed:bg-aquarius/20 aria-pressed:text-white aria-pressed:inset-ring aria-pressed:inset-ring-aquarius/55`;
// Lit while the column menu it opens is up.
const MENU_BUTTON = `${HUD_ICON_BUTTON} aria-expanded:bg-white/15 aria-expanded:text-white`;
const BAR_ICON_SIZE = 20;
const YOUR_TEAM = "mt-1 flex items-center gap-1.5 px-1 text-[13px]";
const TEAM_SWATCH = "size-2.5 shrink-0 rounded-xs bg-(--color)";

@customElement("game-left-sidebar")
export class GameLeftSidebar extends LitElement implements Controller {
  @state()
  private isPlayerStatsShown = false;
  @state()
  private isTeamStatsShown = false;
  @state()
  private isVisible = false;
  @state()
  private isPlayerTeamLabelVisible = false;
  @state()
  private playerTeam: Team | null = null;
  @state()
  private spawnBarVisible = false;
  @state()
  private immunityBarVisible = false;
  @state()
  private alternateView = false;

  private playerColor: Colord = new Colord("#FFFFFF");
  @property({ attribute: false }) public game: GameView | null = null;
  @property({ attribute: false }) public eventBus: EventBus | null = null;
  @query("player-stats") private playerStats?: PlayerStats;
  @query("team-stats") private teamStats?: TeamStats;
  @query("column-picker") private columnPicker?: ColumnPicker;
  private showPlayerStatsAfterSpawn = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this.isVisible = true;
    this.eventBus?.on(SpawnBarVisibleEvent, (e) => {
      this.spawnBarVisible = e.visible;
    });
    this.eventBus?.on(ImmunityBarVisibleEvent, (e) => {
      this.immunityBarVisible = e.visible;
    });
    // Holding the toggle-view key (space) or the settings toggle also switch
    // the view; keep the button in step with whichever did it last.
    this.eventBus?.on(AlternateViewEvent, (e) => {
      this.alternateView = e.alternateView;
    });
    if (this.isTeamGame) {
      this.isPlayerTeamLabelVisible = true;
    }
    // Make it visible by default on large screens; compact ones (short laptops,
    // Poki's frame) need the room for the map.
    if (Platform.isDesktopWidth && !isCompactViewport()) {
      this.showPlayerStatsAfterSpawn = true;
    }
  }

  getTickIntervalMs() {
    return 1000;
  }

  tick() {
    if (this.game === null) return;

    const team = this.game.myPlayer()?.team();
    if (this.playerTeam === null && team !== null && team !== undefined) {
      this.playerTeam = team;
      this.playerColor = themeProvider.current().teamColor(team);
    }

    if (this.showPlayerStatsAfterSpawn && !this.game.inSpawnPhase()) {
      this.showPlayerStatsAfterSpawn = false;
      this.isPlayerStatsShown = true;
    }

    if (!this.game.inSpawnPhase() && this.isPlayerTeamLabelVisible) {
      this.isPlayerTeamLabelVisible = false;
    }

    this.playerStats?.refresh();
    this.teamStats?.refresh();
  }

  private get barOffset(): number {
    return (this.spawnBarVisible ? 7 : 0) + (this.immunityBarVisible ? 7 : 0);
  }

  private togglePlayerStats(): void {
    this.isPlayerStatsShown = !this.isPlayerStatsShown;
    if (!this.isPlayerStatsShown) this.columnPicker?.close();
  }

  private toggleTeamStats(): void {
    this.isTeamStatsShown = !this.isTeamStatsShown;
    if (!this.isTeamStatsShown) this.columnPicker?.close();
  }

  private toggleAlternateView(): void {
    this.eventBus?.emit(new AlternateViewEvent(!this.alternateView));
  }

  private get isTeamGame(): boolean {
    return this.game?.config().gameConfig().gameMode === GameMode.Team;
  }

  render() {
    const isTableShown = this.isPlayerStatsShown || this.isTeamStatsShown;
    const players = translateText("help_modal.icon_alt_player_leaderboard");
    const teams = translateText("help_modal.icon_alt_team_leaderboard");
    const view = translateText("user_setting.toggle_view_desc");
    const gameId = isTableShown ? (this.game?.gameID() ?? "") : "";
    const columns = translateText("leaderboard.configure_columns");
    const tables: StatsTableKind[] = [];
    if (this.isPlayerStatsShown) tables.push("player");
    if (this.isTeamStatsShown && this.isTeamGame) tables.push("team");
    return html`
      <aside
        class="${PANEL} ${isTableShown ? PANEL_OPEN : ""} ${
          this.isVisible ? "" : "hidden"
        }"
        style="margin-top: ${this.barOffset}px;"
      >
        <div class=${BAR}>
          <button
            type="button"
            class=${BAR_BUTTON}
            data-sidebar-button="players"
            aria-pressed=${this.isPlayerStatsShown ? "true" : "false"}
            aria-label=${players}
            title=${players}
            @mousedown=${(e: MouseEvent) => e.preventDefault()}
            @click=${this.togglePlayerStats}
            @keydown=${keepPressKeysFromGame}
            @keyup=${keepPressKeysFromGame}
          >
            <of-icon
              name=${this.isPlayerStatsShown ? "leaderboard" : "leaderboard-outline"}
              size=${BAR_ICON_SIZE}
            ></of-icon>
          </button>
          ${
            this.isTeamGame
              ? html`
                  <button
                    type="button"
                    class=${BAR_BUTTON}
                    data-sidebar-button="teams"
                    aria-pressed=${this.isTeamStatsShown ? "true" : "false"}
                    aria-label=${teams}
                    title=${teams}
                    @mousedown=${(e: MouseEvent) => e.preventDefault()}
                    @click=${this.toggleTeamStats}
                    @keydown=${keepPressKeysFromGame}
                    @keyup=${keepPressKeysFromGame}
                  >
                    <of-icon
                      name=${this.isTeamStatsShown ? "team" : "team-outline"}
                      size=${BAR_ICON_SIZE}
                    ></of-icon>
                  </button>
                `
              : null
          }
          <button
            type="button"
            class=${BAR_BUTTON}
            data-sidebar-button="view"
            aria-pressed=${this.alternateView ? "true" : "false"}
            aria-label=${view}
            title=${view}
            @mousedown=${(e: MouseEvent) => e.preventDefault()}
            @click=${this.toggleAlternateView}
            @keydown=${keepPressKeysFromGame}
            @keyup=${keepPressKeysFromGame}
          >
            <of-icon name="terrain" size=${BAR_ICON_SIZE}></of-icon>
          </button>
          ${gameId ? gameIdButton(gameId) : null}
          ${
            isTableShown
              ? html`
                  <button
                    type="button"
                    class=${MENU_BUTTON}
                    data-sidebar-button="columns"
                    aria-haspopup="dialog"
                    aria-expanded="false"
                    aria-label=${columns}
                    title=${columns}
                    @mousedown=${(e: MouseEvent) => e.preventDefault()}
                    @click=${(e: MouseEvent) =>
                      this.columnPicker?.openFrom(
                        e.currentTarget as HTMLElement,
                      )}
                    @keydown=${keepPressKeysFromGame}
                    @keyup=${keepPressKeysFromGame}
                  >
                    <of-icon name="columns" size=${BAR_ICON_SIZE}></of-icon>
                  </button>
                `
              : null
          }
        </div>
        ${
          this.isPlayerTeamLabelVisible
            ? html`
                <div
                  class=${YOUR_TEAM}
                  style="--color: ${this.playerColor.toRgbString()}"
                  data-your-team
                  @contextmenu=${(e: Event) => e.preventDefault()}
                >
                  ${translateText("help_modal.ui_your_team")}
                  <span class=${TEAM_SWATCH}></span>
                  <span class="text-(--color)">
                    ${getTranslatedPlayerTeamLabel(
                      this.playerTeam,
                      this.game?.teamClanTag(this.playerTeam),
                    )}
                  </span>
                </div>
              `
            : null
        }
        <div
          class="flex flex-col gap-2 min-w-0 w-full"
          @columns-menu=${(e: CustomEvent<{ x: number; y: number }>) =>
            this.columnPicker?.toggleAt(e.detail.x, e.detail.y)}
          @columns-changed=${() => {
            this.playerStats?.refresh();
            this.teamStats?.refresh();
          }}
        >
          <player-stats
            class=${this.isPlayerStatsShown ? "block min-w-0" : "hidden"}
            .game=${this.game}
            .eventBus=${this.eventBus}
            .visible=${this.isPlayerStatsShown}
          ></player-stats>
          <team-stats
            class=${
              this.isTeamStatsShown && this.isTeamGame
                ? "block min-w-0"
                : "hidden"
            }
            .game=${this.game}
            .visible=${this.isTeamStatsShown && this.isTeamGame}
          ></team-stats>
          <!-- Its menu is drawn under <body>; it takes no room here. -->
          <column-picker class="hidden" .tables=${tables}></column-picker>
        </div>
        <slot></slot>
      </aside>
    `;
  }
}
