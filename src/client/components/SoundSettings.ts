import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import musicIcon from "../../../resources/images/music.svg";
import { UserSettings } from "../../core/game/UserSettings";
import { translateText } from "../Utils";
import { SoundEffect, SoundManager } from "../sound/SoundManager";

@customElement("sound-settings")
export class SoundSettings extends LitElement {
  @property({ type: Object })
  public userSettings!: UserSettings;

  @property({ type: Object })
  public soundManager!: SoundManager;

  createRenderRoot() {
    return this;
  }

  private onMasterVolumeChange(event: Event) {
    const inputValue = (event.target as HTMLInputElement).value;
    const sliderValue = parseFloat(inputValue);
    if (!isNaN(sliderValue) && sliderValue >= 0 && sliderValue <= 100) {
      const volume = sliderValue / 100;
      // Master volume controls both sound effects and background music
      this.userSettings.setSoundEffectsVolume(volume);
      this.userSettings.setBackgroundMusicVolume(volume);
      this.soundManager?.setSoundEffectsVolume(volume);
      this.soundManager?.setBackgroundMusicVolume(volume);
      this.requestUpdate();
    }
  }

  private onBackgroundMusicVolumeChange(event: Event) {
    const inputValue = (event.target as HTMLInputElement).value;
    const sliderValue = parseFloat(inputValue);
    if (!isNaN(sliderValue) && sliderValue >= 0 && sliderValue <= 100) {
      const volume = sliderValue / 100;
      this.userSettings.setBackgroundMusicVolume(volume);
      this.soundManager?.setBackgroundMusicVolume(volume);
      this.requestUpdate();
    }
  }

  private toggleSoundEffect(soundEffect: SoundEffect) {
    const enabled = !this.userSettings.isSoundEffectEnabled(soundEffect);
    this.userSettings.setSoundEffectEnabled(soundEffect, enabled);
    this.soundManager?.toggleSoundEffect(soundEffect, enabled);
    this.requestUpdate();
  }

  private toggleBackgroundMusic() {
    const enabled = !this.userSettings.isBackgroundMusicEnabled();
    this.userSettings.setBackgroundMusicEnabled(enabled);
    this.soundManager?.setBackgroundMusicEnabled(enabled);
    this.requestUpdate();
  }

  render() {
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
                Math.max(
                  (this.userSettings.soundEffectsVolume() ?? 1) * 100,
                  (this.userSettings.backgroundMusicVolume() || 0) * 100,
                ),
              ),
            )}
            @input=${this.onMasterVolumeChange}
            class="w-full border border-slate-500 rounded-lg mt-2"
          />
        </div>
        <div class="text-sm text-slate-400">
          ${Math.round(
            Math.max(
              (this.userSettings.soundEffectsVolume() ?? 1) * 100,
              (this.userSettings.backgroundMusicVolume() || 0) * 100,
            ),
          )}%
        </div>
      </div>

      <!-- Music Group -->
      <div class="border-t border-slate-600 pt-3 mt-2">
        <div class="text-center text-white text-base font-semibold mb-3">
          ${translateText("user_setting.sound_music_group")}
        </div>

        <button
          class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded text-white transition-colors mb-2"
          @click=${this.toggleBackgroundMusic}
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
              @input=${this.onBackgroundMusicVolumeChange}
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
          @click=${() => this.toggleSoundEffect(SoundEffect.KaChing)}
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
          @click=${() => this.toggleSoundEffect(SoundEffect.Building)}
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
          @click=${() => this.toggleSoundEffect(SoundEffect.BuildingDestroyed)}
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
          @click=${() => this.toggleSoundEffect(SoundEffect.Alarm)}
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
          @click=${() => this.toggleSoundEffect(SoundEffect.StealBuilding)}
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
          @click=${() => this.toggleSoundEffect(SoundEffect.AtomLaunch)}
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
          @click=${() => this.toggleSoundEffect(SoundEffect.AtomHit)}
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
          @click=${() => this.toggleSoundEffect(SoundEffect.HydrogenLaunch)}
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
          @click=${() => this.toggleSoundEffect(SoundEffect.HydrogenHit)}
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
          @click=${() => this.toggleSoundEffect(SoundEffect.MIRVLaunch)}
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
          @click=${() => this.toggleSoundEffect(SoundEffect.SAMHit)}
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
          @click=${() => this.toggleSoundEffect(SoundEffect.Click)}
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
          @click=${() => this.toggleSoundEffect(SoundEffect.GameWin)}
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
          @click=${() => this.toggleSoundEffect(SoundEffect.GameOver)}
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
