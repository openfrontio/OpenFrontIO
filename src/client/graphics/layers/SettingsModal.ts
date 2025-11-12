import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import structureIcon from "../../../../resources/images/CityIconWhite.svg";
import darkModeIcon from "../../../../resources/images/DarkModeIconWhite.svg";
import emojiIcon from "../../../../resources/images/EmojiIconWhite.svg";
import exitIcon from "../../../../resources/images/ExitIconWhite.svg";
import explosionIcon from "../../../../resources/images/ExplosionIconWhite.svg";
import mouseIcon from "../../../../resources/images/MouseIconWhite.svg";
import ninjaIcon from "../../../../resources/images/NinjaIconWhite.svg";
import settingsIcon from "../../../../resources/images/SettingIconWhite.svg";
import treeIcon from "../../../../resources/images/TreeIconWhite.svg";
import musicIcon from "../../../../resources/images/music.svg";
import { EventBus } from "../../../core/EventBus";
import { UserSettings } from "../../../core/game/UserSettings";
import { AlternateViewEvent, RefreshGraphicsEvent } from "../../InputHandler";
import { PauseGameEvent } from "../../Transport";
import { translateText } from "../../Utils";
import {
  SoundConfig,
  SoundEffect,
  SoundManager,
} from "../../sound/SoundManager";
import { Layer } from "./Layer";

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
  public soundManager: SoundManager;

  @state()
  private isVisible: boolean = false;

  @state()
  private alternateView: boolean = false;

  @state()
  private settingsMode: "basic" | "sound" = "basic";

  @query(".modal-overlay")
  private modalOverlay!: HTMLElement;

  @property({ type: Boolean })
  shouldPause = false;

  @property({ type: Boolean })
  wasPausedWhenOpened = false;

  init() {
    // Initialize sound settings from user preferences
    if (this.soundManager) {
      const soundConfig: SoundConfig = {
        backgroundMusicVolume: this.userSettings.backgroundMusicVolume(),
        soundEffectsVolume: this.userSettings.soundEffectsVolume(),
        isSoundEffectEnabled: (soundEffect: SoundEffect) =>
          this.userSettings.isSoundEffectEnabled(soundEffect),
        isBackgroundMusicEnabled: this.userSettings.isBackgroundMusicEnabled(),
      };
      this.soundManager.updateConfig(soundConfig);
    }

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
      this.eventBus.emit(new PauseGameEvent(pause));
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

  private onTogglePerformanceOverlayButtonClick() {
    this.userSettings.togglePerformanceOverlay();
    this.requestUpdate();
  }

  private onExitButtonClick() {
    // redirect to the home page
    window.location.href = "/";
  }

  private onVolumeChange(event: Event) {
    const inputValue = (event.target as HTMLInputElement).value;
    const sliderValue = parseFloat(inputValue);
    if (!isNaN(sliderValue) && sliderValue >= 0 && sliderValue <= 100) {
      const volume = sliderValue / 100;
      this.userSettings.setBackgroundMusicVolume(volume);
      this.soundManager?.setBackgroundMusicVolume(volume);
      this.requestUpdate();
    }
  }

  private onSoundEffectsVolumeChange(event: Event) {
    const inputValue = (event.target as HTMLInputElement).value;
    const sliderValue = parseFloat(inputValue);
    if (!isNaN(sliderValue) && sliderValue >= 0 && sliderValue <= 100) {
      const volume = sliderValue / 100;
      this.userSettings.setSoundEffectsVolume(volume);
      this.soundManager?.setSoundEffectsVolume(volume);
      this.requestUpdate();
    }
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
                ${this.settingsMode === "basic"
                  ? translateText("user_setting.tab_basic")
                  : translateText("user_setting.tab_sound")}
              </h2>
            </div>
            <button
              class="text-slate-400 hover:text-white text-2xl font-bold leading-none"
              @click=${this.closeModal}
            >
              ×
            </button>
          </div>

          <!-- Tab Navigation -->
          <div class="flex border-b border-slate-600">
            <button
              class="flex-1 px-4 py-2 text-sm font-medium transition-colors duration-200 ${this
                .settingsMode === "basic"
                ? "text-blue-400 border-b-2 border-blue-400 bg-blue-400/10"
                : "text-gray-400 hover:text-white"}"
              @click=${() => (this.settingsMode = "basic")}
            >
              ${translateText("user_setting.tab_basic")}
            </button>
            <button
              class="flex-1 px-4 py-2 text-sm font-medium transition-colors duration-200 ${this
                .settingsMode === "sound"
                ? "text-blue-400 border-b-2 border-blue-400 bg-blue-400/10"
                : "text-gray-400 hover:text-white"}"
              @click=${() => (this.settingsMode = "sound")}
            >
              ${translateText("user_setting.tab_sound")}
            </button>
          </div>

          <div class="p-4 space-y-3">
            ${this.settingsMode === "basic"
              ? this.renderBasicSettings()
              : this.renderSoundSettings()}
          </div>
        </div>
      </div>
    `;
  }

  private renderBasicSettings() {
    return html`
      <button
        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors"
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
        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors"
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
        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors"
        @click="${this.onToggleDarkModeButtonClick}"
      >
        <img src=${darkModeIcon} alt="darkModeIcon" width="20" height="20" />
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
        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors"
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
          ${this.userSettings.fxLayer()
            ? translateText("user_setting.on")
            : translateText("user_setting.off")}
        </div>
      </button>

      <button
        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors"
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
            ${translateText("user_setting.structure_sprites_desc")}
          </div>
        </div>
        <div class="text-sm text-slate-400">
          ${this.userSettings.structureSprites()
            ? translateText("user_setting.on")
            : translateText("user_setting.off")}
        </div>
      </button>

      <button
        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors"
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
        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors"
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

      <button
        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors"
        @click="${this.onTogglePerformanceOverlayButtonClick}"
      >
        <img src=${settingsIcon} alt="performanceIcon" width="20" height="20" />
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

      <div class="border-t border-slate-600 pt-3 mt-4">
        <button
          class="flex gap-3 items-center w-full text-left p-3 hover:bg-red-600/20 rounded text-red-400 transition-colors"
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
    `;
  }

  private renderSoundSettings() {
    return html`
      <!-- Master Volume -->
      <div
        class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors"
      >
        <img src=${musicIcon} alt="musicIcon" width="20" height="20" />
        <div class="flex-1">
          <div class="font-medium">
            ${translateText("user_setting.sound_master_volume")}
          </div>
          <div class="text-sm text-slate-400">
            ${translateText("user_setting.sound_master_volume_desc")}
          </div>
          <input
            type="range"
            min="0"
            max="100"
            .value=${Math.max(
              0,
              Math.min(
                100,
                (this.userSettings.soundEffectsVolume() ?? 1) * 100,
              ),
            )}
            @input=${this.onSoundEffectsVolumeChange}
            class="w-full border border-slate-500 rounded-lg mt-2"
          />
        </div>
        <div class="text-sm text-slate-400">
          ${Math.round((this.userSettings.soundEffectsVolume() ?? 1) * 100)}%
        </div>
      </div>

      <!-- Music Group -->
      <div class="border-t border-slate-600 pt-3 mt-2">
        <div class="text-center text-white text-base font-semibold mb-3">
          ${translateText("user_setting.sound_music_group")}
        </div>

        <button
          class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors mb-2"
          @click=${() => {
            const enabled = !this.userSettings.isBackgroundMusicEnabled();
            this.userSettings.setBackgroundMusicEnabled(enabled);
            this.soundManager?.setBackgroundMusicEnabled(enabled);
            this.requestUpdate();
          }}
        >
          <img src=${musicIcon} alt="musicIcon" width="20" height="20" />
          <div class="flex-1">
            <div class="font-medium">
              ${translateText("user_setting.sound_music_enabled")}
            </div>
            <div class="text-sm text-slate-400">
              ${translateText("user_setting.sound_music_enabled_desc")}
            </div>
          </div>
          <div class="text-sm text-slate-400">
            ${this.userSettings.isBackgroundMusicEnabled()
              ? translateText("user_setting.on")
              : translateText("user_setting.off")}
          </div>
        </button>

        <div
          class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors"
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
              .value=${Math.max(
                0,
                Math.min(
                  100,
                  (this.userSettings.backgroundMusicVolume() || 0) * 100,
                ),
              )}
              @input=${this.onVolumeChange}
              class="w-full border border-slate-500 rounded-lg mt-2"
            />
          </div>
          <div class="text-sm text-slate-400">
            ${Math.round(
              (this.userSettings.backgroundMusicVolume() || 0) * 100,
            )}%
          </div>
        </div>
      </div>

      <!-- Sound Effects Group -->
      <div class="border-t border-slate-600 pt-3 mt-2">
        <div class="text-center text-white text-base font-semibold mb-3">
          ${translateText("user_setting.sound_effects_group")}
        </div>

        <button
          class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors mb-2"
          @click=${() => {
            const enabled = !this.userSettings.isSoundEffectEnabled(
              SoundEffect.KaChing,
            );
            this.userSettings.setSoundEffectEnabled(
              SoundEffect.KaChing,
              enabled,
            );
            this.soundManager?.toggleSoundEffect(SoundEffect.KaChing, enabled);
            this.requestUpdate();
          }}
        >
          <img src=${musicIcon} alt="soundIcon" width="20" height="20" />
          <div class="flex-1">
            <div class="font-medium">
              ${translateText("user_setting.sound_effect_ka_ching")}
            </div>
            <div class="text-sm text-slate-400">
              ${translateText("user_setting.sound_effect_ka_ching_desc")}
            </div>
          </div>
          <div class="text-sm text-slate-400">
            ${this.userSettings.isSoundEffectEnabled(SoundEffect.KaChing)
              ? translateText("user_setting.on")
              : translateText("user_setting.off")}
          </div>
        </button>

        <button
          class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors mb-2"
          @click=${() => {
            const enabled = !this.userSettings.isSoundEffectEnabled(
              SoundEffect.Building,
            );
            this.userSettings.setSoundEffectEnabled(
              SoundEffect.Building,
              enabled,
            );
            this.soundManager?.toggleSoundEffect(SoundEffect.Building, enabled);
            this.requestUpdate();
          }}
        >
          <img src=${musicIcon} alt="soundIcon" width="20" height="20" />
          <div class="flex-1">
            <div class="font-medium">
              ${translateText("user_setting.sound_effect_building")}
            </div>
            <div class="text-sm text-slate-400">
              ${translateText("user_setting.sound_effect_building_desc")}
            </div>
          </div>
          <div class="text-sm text-slate-400">
            ${this.userSettings.isSoundEffectEnabled(SoundEffect.Building)
              ? translateText("user_setting.on")
              : translateText("user_setting.off")}
          </div>
        </button>

        <button
          class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors mb-2"
          @click=${() => {
            const enabled = !this.userSettings.isSoundEffectEnabled(
              SoundEffect.BuildingDestroyed,
            );
            this.userSettings.setSoundEffectEnabled(
              SoundEffect.BuildingDestroyed,
              enabled,
            );
            this.soundManager?.toggleSoundEffect(
              SoundEffect.BuildingDestroyed,
              enabled,
            );
            this.requestUpdate();
          }}
        >
          <img src=${musicIcon} alt="soundIcon" width="20" height="20" />
          <div class="flex-1">
            <div class="font-medium">
              ${translateText("user_setting.sound_effect_building_destroyed")}
            </div>
            <div class="text-sm text-slate-400">
              ${translateText(
                "user_setting.sound_effect_building_destroyed_desc",
              )}
            </div>
          </div>
          <div class="text-sm text-slate-400">
            ${this.userSettings.isSoundEffectEnabled(
              SoundEffect.BuildingDestroyed,
            )
              ? translateText("user_setting.on")
              : translateText("user_setting.off")}
          </div>
        </button>

        <button
          class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors mb-2"
          @click=${() => {
            const enabled = !this.userSettings.isSoundEffectEnabled(
              SoundEffect.Alarm,
            );
            this.userSettings.setSoundEffectEnabled(SoundEffect.Alarm, enabled);
            this.soundManager?.toggleSoundEffect(SoundEffect.Alarm, enabled);
            this.requestUpdate();
          }}
        >
          <img src=${musicIcon} alt="soundIcon" width="20" height="20" />
          <div class="flex-1">
            <div class="font-medium">
              ${translateText("user_setting.sound_effect_alarm")}
            </div>
            <div class="text-sm text-slate-400">
              ${translateText("user_setting.sound_effect_alarm_desc")}
            </div>
          </div>
          <div class="text-sm text-slate-400">
            ${this.userSettings.isSoundEffectEnabled(SoundEffect.Alarm)
              ? translateText("user_setting.on")
              : translateText("user_setting.off")}
          </div>
        </button>

        <button
          class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors"
          @click=${() => {
            const enabled = !this.userSettings.isSoundEffectEnabled(
              SoundEffect.StealBuilding,
            );
            this.userSettings.setSoundEffectEnabled(
              SoundEffect.StealBuilding,
              enabled,
            );
            this.soundManager?.toggleSoundEffect(
              SoundEffect.StealBuilding,
              enabled,
            );
            this.requestUpdate();
          }}
        >
          <img src=${musicIcon} alt="soundIcon" width="20" height="20" />
          <div class="flex-1">
            <div class="font-medium">
              ${translateText("user_setting.sound_effect_steal_building")}
            </div>
            <div class="text-sm text-slate-400">
              ${translateText("user_setting.sound_effect_steal_building_desc")}
            </div>
          </div>
          <div class="text-sm text-slate-400">
            ${this.userSettings.isSoundEffectEnabled(SoundEffect.StealBuilding)
              ? translateText("user_setting.on")
              : translateText("user_setting.off")}
          </div>
        </button>

        <button
          class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors mb-2"
          @click=${() => {
            const enabled = !this.userSettings.isSoundEffectEnabled(
              SoundEffect.AtomLaunch,
            );
            this.userSettings.setSoundEffectEnabled(
              SoundEffect.AtomLaunch,
              enabled,
            );
            this.soundManager?.toggleSoundEffect(
              SoundEffect.AtomLaunch,
              enabled,
            );
            this.requestUpdate();
          }}
        >
          <img src=${musicIcon} alt="soundIcon" width="20" height="20" />
          <div class="flex-1">
            <div class="font-medium">
              ${translateText("user_setting.sound_effect_atom_launch")}
            </div>
            <div class="text-sm text-slate-400">
              ${translateText("user_setting.sound_effect_atom_launch_desc")}
            </div>
          </div>
          <div class="text-sm text-slate-400">
            ${this.userSettings.isSoundEffectEnabled(SoundEffect.AtomLaunch)
              ? translateText("user_setting.on")
              : translateText("user_setting.off")}
          </div>
        </button>

        <button
          class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors mb-2"
          @click=${() => {
            const enabled = !this.userSettings.isSoundEffectEnabled(
              SoundEffect.AtomHit,
            );
            this.userSettings.setSoundEffectEnabled(
              SoundEffect.AtomHit,
              enabled,
            );
            this.soundManager?.toggleSoundEffect(SoundEffect.AtomHit, enabled);
            this.requestUpdate();
          }}
        >
          <img src=${musicIcon} alt="soundIcon" width="20" height="20" />
          <div class="flex-1">
            <div class="font-medium">
              ${translateText("user_setting.sound_effect_atom_hit")}
            </div>
            <div class="text-sm text-slate-400">
              ${translateText("user_setting.sound_effect_atom_hit_desc")}
            </div>
          </div>
          <div class="text-sm text-slate-400">
            ${this.userSettings.isSoundEffectEnabled(SoundEffect.AtomHit)
              ? translateText("user_setting.on")
              : translateText("user_setting.off")}
          </div>
        </button>

        <button
          class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors mb-2"
          @click=${() => {
            const enabled = !this.userSettings.isSoundEffectEnabled(
              SoundEffect.HydrogenLaunch,
            );
            this.userSettings.setSoundEffectEnabled(
              SoundEffect.HydrogenLaunch,
              enabled,
            );
            this.soundManager?.toggleSoundEffect(
              SoundEffect.HydrogenLaunch,
              enabled,
            );
            this.requestUpdate();
          }}
        >
          <img src=${musicIcon} alt="soundIcon" width="20" height="20" />
          <div class="flex-1">
            <div class="font-medium">
              ${translateText("user_setting.sound_effect_hydrogen_launch")}
            </div>
            <div class="text-sm text-slate-400">
              ${translateText("user_setting.sound_effect_hydrogen_launch_desc")}
            </div>
          </div>
          <div class="text-sm text-slate-400">
            ${this.userSettings.isSoundEffectEnabled(SoundEffect.HydrogenLaunch)
              ? translateText("user_setting.on")
              : translateText("user_setting.off")}
          </div>
        </button>

        <button
          class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors mb-2"
          @click=${() => {
            const enabled = !this.userSettings.isSoundEffectEnabled(
              SoundEffect.HydrogenHit,
            );
            this.userSettings.setSoundEffectEnabled(
              SoundEffect.HydrogenHit,
              enabled,
            );
            this.soundManager?.toggleSoundEffect(
              SoundEffect.HydrogenHit,
              enabled,
            );
            this.requestUpdate();
          }}
        >
          <img src=${musicIcon} alt="soundIcon" width="20" height="20" />
          <div class="flex-1">
            <div class="font-medium">
              ${translateText("user_setting.sound_effect_hydrogen_hit")}
            </div>
            <div class="text-sm text-slate-400">
              ${translateText("user_setting.sound_effect_hydrogen_hit_desc")}
            </div>
          </div>
          <div class="text-sm text-slate-400">
            ${this.userSettings.isSoundEffectEnabled(SoundEffect.HydrogenHit)
              ? translateText("user_setting.on")
              : translateText("user_setting.off")}
          </div>
        </button>

        <button
          class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors"
          @click=${() => {
            const enabled = !this.userSettings.isSoundEffectEnabled(
              SoundEffect.MIRVLaunch,
            );
            this.userSettings.setSoundEffectEnabled(
              SoundEffect.MIRVLaunch,
              enabled,
            );
            this.soundManager?.toggleSoundEffect(
              SoundEffect.MIRVLaunch,
              enabled,
            );
            this.requestUpdate();
          }}
        >
          <img src=${musicIcon} alt="soundIcon" width="20" height="20" />
          <div class="flex-1">
            <div class="font-medium">
              ${translateText("user_setting.sound_effect_mirv_launch")}
            </div>
            <div class="text-sm text-slate-400">
              ${translateText("user_setting.sound_effect_mirv_launch_desc")}
            </div>
          </div>
          <div class="text-sm text-slate-400">
            ${this.userSettings.isSoundEffectEnabled(SoundEffect.MIRVLaunch)
              ? translateText("user_setting.on")
              : translateText("user_setting.off")}
          </div>
        </button>

        <button
          class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors mb-2"
          @click=${() => {
            const enabled = !this.userSettings.isSoundEffectEnabled(
              SoundEffect.SAMHit,
            );
            this.userSettings.setSoundEffectEnabled(
              SoundEffect.SAMHit,
              enabled,
            );
            this.soundManager?.toggleSoundEffect(SoundEffect.SAMHit, enabled);
            this.requestUpdate();
          }}
        >
          <img src=${musicIcon} alt="soundIcon" width="20" height="20" />
          <div class="flex-1">
            <div class="font-medium">
              ${translateText("user_setting.sound_effect_sam_hit")}
            </div>
            <div class="text-sm text-slate-400">
              ${translateText("user_setting.sound_effect_sam_hit_desc")}
            </div>
          </div>
          <div class="text-sm text-slate-400">
            ${this.userSettings.isSoundEffectEnabled(SoundEffect.SAMHit)
              ? translateText("user_setting.on")
              : translateText("user_setting.off")}
          </div>
        </button>

        <button
          class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors"
          @click=${() => {
            const enabled = !this.userSettings.isSoundEffectEnabled(
              SoundEffect.Click,
            );
            this.userSettings.setSoundEffectEnabled(SoundEffect.Click, enabled);
            this.soundManager?.toggleSoundEffect(SoundEffect.Click, enabled);
            this.requestUpdate();
          }}
        >
          <img src=${musicIcon} alt="soundIcon" width="20" height="20" />
          <div class="flex-1">
            <div class="font-medium">
              ${translateText("user_setting.sound_effect_click")}
            </div>
            <div class="text-sm text-slate-400">
              ${translateText("user_setting.sound_effect_click_desc")}
            </div>
          </div>
          <div class="text-sm text-slate-400">
            ${this.userSettings.isSoundEffectEnabled(SoundEffect.Click)
              ? translateText("user_setting.on")
              : translateText("user_setting.off")}
          </div>
        </button>

        <button
          class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors mb-2"
          @click=${() => {
            const enabled = !this.userSettings.isSoundEffectEnabled(
              SoundEffect.GameWin,
            );
            this.userSettings.setSoundEffectEnabled(
              SoundEffect.GameWin,
              enabled,
            );
            this.soundManager?.toggleSoundEffect(SoundEffect.GameWin, enabled);
            this.requestUpdate();
          }}
        >
          <img src=${musicIcon} alt="soundIcon" width="20" height="20" />
          <div class="flex-1">
            <div class="font-medium">
              ${translateText("user_setting.sound_effect_game_win")}
            </div>
            <div class="text-sm text-slate-400">
              ${translateText("user_setting.sound_effect_game_win_desc")}
            </div>
          </div>
          <div class="text-sm text-slate-400">
            ${this.userSettings.isSoundEffectEnabled(SoundEffect.GameWin)
              ? translateText("user_setting.on")
              : translateText("user_setting.off")}
          </div>
        </button>

        <button
          class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors"
          @click=${() => {
            const enabled = !this.userSettings.isSoundEffectEnabled(
              SoundEffect.GameOver,
            );
            this.userSettings.setSoundEffectEnabled(
              SoundEffect.GameOver,
              enabled,
            );
            this.soundManager?.toggleSoundEffect(SoundEffect.GameOver, enabled);
            this.requestUpdate();
          }}
        >
          <img src=${musicIcon} alt="soundIcon" width="20" height="20" />
          <div class="flex-1">
            <div class="font-medium">
              ${translateText("user_setting.sound_effect_game_over")}
            </div>
            <div class="text-sm text-slate-400">
              ${translateText("user_setting.sound_effect_game_over_desc")}
            </div>
          </div>
          <div class="text-sm text-slate-400">
            ${this.userSettings.isSoundEffectEnabled(SoundEffect.GameOver)
              ? translateText("user_setting.on")
              : translateText("user_setting.off")}
          </div>
        </button>
      </div>
    `;
  }
}
