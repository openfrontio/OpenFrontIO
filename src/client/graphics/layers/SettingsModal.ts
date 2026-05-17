import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { crazyGamesSDK } from "src/client/CrazyGamesSDK";
import { PauseGameIntentEvent } from "src/client/Transport";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { UserSettings } from "../../../core/game/UserSettings";
import { AlternateViewEvent, RefreshGraphicsEvent } from "../../InputHandler";
import { translateText } from "../../Utils";
import {
  SetBackgroundMusicVolumeEvent,
  SetSoundEffectsVolumeEvent,
} from "../../sound/Sounds";
import { Layer } from "./Layer";
const structureIcon = assetUrl("images/CityIconWhite.svg");
const cursorPriceIcon = assetUrl("images/CursorPriceIconWhite.svg");
const darkModeIcon = assetUrl("images/DarkModeIconWhite.svg");
const emojiIcon = assetUrl("images/EmojiIconWhite.svg");
const exitIcon = assetUrl("images/ExitIconWhite.svg");
const explosionIcon = assetUrl("images/ExplosionIconWhite.svg");
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
export class SettingsModal extends LitElement implements Layer {
  public eventBus: EventBus;
  public userSettings: UserSettings;

  @state()
  private isVisible: boolean = false;

  @state()
  private alternateView: boolean = false;

  @state()
  private activePage: "main" | "sounds" | "effects" | "notifications" = "main";

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

  public closeModal() {
    this.isVisible = false;
    this.activePage = "main";
    this.requestUpdate();
    this.pauseGame(false);
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

  private onToggleStructureSpritesButtonClick() {
    this.userSettings.toggleStructureSprites();
    this.requestUpdate();
  }

  private onToggleSpecialEffectsButtonClick() {
    this.userSettings.toggleFxLayer();
    this.requestUpdate();
  }

  private onToggleAlertFrameButtonClick() {
    this.userSettings.toggleAlertFrame();
    this.requestUpdate();
  }

  private onToggleDarkModeButtonClick() {
    this.userSettings.toggleDarkMode();
    this.eventBus.emit(new RefreshGraphicsEvent());
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

  private toggleSoundEffect(effect: string) {
    this.userSettings.setSoundEffectEnabled(
      effect,
      !this.userSettings.isSoundEffectEnabled(effect),
    );
    this.requestUpdate();
  }

  private renderSoundsPage() {
    const sectionHeader = (label: string) => html`
      <div
        class="text-xs font-semibold uppercase tracking-wider text-slate-400 px-1 pt-3 pb-1 border-b border-slate-700 mb-1"
      >
        ${label}
      </div>
    `;

    const onOff = (enabled: boolean) =>
      enabled
        ? translateText("user_setting.on")
        : translateText("user_setting.off");

    const effectRow = (effect: string, label: string) => html`
      <button
        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
        @click=${() => this.toggleSoundEffect(effect)}
      >
        <img src=${musicIcon} alt=${label} width="20" height="20" />
        <div class="flex-1">
          <div class="font-medium">${label}</div>
        </div>
        <div class="text-sm text-slate-400">
          ${onOff(this.userSettings.isSoundEffectEnabled(effect))}
        </div>
      </button>
    `;

    return html`
      <!-- Volume -->
      ${sectionHeader(translateText("user_setting.sounds_category_volume"))}

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
            step="1"
          />
        </div>
        <div class="text-sm text-slate-400">
          ${Math.round(this.userSettings.backgroundMusicVolume() * 100)}%
        </div>
      </div>

      <div
        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
      >
        <img src=${musicIcon} alt="soundEffectsIcon" width="20" height="20" />
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
            step="1"
          />
        </div>
        <div class="text-sm text-slate-400">
          ${Math.round(this.userSettings.soundEffectsVolume() * 100)}%
        </div>
      </div>

      <!-- UI & Notifications -->
      ${sectionHeader(translateText("user_setting.sounds_category_ui"))}
      ${effectRow(
        "click",
        translateText("user_setting.sounds_effect_click_label"),
      )}
      ${effectRow(
        "game-start",
        translateText("user_setting.sounds_effect_game_start_label"),
      )}
      ${effectRow(
        "message",
        translateText("user_setting.sounds_effect_message_label"),
      )}
      ${effectRow(
        "ka-ching",
        translateText("user_setting.sounds_effect_ka_ching_label"),
      )}

      <!-- Weapons & Combat -->
      ${sectionHeader(translateText("user_setting.sounds_category_weapons"))}
      ${effectRow(
        "atom-launch",
        translateText("user_setting.sounds_effect_atom_launch_label"),
      )}
      ${effectRow(
        "atom-hit",
        translateText("user_setting.sounds_effect_atom_hit_label"),
      )}
      ${effectRow(
        "hydrogen-launch",
        translateText("user_setting.sounds_effect_hydrogen_launch_label"),
      )}
      ${effectRow(
        "hydrogen-hit",
        translateText("user_setting.sounds_effect_hydrogen_hit_label"),
      )}
      ${effectRow(
        "mirv-launch",
        translateText("user_setting.sounds_effect_mirv_launch_label"),
      )}

      <!-- Diplomacy -->
      ${sectionHeader(translateText("user_setting.sounds_category_diplomacy"))}
      ${effectRow(
        "alliance-suggested",
        translateText("user_setting.sounds_effect_alliance_suggested_label"),
      )}
      ${effectRow(
        "alliance-broken",
        translateText("user_setting.sounds_effect_alliance_broken_label"),
      )}

      <!-- Construction -->
      ${sectionHeader(
        translateText("user_setting.sounds_category_construction"),
      )}
      ${effectRow(
        "build-city",
        translateText("user_setting.sounds_effect_build_city_label"),
      )}
      ${effectRow(
        "build-port",
        translateText("user_setting.sounds_effect_build_port_label"),
      )}
      ${effectRow(
        "build-defense-post",
        translateText("user_setting.sounds_effect_build_defense_post_label"),
      )}
      ${effectRow(
        "build-warship",
        translateText("user_setting.sounds_effect_build_warship_label"),
      )}
      ${effectRow(
        "sam-built",
        translateText("user_setting.sounds_effect_sam_built_label"),
      )}
      ${effectRow(
        "upgrade",
        translateText("user_setting.sounds_effect_upgrade_label"),
      )}
      ${effectRow(
        "add-ammo",
        translateText("user_setting.sounds_effect_add_ammo_label"),
      )}
    `;
  }

  private async requestNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
      this.requestUpdate();
    }
  }

  private toggleFxEffect(effect: string) {
    this.userSettings.setFxEnabled(
      effect,
      !this.userSettings.isFxEnabled(effect),
    );
    this.requestUpdate();
  }

  private renderEffectsPage() {
    const sectionHeader = (label: string) => html`
      <div
        class="text-xs font-semibold uppercase tracking-wider text-slate-400 px-1 pt-3 pb-1 border-b border-slate-700 mb-1"
      >
        ${label}
      </div>
    `;

    const onOff = (enabled: boolean) =>
      enabled
        ? translateText("user_setting.on")
        : translateText("user_setting.off");

    const fxOff = !this.userSettings.fxLayer();
    const alertOff = !this.userSettings.alertFrame();

    const fxRow = (
      effect: string,
      label: string,
      disabled: boolean = false,
    ) => html`
      <button
        class="flex gap-3 items-center w-full text-left p-3 rounded-sm text-white transition-colors
          ${disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-slate-700"}"
        ?disabled=${disabled}
        @click=${disabled ? undefined : () => this.toggleFxEffect(effect)}
      >
        <img src=${explosionIcon} alt=${label} width="20" height="20" />
        <div class="flex-1">
          <div class="font-medium">${label}</div>
        </div>
        <div class="text-sm text-slate-400">
          ${onOff(this.userSettings.isFxEnabled(effect))}
        </div>
      </button>
    `;

    return html`
      <!-- Global toggles -->
      <button
        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
        @click="${this.onToggleSpecialEffectsButtonClick}"
      >
        <img src=${explosionIcon} alt="specialEffects" width="20" height="20" />
        <div class="flex-1">
          <div class="font-medium">
            ${translateText("user_setting.special_effects_label")}
          </div>
          <div class="text-sm text-slate-400">
            ${translateText("user_setting.special_effects_desc")}
          </div>
        </div>
        <div class="text-sm text-slate-400">
          ${onOff(this.userSettings.fxLayer())}
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
          ${onOff(this.userSettings.alertFrame())}
        </div>
      </button>

      ${sectionHeader(translateText("user_setting.fx_category_environment"))}
      ${fxRow(
        "fx-conquest",
        translateText("user_setting.fx_conquest_label"),
        fxOff,
      )}
      ${fxRow("fx-dust", translateText("user_setting.fx_dust_label"), fxOff)}
      ${sectionHeader(translateText("user_setting.fx_category_combat"))}
      ${fxRow(
        "fx-building-explosion",
        translateText("user_setting.fx_building_explosion_label"),
        fxOff,
      )}
      ${fxRow(
        "fx-shell-impact",
        translateText("user_setting.fx_shell_impact_label"),
        fxOff,
      )}
      ${fxRow(
        "fx-warship-sinking",
        translateText("user_setting.fx_warship_sinking_label"),
        fxOff,
      )}
      ${sectionHeader(translateText("user_setting.fx_category_nuclear"))}
      ${fxRow(
        "fx-nuke-telegraph",
        translateText("user_setting.fx_nuke_telegraph_label"),
        fxOff,
      )}
      ${fxRow(
        "fx-nuke-explosion",
        translateText("user_setting.fx_nuke_explosion_label"),
        fxOff,
      )}
      ${fxRow(
        "fx-nuke-debris",
        translateText("user_setting.fx_nuke_debris_label"),
        fxOff,
      )}
      ${fxRow(
        "fx-sam-interception",
        translateText("user_setting.fx_sam_interception_label"),
        fxOff,
      )}
      ${sectionHeader(translateText("user_setting.fx_category_alerts"))}
      ${fxRow(
        "alert-land-attack",
        translateText("user_setting.fx_alert_land_attack_label"),
        alertOff,
      )}
      ${fxRow(
        "alert-betrayal",
        translateText("user_setting.fx_alert_betrayal_label"),
        alertOff,
      )}
    `;
  }

  private renderNotificationsPage() {
    const supported = "Notification" in window;
    const permission = supported ? Notification.permission : "unsupported";

    const onOff = (enabled: boolean) =>
      enabled
        ? translateText("user_setting.on")
        : translateText("user_setting.off");

    const permissionLabel = () => {
      if (!supported)
        return translateText(
          "user_setting.notifications_permission_unsupported",
        );
      if (permission === "granted")
        return translateText("user_setting.notifications_permission_granted");
      if (permission === "denied")
        return translateText("user_setting.notifications_permission_denied");
      return translateText("user_setting.notifications_permission_default");
    };

    return html`
      <button
        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
        @click=${() => {
          this.userSettings.toggleGameStartNotifications();
          this.requestUpdate();
        }}
      >
        <img src=${sirenIcon} alt="notificationIcon" width="20" height="20" />
        <div class="flex-1">
          <div class="font-medium">
            ${translateText("user_setting.notifications_game_start_label")}
          </div>
          <div class="text-sm text-slate-400">
            ${translateText("user_setting.notifications_game_start_desc")}
          </div>
        </div>
        <div class="text-sm text-slate-400">
          ${onOff(this.userSettings.gameStartNotificationsEnabled())}
        </div>
      </button>

      ${supported
        ? html`
            <div
              class="flex gap-3 items-center w-full text-left p-3 rounded-sm text-white"
            >
              <img
                src=${sirenIcon}
                alt="permissionIcon"
                width="20"
                height="20"
              />
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText(
                    "user_setting.notifications_permission_label",
                  )}
                </div>
              </div>
              <div
                class="text-sm font-medium ${permission === "granted"
                  ? "text-green-400"
                  : permission === "denied"
                    ? "text-red-400"
                    : "text-slate-400"}"
              >
                ${permissionLabel()}
              </div>
            </div>
            ${permission === "default"
              ? html`
                  <button
                    class="mx-3 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md transition-colors"
                    @click=${this.requestNotificationPermission}
                  >
                    ${translateText(
                      "user_setting.notifications_permission_request",
                    )}
                  </button>
                `
              : null}
          `
        : null}
    `;
  }

  render() {
    if (!this.isVisible) {
      return null;
    }

    const isSubpage = this.activePage !== "main";
    const pageTitle = () => {
      if (this.activePage === "sounds")
        return translateText("user_setting.tab_sounds");
      if (this.activePage === "effects")
        return translateText("user_setting.tab_effects");
      if (this.activePage === "notifications")
        return translateText("user_setting.tab_notifications");
      return translateText("user_setting.tab_basic");
    };

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
              ${isSubpage
                ? html`
                    <button
                      class="text-slate-400 hover:text-white mr-1"
                      @click=${() => {
                        this.activePage = "main";
                        this.requestUpdate();
                      }}
                      aria-label=${translateText("common.back")}
                    >
                      ‹
                    </button>
                  `
                : html`
                    <img
                      src=${settingsIcon}
                      alt="settings"
                      width="24"
                      height="24"
                      class="align-middle"
                    />
                  `}
              <h2 class="text-xl font-semibold text-white">${pageTitle()}</h2>
            </div>
            <button
              class="text-slate-400 hover:text-white text-2xl font-bold leading-none"
              @click=${this.closeModal}
            >
              ×
            </button>
          </div>

          <div class="p-4 flex flex-col gap-3">
            ${this.activePage === "sounds"
              ? this.renderSoundsPage()
              : this.activePage === "effects"
                ? this.renderEffectsPage()
                : this.activePage === "notifications"
                  ? this.renderNotificationsPage()
                  : html`
                      <!-- Sounds submenu entry -->
                      <button
                        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                        @click=${() => {
                          this.activePage = "sounds";
                          this.requestUpdate();
                        }}
                      >
                        <img
                          src=${musicIcon}
                          alt="soundsIcon"
                          width="20"
                          height="20"
                        />
                        <div class="flex-1">
                          <div class="font-medium">
                            ${translateText("user_setting.tab_sounds")}
                          </div>
                        </div>
                        <div class="text-slate-400">›</div>
                      </button>

                      <!-- Effects submenu entry -->
                      <button
                        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                        @click=${() => {
                          this.activePage = "effects";
                          this.requestUpdate();
                        }}
                      >
                        <img
                          src=${explosionIcon}
                          alt="effectsIcon"
                          width="20"
                          height="20"
                        />
                        <div class="flex-1">
                          <div class="font-medium">
                            ${translateText("user_setting.tab_effects")}
                          </div>
                        </div>
                        <div class="text-slate-400">›</div>
                      </button>

                      <!-- Notifications submenu entry -->
                      <button
                        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                        @click=${() => {
                          this.activePage = "notifications";
                          this.requestUpdate();
                        }}
                      >
                        <img
                          src=${sirenIcon}
                          alt="notificationsIcon"
                          width="20"
                          height="20"
                        />
                        <div class="flex-1">
                          <div class="font-medium">
                            ${translateText("user_setting.tab_notifications")}
                          </div>
                        </div>
                        <div class="text-slate-400">›</div>
                      </button>

                      <button
                        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                        @click="${this.onTerrainButtonClick}"
                      >
                        <img
                          src=${treeIcon}
                          alt="treeIcon"
                          width="20"
                          height="20"
                        />
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
                        <img
                          src=${emojiIcon}
                          alt="emojiIcon"
                          width="20"
                          height="20"
                        />
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
                            ${translateText("user_setting.dark_mode_desc")}
                          </div>
                        </div>
                        <div class="text-sm text-slate-400">
                          ${this.userSettings.darkMode()
                            ? translateText("user_setting.on")
                            : translateText("user_setting.off")}
                        </div>
                      </button>

                      <button
                        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
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
                            ${translateText(
                              "user_setting.structure_sprites_label",
                            )}
                          </div>
                          <div class="text-sm text-slate-400">
                            ${translateText(
                              "user_setting.structure_sprites_desc",
                            )}
                          </div>
                        </div>
                        <div class="text-sm text-slate-400">
                          ${this.userSettings.structureSprites()
                            ? translateText("user_setting.on")
                            : translateText("user_setting.off")}
                        </div>
                      </button>

                      <button
                        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                        @click="${this
                          .onToggleAttackingTroopsOverlayButtonClick}"
                      >
                        <img
                          src=${swordIcon}
                          alt="swordIcon"
                          width="20"
                          height="20"
                        />
                        <div class="flex-1">
                          <div class="font-medium">
                            ${translateText(
                              "user_setting.attacking_troops_overlay_label",
                            )}
                          </div>
                          <div class="text-sm text-slate-400">
                            ${translateText(
                              "user_setting.attacking_troops_overlay_desc",
                            )}
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
                            ${translateText(
                              "user_setting.cursor_cost_label_label",
                            )}
                          </div>
                          <div class="text-sm text-slate-400">
                            ${translateText(
                              "user_setting.cursor_cost_label_desc",
                            )}
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
                        <img
                          src=${ninjaIcon}
                          alt="ninjaIcon"
                          width="20"
                          height="20"
                        />
                        <div class="flex-1">
                          <div class="font-medium">
                            ${translateText(
                              "user_setting.anonymous_names_label",
                            )}
                          </div>
                          <div class="text-sm text-slate-400">
                            ${translateText(
                              "user_setting.anonymous_names_desc",
                            )}
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
                        <img
                          src=${mouseIcon}
                          alt="mouseIcon"
                          width="20"
                          height="20"
                        />
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
                            ${translateText(
                              "user_setting.performance_overlay_label",
                            )}
                          </div>
                          <div class="text-sm text-slate-400">
                            ${translateText(
                              "user_setting.performance_overlay_desc",
                            )}
                          </div>
                        </div>
                        <div class="text-sm text-slate-400">
                          ${this.userSettings.performanceOverlay()
                            ? translateText("user_setting.on")
                            : translateText("user_setting.off")}
                        </div>
                      </button>

                      <div class="border-t border-slate-600 pt-3 mt-4">
                        <button
                          class="flex gap-3 items-center w-full text-left p-3 hover:bg-red-600/20 rounded-sm text-red-400 transition-colors"
                          @click="${this.onExitButtonClick}"
                        >
                          <img
                            src=${exitIcon}
                            alt="exitIcon"
                            width="20"
                            height="20"
                          />
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
                    `}
          </div>
        </div>
      </div>
    `;
  }
}
