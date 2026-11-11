import { GameType } from "@openfront/engine-api/game/GameTypes";
import { GameConfig } from "@openfront/engine-api/Schemas";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { gamePortal } from "src/client/GamePortal";
import { PauseGameIntentEvent } from "src/client/Transport";
import { responseHasLinkedIdentity } from "../../AccountIdentity";
import { ClientEnv } from "../../ClientEnv";
import "../../components/OfIcon";
import { Controller } from "../../Controller";
import {
  AlternateViewEvent,
  ToggleRenderDebugGuiEvent,
} from "../../InputHandler";
import { type SavedGameError, uploadSavedGame } from "../../SavedGamesApi";
import { lastUserMeResponse } from "../../UserMeBroadcast";
import type { UserSettingModal } from "../../UserSettingModal";
import {
  disabledUnitsBox,
  hostCheatsBox,
  LOBBY_SETTING_TAG,
  lobbySettingTagText,
  notableLobbySettings,
} from "../../utilities/LobbySettingsSummary";
import { getMapName, homeHref, translateText } from "../../Utils";
import type { GameView } from "../../view/GameView";
import { HUD_LABEL, hudModalHeader, hudSwitch } from "../HudModal";

const ROW_BASE =
  "flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-1 text-start " +
  "transition-colors disabled:opacity-60 disabled:hover:bg-transparent " +
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-aquarius";
const ROW = `${ROW_BASE} text-white hover:bg-white/6 active:bg-white/10`;
// Exit has its own colours instead of red added to ROW: between two text-* (or
// hover:bg-*) classes on one element the stylesheet's order wins, not ours.
const EXIT_ROW = `${ROW_BASE} text-red-400 hover:bg-red-500/15 active:bg-red-500/25`;

export class ShowSettingsModalEvent {
  constructor(
    public readonly isVisible: boolean = true,
    public readonly shouldPause: boolean = false,
    public readonly isPaused: boolean = false,
  ) {}
}

/**
 * The in-game menu.
 *
 * It holds what is session state or a game action — the alternate (terrain)
 * view, the debug GUI, exiting — plus the game's modifiers (the non-default
 * lobby settings the join modal shows) and a link into the settings modal.
 * Every `UserSettings`-backed row it used to duplicate, the advanced graphics
 * options included, now lives in `UserSettingModal`, which this opens through
 * the non-inline `#game-settings` instance so both entry points render the
 * same UI.
 */
@customElement("settings-modal")
export class SettingsModal extends LitElement implements Controller {
  public eventBus: EventBus;

  @state()
  private isVisible: boolean = false;

  @state()
  private alternateView: boolean = false;

  @query(".modal-overlay")
  private modalOverlay!: HTMLElement;

  @property({ type: Boolean })
  shouldPause = false;

  @property({ type: Boolean })
  wasPausedWhenOpened = false;

  @property({ attribute: false })
  gameConfig: GameConfig | null = null;

  /** Nations the map defines; null skips the nation-count comparison. */
  @property({ attribute: false })
  mapNationCount: number | null = null;

  /** The running game, for saving it. */
  @property({ attribute: false })
  game: GameView | null = null;

  @state()
  private saveStatus: "saving" | "saved" | SavedGameError | null = null;

  init() {
    // The view can also be switched by the toggle-view key and the sidebar
    // button; keep this toggle in step.
    this.eventBus.on(AlternateViewEvent, (event) => {
      this.alternateView = event.alternateView;
      this.requestUpdate();
    });
    this.eventBus.on(ShowSettingsModalEvent, (event) => {
      this.isVisible = event.isVisible;
      this.shouldPause = event.shouldPause;
      this.wasPausedWhenOpened = event.isPaused;
      // A save's outcome is news once; the next opening starts clean.
      if (this.saveStatus !== "saving") this.saveStatus = null;
      this.pauseGame(true);
    });
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("click", this.handleOutsideClick, true);
    window.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("click", this.handleOutsideClick, true);
    window.removeEventListener("keydown", this.handleKeyDown);
    super.disconnectedCallback();
  }

  private handleOutsideClick = (event: MouseEvent) => {
    if (
      this.isVisible &&
      this.modalOverlay &&
      event.target === this.modalOverlay
    ) {
      this.closeModal();
    }
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    if (this.isVisible && event.key === "Escape") {
      this.closeModal();
    }
  };

  /** Whether the menu is showing. */
  get open(): boolean {
    return this.isVisible;
  }

  public openModal() {
    this.isVisible = true;
    this.requestUpdate();
  }

  public closeModal({ keepPause = false }: { keepPause?: boolean } = {}) {
    this.isVisible = false;
    this.requestUpdate();
    if (!keepPause) this.pauseGame(false);
  }

  private pauseGame(pause: boolean) {
    // Portals: report gameplay as stopped whenever the settings menu is open,
    // and resumed when it closes — unless the game was already paused when opened.
    if (pause) {
      void gamePortal.gameplayStop();
    } else if (!this.wasPausedWhenOpened) {
      void gamePortal.gameplayStart();
    }

    // Only pause the simulation itself when we own the pause (singleplayer or
    // lobby creator).
    if (this.shouldPause && !this.wasPausedWhenOpened) {
      this.eventBus.emit(new PauseGameIntentEvent(pause));
    }
  }

  private onTerrainButtonClick() {
    this.alternateView = !this.alternateView;
    this.eventBus.emit(new AlternateViewEvent(this.alternateView));
    this.requestUpdate();
  }

  private onOpenSettingsButtonClick() {
    // index.html hides the page's inline <user-setting id="page-settings">
    // during a match, so the HUD addresses its own non-inline instance by id.
    const gameSettings = document.getElementById(
      "game-settings",
    ) as UserSettingModal | null;
    if (gameSettings === null || typeof gameSettings.open !== "function") {
      // Leave this menu open: closing it would strand the player with neither
      // the settings modal nor a menu.
      console.warn("In-game settings modal (#game-settings) not found");
      return;
    }
    // Keep the pause. Nothing releases it until this menu itself closes, and
    // UserSettingModal knows nothing about pausing — it only calls onReturn.
    this.closeModal({ keepPause: true });
    gameSettings.open({
      tab: "gameplay",
      // Reopen directly rather than re-emitting ShowSettingsModalEvent: init()
      // runs pauseGame(true) on every event, which would emit a second
      // PauseGameIntentEvent(true).
      onReturn: () => this.openModal(),
    });
  }

  private onRenderDebugGuiButtonClick() {
    this.eventBus.emit(new ToggleRenderDebugGuiEvent());
    this.closeModal();
  }

  private onOpenGraphicsButtonClick() {
    const settings = document.getElementById(
      "game-settings",
    ) as UserSettingModal | null;
    if (!settings?.openGraphicsPanel(() => this.openModal())) return;
    this.closeModal({ keepPause: true });
  }

  // Saves are kept on the player's account: singleplayer games only, and
  // only for a signed-in account, since a guest's saves would be lost with
  // the browser's session. Not the onboarding tutorial: its overlay keeps
  // state a save doesn't carry, so a resumed one could get stuck.
  private canSave(): boolean {
    const game = this.game;
    return (
      game !== null &&
      game.config().gameConfig().gameType === GameType.Singleplayer &&
      game.config().gameConfig().tutorial !== true &&
      !game.config().isReplay() &&
      responseHasLinkedIdentity(lastUserMeResponse()?.response ?? false)
    );
  }

  private async onSaveButtonClick() {
    const game = this.game;
    if (game === null || this.saveStatus === "saving") return;
    this.saveStatus = "saving";
    try {
      // The menu has paused the game, so this is the moment the player sees.
      const snapshot = await game.worker.snapshot(ClientEnv.gitCommit());
      const map = game.config().gameConfig().gameMap;
      const result = await uploadSavedGame(snapshot, {
        name: defaultSaveName(getMapName(map) ?? map, new Date()),
        map,
        tick: game.ticks(),
      });
      this.saveStatus = typeof result === "string" ? result : "saved";
    } catch (err) {
      console.warn("Failed to save the game", err);
      this.saveStatus = "request_failed";
    }
  }

  private renderSaveRow() {
    if (!this.canSave()) return null;
    const status = this.saveStatus;
    const desc =
      status === null
        ? translateText("saved_games.save_desc")
        : translateText(`saved_games.save_status.${status}`);
    return html`
      <button
        class=${ROW}
        data-save-game
        ?disabled=${status === "saving"}
        @click="${this.onSaveButtonClick}"
      >
        <of-icon name="save" size="20" class="text-white/70"></of-icon>
        <div class="flex min-w-0 flex-1 flex-col">
          <div class="text-sm font-semibold">
            ${translateText("saved_games.save_label")}
          </div>
          <div
            class="text-xs text-white/55"
            data-save-status
            aria-live="polite"
          >
            ${desc}
          </div>
        </div>
      </button>
    `;
  }

  private onExitButtonClick() {
    // redirect to the home page
    window.location.href = homeHref();
  }

  private renderModifiers() {
    const c = this.gameConfig;
    if (c === null) return null;
    const settings = notableLobbySettings(c, this.mapNationCount);
    const disabledUnits = disabledUnitsBox(c, "mx-2 mt-2");
    const hostCheats = hostCheatsBox(c, "mx-2 mt-2");
    if (settings.length === 0 && disabledUnits === null && hostCheats === null)
      return null;
    return html`
      <div class="mt-2 border-t border-white/10 pt-2" data-game-modifiers>
        <div class="px-2 py-1 ${HUD_LABEL}">
          ${translateText("user_setting.modifiers")}
        </div>
        ${
          settings.length > 0
            ? html`<div
                class="flex flex-wrap gap-1 px-2 pt-1 uppercase"
                data-modifier-tags
              >
                ${settings.map(
                  (s) =>
                    html`<span class=${LOBBY_SETTING_TAG}
                      >${lobbySettingTagText(s)}</span
                    >`,
                )}
              </div>`
            : null
        }
        ${disabledUnits} ${hostCheats}
      </div>
    `;
  }

  render() {
    if (!this.isVisible) {
      return null;
    }

    return html`
      <div
        class="modal-overlay fixed inset-0 z-2000 flex items-center justify-center bg-black/60 p-3 backdrop-blur-xs"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div
          class="hud-modal flex max-h-[86dvh] w-full max-w-[420px] flex-col overflow-hidden text-white animate-hud-rise motion-reduce:animate-none"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-menu-title"
        >
          ${hudModalHeader({
            title: translateText("user_setting.game_menu_title"),
            titleId: "settings-menu-title",
            onClose: () => this.closeModal(),
          })}

          <div class="flex flex-col overflow-y-auto p-3">
            ${this.renderSaveRow()}

            <button
              type="button"
              data-open-graphics
              class=${ROW}
              @click=${this.onOpenGraphicsButtonClick}
            >
              <of-icon
                name="graphics"
                size="20"
                class="text-white/70"
              ></of-icon>
              <div class="flex min-w-0 flex-1 flex-col">
                <div class="text-sm font-semibold">
                  ${translateText("user_setting.tab_graphics")}
                </div>
              </div>
              <of-icon
                name="chevron-right"
                size="16"
                class="text-white/55 rtl:-scale-x-100"
              ></of-icon>
            </button>

            <button
              class=${ROW}
              data-open-settings
              @click="${this.onOpenSettingsButtonClick}"
            >
              <of-icon
                name="settings"
                size="20"
                class="text-white/70"
              ></of-icon>
              <div class="flex min-w-0 flex-1 flex-col">
                <div class="text-sm font-semibold">
                  ${translateText("user_setting.open_settings_label")}
                </div>
                <div class="text-xs text-white/55">
                  ${translateText("user_setting.open_settings_desc")}
                </div>
              </div>
              <of-icon
                name="chevron-right"
                size="16"
                class="text-white/55 rtl:-scale-x-100"
              ></of-icon>
            </button>

            <button
              class=${ROW}
              role="switch"
              aria-checked=${this.alternateView}
              data-toggle-terrain
              @click="${this.onTerrainButtonClick}"
            >
              <of-icon name="terrain" size="20" class="text-white/70"></of-icon>
              <div class="flex min-w-0 flex-1 flex-col">
                <div class="text-sm font-semibold">
                  ${translateText("user_setting.toggle_terrain")}
                </div>
                <div class="text-xs text-white/55">
                  ${translateText("user_setting.toggle_view_desc")}
                </div>
              </div>
              ${hudSwitch(this.alternateView)}
            </button>

            ${this.renderModifiers()}

            <div class="mt-2 border-t border-white/10 pt-2">
              <div class="px-2 py-1 ${HUD_LABEL}">
                ${translateText("user_setting.development_only")}
              </div>

              <button class=${ROW} @click="${this.onRenderDebugGuiButtonClick}">
                <of-icon name="debug" size="20" class="text-white/70"></of-icon>
                <div class="flex min-w-0 flex-1 flex-col">
                  <div class="text-sm font-semibold">
                    ${translateText("user_setting.render_debug_gui")}
                  </div>
                  <div class="text-xs text-white/55">
                    ${translateText("user_setting.render_debug_gui_desc")}
                  </div>
                </div>
                <of-icon
                  name="chevron-right"
                  size="16"
                  class="text-white/55 rtl:-scale-x-100"
                ></of-icon>
              </button>
            </div>

            <div class="mt-2 border-t border-white/10 pt-2">
              <button class=${EXIT_ROW} @click="${this.onExitButtonClick}">
                <of-icon name="exit" size="20"></of-icon>
                <div class="flex min-w-0 flex-1 flex-col">
                  <div class="text-sm font-semibold">
                    ${translateText("user_setting.exit_game_label")}
                  </div>
                  <div class="text-xs text-white/55">
                    ${translateText("user_setting.exit_game_info")}
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

/** "World 2026-10-19 14:05": the map and the local time, editable later. */
export function defaultSaveName(mapName: string, at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  // The API caps names at 64 characters.
  return `${mapName.slice(0, 47)} ${date} ${time}`;
}
