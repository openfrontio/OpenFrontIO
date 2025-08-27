import { AlternateViewEvent, RedrawGraphicsEvent } from "../../InputHandler";
import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { Layer } from "./Layer";
import { PauseGameEvent } from "../../Transport";
import { UserSettings } from "../../../core/game/UserSettings";
import colorBlindModeIcon from "../../../../resources/images/ColorBlindModeIconWhite.svg";
import darkModeIcon from "../../../../resources/images/DarkModeIconWhite.svg";
import emojiIcon from "../../../../resources/images/EmojiIconWhite.svg";
import exitIcon from "../../../../resources/images/ExitIconWhite.svg";
import explosionIcon from "../../../../resources/images/ExplosionIconWhite.svg";
import mouseIcon from "../../../../resources/images/MouseIconWhite.svg";
import ninjaIcon from "../../../../resources/images/NinjaIconWhite.svg";
import settingsIcon from "../../../../resources/images/SettingIconWhite.svg";
import structureIcon from "../../../../resources/images/CityIconWhite.svg";
import { translateText } from "../../Utils";
import treeIcon from "../../../../resources/images/TreeIconWhite.svg";

export class ShowSettingsModalEvent {
  constructor(
    public readonly isVisible = true,
    public readonly shouldPause = false,
    public readonly isPaused = false,
  ) {}
}

@customElement("settings-modal")
export class SettingsModal extends LitElement implements Layer {
  public eventBus: EventBus | undefined;
  public userSettings: UserSettings | undefined;

  @state()
  private isVisible = false;

  @state()
  private alternateView = false;

  @query(".modal-overlay")
  private readonly modalOverlay!: HTMLElement;

  @property({ type: Boolean })
  shouldPause = false;

  @property({ type: Boolean })
  wasPausedWhenOpened = false;

  init() {
    if (this.eventBus === undefined) throw new Error("Not initialized");
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

  private readonly handleOutsideClick = (event: MouseEvent) => {
    if (
      this.isVisible &&
      this.modalOverlay &&
      event.target === this.modalOverlay
    ) {
      this.closeModal();
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (this.isVisible && event.key === "Escape") {
      this.closeModal();
    }
  };

  public openModal() {
    this.isVisible = true;
    document.body.style.overflow = "hidden";
    this.requestUpdate();
  }

  public closeModal() {
    this.isVisible = false;
    document.body.style.overflow = "";
    this.requestUpdate();
    this.pauseGame(false);
  }

  private pauseGame(pause: boolean) {
    if (this.shouldPause && !this.wasPausedWhenOpened)
      this.eventBus?.emit(new PauseGameEvent(pause));
  }

  private onTerrainButtonClick() {
    this.alternateView = !this.alternateView;
    this.eventBus?.emit(new AlternateViewEvent(this.alternateView));
    this.requestUpdate();
  }

  private onToggleEmojisButtonClick() {
    this.userSettings?.toggleEmojis();
    this.requestUpdate();
  }

  private onToggleStructureSpritesButtonClick() {
    this.userSettings?.toggleStructureSprites();
    this.requestUpdate();
  }

  private onToggleSpecialEffectsButtonClick() {
    this.userSettings?.toggleFxLayer();
    this.requestUpdate();
  }

  private onToggleDarkModeButtonClick() {
    this.userSettings?.toggleDarkMode();
    this.eventBus?.emit(new RedrawGraphicsEvent());
    this.requestUpdate();
  }

  private onToggleColorBlindModeButtonClick() {
    this.userSettings?.toggleColorBlindMode();
    this.eventBus?.emit(new RedrawGraphicsEvent());
    this.requestUpdate();
  }

  private onToggleRandomNameModeButtonClick() {
    this.userSettings?.toggleRandomName();
    this.requestUpdate();
  }

  private onToggleLeftClickOpensMenu() {
    this.userSettings?.toggleLeftClickOpenMenu();
    this.requestUpdate();
  }

  private onTogglePerformanceOverlayButtonClick() {
    this.userSettings?.togglePerformanceOverlay();
    this.requestUpdate();
  }

  private onExitButtonClick() {
    // redirect to the home page
    window.location.href = "/";
  }

  render() {
    if (!this.isVisible) {
      return null;
    }

    return html`
      <div
        class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-[2000] flex items-center justify-center p-4"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div
          class="bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-w-md w-full max-h-[80vh] overflow-y-auto"
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
                style="vertical-align: middle;"
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

          <div class="p-4 space-y-3">
            <button
              class="flex gap-3 items-center w-full text-left p-3
              hover:bg-slate-700 rounded text-white transition-colors"
              @click="${this.onTerrainButtonClick}"
            >
              <img src=${treeIcon} alt="treeIcon" width="20" height="20" />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.toggle_terrain")}
                </div>
                <div class="text-sm text-slate-400">
                  ${this.alternateView
                    ? translateText("user_setting.terrain_enabled")
                    : translateText("user_setting.terrain_disabled")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.alternateView
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3
              hover:bg-slate-700 rounded text-white transition-colors"
              @click="${this.onToggleEmojisButtonClick}"
            >
              <img src=${emojiIcon} alt="emojiIcon" width="20" height="20" />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.emojis_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${this.userSettings?.emojis()
                    ? translateText("user_setting.emojis_visible")
                    : translateText("user_setting.emojis_hidden")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings?.emojis()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3
              hover:bg-slate-700 rounded text-white transition-colors"
              @click="${this.onToggleDarkModeButtonClick}"
            >
              <img
                src=${darkModeIcon}
                alt="darkModeIcon"
                width="20"
                height="20"
              />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.dark_mode_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${this.userSettings?.darkMode()
                    ? translateText("user_setting.dark_mode_enabled")
                    : translateText("user_setting.light_mode_enabled")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings?.darkMode()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3
              hover:bg-slate-700 rounded text-white transition-colors"
              @click="${this.onToggleColorBlindModeButtonClick}"
            >
              <img
                src=${colorBlindModeIcon}
                alt="colorBlindModeIcon"
                width="20"
                height="20"
              />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.color_blind_mode_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${this.userSettings?.colorBlindMode()
                    ? translateText("user_setting.color_blind_mode_enabled")
                    : translateText("user_setting.color_blind_mode_disabled")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings?.colorBlindMode()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3
              hover:bg-slate-700 rounded text-white transition-colors"
              @click="${this.onToggleSpecialEffectsButtonClick}"
            >
              <img
                src=${explosionIcon}
                alt="specialEffects"
                width="20"
                height="20"
              />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.special_effects_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${this.userSettings?.fxLayer()
                    ? translateText("user_setting.special_effects_enabled")
                    : translateText("user_setting.special_effects_disabled")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings?.fxLayer()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3
              hover:bg-slate-700 rounded text-white transition-colors"
              @click="${this.onToggleStructureSpritesButtonClick}"
            >
              <img
                src=${structureIcon}
                alt="structureSprites"
                width="20"
                height="20"
              />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.structure_sprites_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${this.userSettings?.structureSprites()
                    ? translateText("user_setting.structure_sprites_enabled")
                    : translateText("user_setting.structure_sprites_disabled")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings?.structureSprites()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3
              hover:bg-slate-700 rounded text-white transition-colors"
              @click="${this.onToggleRandomNameModeButtonClick}"
            >
              <img src=${ninjaIcon} alt="ninjaIcon" width="20" height="20" />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.anonymous_names_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${this.userSettings?.anonymousNames()
                    ? translateText("user_setting.anonymous_names_enabled")
                    : translateText("user_setting.real_names_shown")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings?.anonymousNames()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3
              hover:bg-slate-700 rounded text-white transition-colors"
              @click="${this.onToggleLeftClickOpensMenu}"
            >
              <img src=${mouseIcon} alt="mouseIcon" width="20" height="20" />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.left_click_menu")}
                </div>
                <div class="text-sm text-slate-400">
                  ${this.userSettings?.leftClickOpensMenu()
                    ? translateText("user_setting.left_click_opens_menu")
                    : translateText("user_setting.right_click_opens_menu")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings?.leftClickOpensMenu()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3
              hover:bg-slate-700 rounded text-white transition-colors"
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
                  ${this.userSettings?.performanceOverlay()
                    ? translateText("user_setting.performance_overlay_enabled")
                    : translateText(
                      "user_setting.performance_overlay_disabled",
                    )}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.userSettings?.performanceOverlay()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <div class="border-t border-slate-600 pt-3 mt-4">
              <button
                class="flex gap-3 items-center w-full text-left p-3
                hover:bg-red-600/20 rounded text-red-400 transition-colors"
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
