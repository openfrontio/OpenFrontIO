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
import { prefersReducedMotion } from "../../utilities/ReducedMotion";
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
  "max-lg:fixed max-lg:top-0 max-lg:left-0 max-lg:z-900 lg:pointer-events-auto flex flex-col max-h-[calc(100vh-80px)] overflow-y-auto p-1 hud-panel rounded-br-lg text-white transition-[margin-top] duration-300 max-[360px]:[--stats-end-track:2rem]";
// In portrait below lg the unit bar is a 30px column on the right edge: the
// open panel stops 10px before it, and a wide table scrolls sideways inside.
const PANEL_OPEN =
  "side-bar:max-w-[calc(100vw-2.5rem-env(safe-area-inset-right))]";
// Below lg the timer bar is fixed over the top end of the panel, so the bar
// wraps before it instead of running under it.
const BAR =
  "flex flex-wrap items-center gap-1 max-lg:max-w-[calc(100vw-12.5rem)]";
const BAR_BUTTON = `${HUD_ICON_BUTTON} aria-pressed:bg-aquarius/20 aria-pressed:text-white aria-pressed:inset-ring aria-pressed:inset-ring-aquarius/55`;
// Lit while the column menu it opens is up.
const MENU_BUTTON = `${HUD_ICON_BUTTON} aria-expanded:bg-white/15 aria-expanded:text-white`;
// Below 360px a team game's four buttons would wrap the bar, so the customize
// button sits at the end of the first header row instead, in the room the
// tables leave with --stats-end-track. Lower while the "Your team" line shows.
const MENU_BUTTON_NARROW =
  "max-[360px]:absolute max-[360px]:end-1 max-[360px]:z-1 max-[360px]:h-5.5";
const MENU_BUTTON_TOP = {
  bar: "max-[360px]:top-10",
  yourTeam: "max-[360px]:top-[63.5px]",
} as const;
const BAR_ICON_SIZE = 20;
// As wide as its text, so the panel can tell its closed size (closedBox).
const YOUR_TEAM = "mt-1 flex items-center gap-1.5 self-start px-1 text-[13px]";
const TEAM_SWATCH = "size-2.5 shrink-0 rounded-xs bg-(--color)";
// The panel grows out of its bar when a table opens and shrinks back into it
// when the last one closes, keeping its rounded-br-lg corner.
const OPENING: KeyframeAnimationOptions = {
  duration: 220,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
};
const CLOSING: KeyframeAnimationOptions = {
  duration: 180,
  easing: "cubic-bezier(0.4, 0, 1, 1)",
};
const PANEL_CORNER = "round 0 0 0.5rem 0";
// What the panel holds once its tables are closed.
const CLOSED_CONTENT =
  '[data-sidebar-button="players"], [data-sidebar-button="teams"], [data-sidebar-button="view"], [data-your-team]';

type Box = Pick<DOMRect, "top" | "right" | "bottom" | "left">;

// A clip-path that shows only `box` of a panel drawn at `panel`.
function clipTo(panel: Box, box: Box): string {
  return `inset(${box.top - panel.top}px ${panel.right - box.right}px ${
    panel.bottom - box.bottom
  }px ${box.left - panel.left}px ${PANEL_CORNER})`;
}

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
  @query("aside") private aside?: HTMLElement;
  private showPlayerStatsAfterSpawn = false;
  private closing: Animation | null = null;

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
      void this.setShown(true, this.isTeamStatsShown);
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

  // While the panel closes its tables count as closed already, so a press on
  // either toggle opens it again.
  private togglePlayerStats(): void {
    const open = this.closing === null;
    void this.setShown(
      !(open && this.isPlayerStatsShown),
      open && this.isTeamStatsShown,
    );
  }

  private toggleTeamStats(): void {
    const open = this.closing === null;
    void this.setShown(
      open && this.isPlayerStatsShown,
      !(open && this.isTeamStatsShown),
    );
  }

  private async setShown(players: boolean, teams: boolean): Promise<void> {
    if (
      (this.isPlayerStatsShown && !players) ||
      (this.isTeamStatsShown && !teams)
    ) {
      this.columnPicker?.close();
    }
    // Played back, the closing takes the panel back to open from where it is.
    this.closing?.reverse();
    this.closing = null;
    const wasOpen = this.isPlayerStatsShown || this.isTeamStatsShown;
    const aside = this.aside;
    if (
      wasOpen === (players || teams) ||
      !aside ||
      !("animate" in aside) ||
      prefersReducedMotion()
    ) {
      this.isPlayerStatsShown = players;
      this.isTeamStatsShown = teams;
      return;
    }

    if (!wasOpen) {
      const closed = aside.getBoundingClientRect();
      this.isPlayerStatsShown = players;
      this.isTeamStatsShown = teams;
      await this.updateComplete;
      const open = aside.getBoundingClientRect();
      aside.animate(
        [{ clipPath: clipTo(open, closed) }, { clipPath: clipTo(open, open) }],
        OPENING,
      );
      return;
    }

    const open = aside.getBoundingClientRect();
    const closing = aside.animate(
      [
        { clipPath: clipTo(open, open) },
        { clipPath: clipTo(open, this.closedBox(aside, open)) },
      ],
      CLOSING,
    );
    this.closing = closing;
    await closing.finished;
    // A press while it closed played it back: the panel stays open.
    if (this.closing !== closing) return;
    this.closing = null;
    this.isPlayerStatsShown = players;
    this.isTeamStatsShown = teams;
  }

  // The box the panel will have once closed: what it keeps, in its padding.
  private closedBox(aside: HTMLElement, open: Box): Box {
    let right = open.left;
    let bottom = open.top;
    for (const kept of aside.querySelectorAll(CLOSED_CONTENT)) {
      const box = kept.getBoundingClientRect();
      right = Math.max(right, box.right);
      bottom = Math.max(bottom, box.bottom);
    }
    const style = getComputedStyle(aside);
    return {
      top: open.top,
      left: open.left,
      right: right + parseFloat(style.paddingRight),
      bottom: bottom + parseFloat(style.paddingBottom),
    };
  }

  // The column menu, about to open. It shows the game ID in its footer only
  // while the bar's copy is hidden, so one is drawn at a time.
  private columnMenu(): ColumnPicker | undefined {
    const picker = this.columnPicker;
    if (picker) {
      const inBar = this.querySelector<HTMLElement>("[data-game-id]");
      picker.gameId =
        inBar !== null && inBar.offsetParent === null
          ? (this.game?.gameID() ?? "")
          : "";
    }
    return picker;
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
          <!-- On portrait phones the timer bar covers it: the column menu
               shows it in its footer there instead. -->
          ${gameId ? gameIdButton(gameId, "max-sm:side-bar:hidden") : null}
          ${
            isTableShown
              ? html`
                  <button
                    type="button"
                    class="${MENU_BUTTON} ${MENU_BUTTON_NARROW} ${
                      MENU_BUTTON_TOP[
                        this.isPlayerTeamLabelVisible ? "yourTeam" : "bar"
                      ]
                    }"
                    data-sidebar-button="columns"
                    aria-haspopup="dialog"
                    aria-expanded="false"
                    aria-label=${columns}
                    title=${columns}
                    @mousedown=${(e: MouseEvent) => e.preventDefault()}
                    @click=${(e: MouseEvent) =>
                      this.columnMenu()?.openFrom(
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
            this.columnMenu()?.toggleAt(e.detail.x, e.detail.y)}
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
            .short=${this.isTeamStatsShown && this.isTeamGame}
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
