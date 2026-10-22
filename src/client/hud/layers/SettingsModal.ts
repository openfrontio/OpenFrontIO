import { GameType } from "@openfront/engine-api/game/GameTypes";
import { GameConfig } from "@openfront/engine-api/Schemas";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { gamePortal } from "src/client/GamePortal";
import { PauseGameIntentEvent } from "src/client/Transport";
import { responseHasLinkedIdentity } from "../../AccountIdentity";
import { ClientEnv } from "../../ClientEnv";
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
const exitIcon = assetUrl("images/ExitIconWhite.svg");
const settingsIcon = assetUrl("images/SettingIconWhite.svg");
const treeIcon = assetUrl("images/TreeIconWhite.svg");

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
      gamePortal.gameplayStop();
    } else if (!this.wasPausedWhenOpened) {
      gamePortal.gameplayStart();
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

  // Saves are kept on the player's account: singleplayer games only, and
  // only for a signed-in account, since a guest's saves would be lost with
  // the browser's session.
  private canSave(): boolean {
    const game = this.game;
    return (
      game !== null &&
      game.config().gameConfig().gameType === GameType.Singleplayer &&
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
        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors disabled:opacity-60"
        data-save-game
        ?disabled=${status === "saving"}
        @click="${this.onSaveButtonClick}"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path
            d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"
          />
          <path d="M17 21v-8H7v8M7 3v5h8" />
        </svg>
        <div class="flex-1">
          <div class="font-medium">
            ${translateText("saved_games.save_label")}
          </div>
          <div class="text-sm text-slate-400" data-save-status>${desc}</div>
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
    const disabledUnits = disabledUnitsBox(c, "mx-3 mt-2");
    const hostCheats = hostCheatsBox(c, "mx-3 mt-2");
    if (settings.length === 0 && disabledUnits === null && hostCheats === null)
      return null;
    return html`
      <div class="border-t border-slate-600 pt-3 mt-4" data-game-modifiers>
        <div
          class="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wider"
        >
          ${translateText("user_setting.modifiers")}
        </div>
        ${settings.length > 0
          ? html`<div
              class="flex flex-wrap gap-1 px-3 pt-1 uppercase"
              data-modifier-tags
            >
              ${settings.map(
                (s) =>
                  html`<span class=${LOBBY_SETTING_TAG}
                    >${lobbySettingTagText(s)}</span
                  >`,
              )}
            </div>`
          : null}
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
        class="modal-overlay fixed inset-0 bg-black/60 backdrop-blur-xs z-2000 flex items-center justify-center p-4"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div
          class="bg-slate-800 border border-slate-600 rounded-lg max-w-md w-full max-h-[80vh] overflow-y-auto"
        >
          <div
            class="flex items-center justify-between p-4 border-b border-slate-600"
          >
            <div class="flex items-center gap-2">
              <img
                src=${settingsIcon}
                alt=""
                width="24"
                height="24"
                class="align-middle"
              />
              <h2 class="text-xl font-semibold text-white">
                ${translateText("user_setting.game_menu_title")}
              </h2>
            </div>
            <button
              class="text-slate-400 hover:text-white text-2xl font-bold leading-none"
              @click=${this.closeModal}
            >
              ×
            </button>
          </div>

          <div class="p-4 flex flex-col gap-3">
            ${this.renderSaveRow()}

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              data-open-settings
              @click="${this.onOpenSettingsButtonClick}"
            >
              <img src=${settingsIcon} alt="" width="20" height="20" />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.open_settings_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.open_settings_desc")}
                </div>
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onTerrainButtonClick}"
            >
              <img src=${treeIcon} alt="" width="20" height="20" />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.toggle_terrain")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.toggle_view_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.alternateView
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            ${this.renderModifiers()}

            <div class="border-t border-slate-600 pt-3 mt-4">
              <div
                class="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wider"
              >
                ${translateText("user_setting.development_only")}
              </div>

              <button
                class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                @click="${this.onRenderDebugGuiButtonClick}"
              >
                <img src=${settingsIcon} alt="" width="20" height="20" />
                <div class="flex-1">
                  <div class="font-medium">
                    ${translateText("user_setting.render_debug_gui")}
                  </div>
                  <div class="text-sm text-slate-400">
                    ${translateText("user_setting.render_debug_gui_desc")}
                  </div>
                </div>
              </button>
            </div>

            <div class="border-t border-slate-600 pt-3 mt-4">
              <button
                class="flex gap-3 items-center w-full text-left p-3 hover:bg-red-600/20 rounded-sm text-red-400 transition-colors"
                @click="${this.onExitButtonClick}"
              >
                <img src=${exitIcon} alt="" width="20" height="20" />
                <div class="flex-1">
                  <div class="font-medium">
                    ${translateText("user_setting.exit_game_label")}
                  </div>
                  <div class="text-sm text-slate-400">
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
