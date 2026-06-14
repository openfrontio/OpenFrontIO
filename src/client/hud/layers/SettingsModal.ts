import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { crazyGamesSDK } from "src/client/CrazyGamesSDK";
import { PauseGameIntentEvent } from "src/client/Transport";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { UserSettings } from "../../../core/game/UserSettings";
import { Controller } from "../../Controller";
import {
  AlternateViewEvent,
  ToggleRenderDebugGuiEvent,
} from "../../InputHandler";
import { translateText } from "../../Utils";
import {
  SetBackgroundMusicVolumeEvent,
  SetSoundEffectsVolumeEvent,
} from "../../sound/Sounds";
import { ShowGraphicsSettingsModalEvent } from "./GraphicsSettingsModal";
const cursorPriceIcon = assetUrl("images/CursorPriceIconWhite.svg");
const emojiIcon = assetUrl("images/EmojiIconWhite.svg");
const exitIcon = assetUrl("images/ExitIconWhite.svg");
const mouseIcon = assetUrl("images/MouseIconWhite.svg");
const ninjaIcon = assetUrl("images/NinjaIconWhite.svg");
const settingsIcon = assetUrl("images/SettingIconWhite.svg");
const sirenIcon = assetUrl("images/SirenIconWhite.svg");
const swordIcon = assetUrl("images/SwordIconWhite.svg");
const treeIcon = assetUrl("images/TreeIconWhite.svg");
const musicIcon = assetUrl("images/music.svg");

export class ShowSettingsModalEvent {
  constructor(
    public readonly isVisible: boolean = true,
    public readonly shouldPause: boolean = false,
    public readonly isPaused: boolean = false,
  ) {}
}

@customElement("settings-modal")
export class SettingsModal extends LitElement implements Controller {
  public eventBus: EventBus;
  public userSettings: UserSettings;

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

  init() {
    this.eventBus.on(ShowSettingsModalEvent, (event) => {
      this.isVisible = event.isVisible;
      this.shouldPause = event.shouldPause;
      this.wasPausedWhenOpened = event.isPaused;
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
    if (this.shouldPause && !this.wasPausedWhenOpened) {
      if (pause) {
        crazyGamesSDK.gameplayStop();
      } else {
        crazyGamesSDK.gameplayStart();
      }
      this.eventBus.emit(new PauseGameIntentEvent(pause));
    }
  }

  private onTerrainButtonClick() {
    this.alternateView = !this.alternateView;
    this.eventBus.emit(new AlternateViewEvent(this.alternateView));
    this.requestUpdate();
  }

  private onToggleEmojisButtonClick() {
    this.userSettings.toggleEmojis();
    this.requestUpdate();
  }

  private onToggleAlertFrameButtonClick() {
    this.userSettings.toggleAlertFrame();
    this.requestUpdate();
  }

  private onToggleHelpMessagesButtonClick() {
    this.userSettings.toggleHelpMessages();
    this.requestUpdate();
  }

  private onToggleRandomNameModeButtonClick() {
    this.userSettings.toggleRandomName();
    this.requestUpdate();
  }

  private onToggleLeftClickOpensMenu() {
    this.userSettings.toggleLeftClickOpenMenu();
    this.requestUpdate();
  }

  private onToggleCursorCostLabelButtonClick() {
    this.userSettings.toggleCursorCostLabel();
    this.requestUpdate();
  }

  private onToggleAttackingTroopsOverlayButtonClick() {
    this.userSettings.toggleAttackingTroopsOverlay();
    this.requestUpdate();
  }

  private onTogglePerformanceOverlayButtonClick() {
    this.userSettings.togglePerformanceOverlay();
    this.requestUpdate();
  }

  private onRenderDebugGuiButtonClick() {
    this.eventBus.emit(new ToggleRenderDebugGuiEvent());
    this.closeModal();
  }

  private onGraphicsSettingsButtonClick() {
    this.eventBus.emit(
      new ShowGraphicsSettingsModalEvent(
        true,
        this.shouldPause,
        this.wasPausedWhenOpened,
      ),
    );
    this.closeModal({ keepPause: true });
  }

  private onExitButtonClick() {
    // redirect to the home page
    window.location.href = "/";
  }

  private onVolumeChange(event: Event) {
    const volume = parseFloat((event.target as HTMLInputElement).value) / 100;
    this.userSettings.setBackgroundMusicVolume(volume);
    this.eventBus.emit(new SetBackgroundMusicVolumeEvent(volume));
    this.requestUpdate();
  }

  private onSoundEffectsVolumeChange(event: Event) {
    const volume = parseFloat((event.target as HTMLInputElement).value) / 100;
    this.userSettings.setSoundEffectsVolume(volume);
    this.eventBus.emit(new SetSoundEffectsVolumeEvent(volume));
    this.requestUpdate();
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
                alt="settings"
                width="24"
                height="24"
                class="align-middle"
              />
              <h2 class="text-xl font-semibold text-white">
                ${translateText("user_setting.tab_basic")}
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
            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onGraphicsSettingsButtonClick}"
            >
              <img
                src=${settingsIcon}
                alt="graphicsSettings"
                width="20"
                height="20"
              />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.graphics_settings_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.graphics_settings_desc")}
                </div>
              </div>
            </button>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <img src=${musicIcon} alt="musicIcon" width="20" height="20" />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.background_music_volume")}
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  .value=${this.userSettings.backgroundMusicVolume() * 100}
                  @input=${this.onVolumeChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400">
                ${Math.round(this.userSettings.backgroundMusicVolume() * 100)}%
              </div>
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <img
                src=${musicIcon}
                alt="soundEffectsIcon"
                width="20"
                height="20"
              />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.sound_effects_volume")}
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  .value=${this.userSettings.soundEffectsVolume() * 100}
                  @input=${this.onSoundEffectsVolumeChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400">
                ${Math.round(this.userSettings.soundEffectsVolume() * 100)}%
              </div>
            </div>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onTerrainButtonClick}"
            >
              <img src=${treeIcon} alt="treeIcon" width="20" height="20" />
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

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onToggleEmojisButtonClick}"
            >
              <img src=${emojiIcon} alt="emojiIcon" width="20" height="20" />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.emojis_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.emojis_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings.emojis()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onToggleAlertFrameButtonClick}"
            >
              <img src=${sirenIcon} alt="alertFrame" width="20" height="20" />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.alert_frame_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.alert_frame_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings.alertFrame()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onToggleHelpMessagesButtonClick}"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle
                  cx="10"
                  cy="10"
                  r="9"
                  stroke="white"
                  stroke-width="1.5"
                />
                <path
                  d="M10 9V14"
                  stroke="white"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
                <circle cx="10" cy="6.5" r="1" fill="white" />
              </svg>
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.help_messages_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.help_messages_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings.helpMessages()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onToggleAttackingTroopsOverlayButtonClick}"
            >
              <img src=${swordIcon} alt="swordIcon" width="20" height="20" />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText(
                    "user_setting.attacking_troops_overlay_label",
                  )}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.attacking_troops_overlay_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings.attackingTroopsOverlay()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onToggleCursorCostLabelButtonClick}"
            >
              <img
                src=${cursorPriceIcon}
                alt="cursorCostLabel"
                width="20"
                height="20"
              />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.cursor_cost_label_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.cursor_cost_label_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings.cursorCostLabel()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onToggleRandomNameModeButtonClick}"
            >
              <img src=${ninjaIcon} alt="ninjaIcon" width="20" height="20" />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.anonymous_names_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.anonymous_names_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings.anonymousNames()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click="${this.onToggleLeftClickOpensMenu}"
            >
              <img src=${mouseIcon} alt="mouseIcon" width="20" height="20" />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.left_click_menu")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.left_click_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings.leftClickOpensMenu()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <div class="border-t border-slate-600 pt-3 mt-4">
              <div
                class="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wider"
              >
                ${translateText("user_setting.development_only")}
              </div>

              <button
                class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                @click="${this.onTogglePerformanceOverlayButtonClick}"
              >
                <img
                  src=${settingsIcon}
                  alt="performanceIcon"
                  width="20"
                  height="20"
                />
                <div class="flex-1">
                  <div class="font-medium">
                    ${translateText("user_setting.performance_overlay_label")}
                  </div>
                  <div class="text-sm text-slate-400">
                    ${translateText("user_setting.performance_overlay_desc")}
                  </div>
                </div>
                <div class="text-sm text-slate-400">
                  ${this.userSettings.performanceOverlay()
                    ? translateText("user_setting.on")
                    : translateText("user_setting.off")}
                </div>
              </button>

              <button
                class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                @click="${this.onRenderDebugGuiButtonClick}"
              >
                <img
                  src=${settingsIcon}
                  alt="renderDebugGui"
                  width="20"
                  height="20"
                />
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
                <img src=${exitIcon} alt="exitIcon" width="20" height="20" />
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
