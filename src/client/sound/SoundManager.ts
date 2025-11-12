import { Howl } from "howler";
import of4 from "../../../proprietary/sounds/music/of4.mp3";
import openfront from "../../../proprietary/sounds/music/openfront.mp3";
import war from "../../../proprietary/sounds/music/war.mp3";
import alarmSound from "../../../resources/sounds/effects/alarm.mp3";
import atomHitSound from "../../../resources/sounds/effects/atom_hit.mp3";
import atomLaunchSound from "../../../resources/sounds/effects/atom_launch.mp3";
import buildingDestroyedSound from "../../../resources/sounds/effects/building-destory.mp3";
import buildingSound from "../../../resources/sounds/effects/building.mp3";
import clickSound from "../../../resources/sounds/effects/click.mp3";
import gameOverSound from "../../../resources/sounds/effects/game_over.mp3";
import gameWinSound from "../../../resources/sounds/effects/gamewin.mp3";
import hydrogenHitSound from "../../../resources/sounds/effects/hydrogen_hit.mp3";
import hydrogenLaunchSound from "../../../resources/sounds/effects/hydrogen_launch.mp3";
import kaChingSound from "../../../resources/sounds/effects/ka-ching.mp3";
import mirvLaunchSound from "../../../resources/sounds/effects/mirv_launch.mp3";
import samSound from "../../../resources/sounds/effects/sam.mp3";
import stealBuildingSound from "../../../resources/sounds/effects/stealBuilding.mp3";
import { UserSettings } from "../../core/game/UserSettings";

export enum SoundEffect {
  KaChing = "ka-ching",
  Building = "building",
  Alarm = "alarm",
  BuildingDestroyed = "building-destroyed",
  StealBuilding = "steal-building",
  AtomLaunch = "atom-launch",
  AtomHit = "atom-hit",
  HydrogenLaunch = "hydrogen-launch",
  HydrogenHit = "hydrogen-hit",
  MIRVLaunch = "mirv-launch",
  SAMHit = "sam-hit",
  Click = "click",
  GameWin = "game-win",
  GameOver = "game-over",
}

interface SoundEffectConfig {
  effect: SoundEffect;
  src: string;
  loop?: boolean;
}

// Configuration for all sound effects
const SOUND_EFFECT_CONFIGS: SoundEffectConfig[] = [
  { effect: SoundEffect.KaChing, src: kaChingSound },
  { effect: SoundEffect.Building, src: buildingSound },
  { effect: SoundEffect.Alarm, src: alarmSound, loop: false },
  { effect: SoundEffect.BuildingDestroyed, src: buildingDestroyedSound },
  { effect: SoundEffect.StealBuilding, src: stealBuildingSound },
  { effect: SoundEffect.AtomLaunch, src: atomLaunchSound },
  { effect: SoundEffect.AtomHit, src: atomHitSound },
  { effect: SoundEffect.HydrogenLaunch, src: hydrogenLaunchSound },
  { effect: SoundEffect.HydrogenHit, src: hydrogenHitSound },
  { effect: SoundEffect.MIRVLaunch, src: mirvLaunchSound },
  { effect: SoundEffect.SAMHit, src: samSound },
  { effect: SoundEffect.Click, src: clickSound },
  { effect: SoundEffect.GameWin, src: gameWinSound },
  { effect: SoundEffect.GameOver, src: gameOverSound },
];

// Configuration for background music tracks
const BACKGROUND_MUSIC_TRACKS = [of4, openfront, war];

class SoundManager {
  private backgroundMusic: Howl[] = [];
  private currentTrack: number = 0;
  private soundEffects: Map<SoundEffect, Howl> = new Map();
  private soundEffectsVolume: number = 1;
  private backgroundMusicVolume: number = 0;
  private alarmEndHandlers: Map<SoundEffect, () => void> = new Map();
  private disabledSounds: Set<SoundEffect> = new Set();
  private backgroundMusicEnabled: boolean = true;

  constructor() {
    this.initializeBackgroundMusic();
    this.initializeSoundEffects();
  }

  private initializeBackgroundMusic(): void {
    this.backgroundMusic = BACKGROUND_MUSIC_TRACKS.map((src) =>
      this.createMusicTrack(src),
    );
    // Randomize which track plays first
    if (this.backgroundMusic.length > 0) {
      this.currentTrack = Math.floor(
        Math.random() * this.backgroundMusic.length,
      );
    }
  }

  private createMusicTrack(src: string): Howl {
    return new Howl({
      src: [src],
      loop: false,
      onend: this.playNext.bind(this),
      volume: 0,
    });
  }

  private initializeSoundEffects(): void {
    SOUND_EFFECT_CONFIGS.forEach((config) => {
      this.loadSoundEffect(config.effect, config.src, config.loop ?? false);
    });
  }

  private clampVolume(volume: number): number {
    return Math.max(0, Math.min(1, volume));
  }

  public playBackgroundMusic(): void {
    if (
      !this.backgroundMusicEnabled ||
      this.backgroundMusic.length === 0 ||
      this.backgroundMusic[this.currentTrack].playing()
    ) {
      return;
    }
    this.backgroundMusic[this.currentTrack].play();
  }

  public stopBackgroundMusic(): void {
    if (this.backgroundMusic.length > 0) {
      this.backgroundMusic[this.currentTrack].stop();
    }
  }

  public setBackgroundMusicVolume(volume: number): void {
    this.backgroundMusicVolume = this.clampVolume(volume);
    this.backgroundMusic.forEach((track) => {
      track.volume(this.backgroundMusicVolume);
    });
  }

  private playNext(): void {
    this.currentTrack = (this.currentTrack + 1) % this.backgroundMusic.length;
    this.playBackgroundMusic();
  }

  public loadSoundEffect(
    name: SoundEffect,
    src: string,
    loop: boolean = false,
  ): void {
    if (!this.soundEffects.has(name)) {
      const sound = new Howl({
        src: [src],
        volume: this.soundEffectsVolume,
        loop: loop,
      });
      this.soundEffects.set(name, sound);
    }
  }

  public playSoundEffect(name: SoundEffect, volume?: number): void {
    if (this.disabledSounds.has(name)) {
      return;
    }
    const sound = this.soundEffects.get(name);
    if (!sound) {
      return;
    }

    if (volume !== undefined) {
      // Skip early if master volume is muted
      if (this.soundEffectsVolume === 0) {
        return;
      }
      const scaledVolume = this.soundEffectsVolume * (volume ?? 1);
      const originalVolume = sound.volume();
      sound.volume(this.clampVolume(scaledVolume));
      sound.play();

      // Create a cleanup handler that restores volume and removes itself
      let restored = false;
      const cleanup = () => {
        if (!restored) {
          restored = true;
          sound.volume(originalVolume);
          sound.off("end", cleanup);
          sound.off("stop", cleanup);
        }
      };

      // Register cleanup handler for both "end" and "stop" events
      sound.once("end", cleanup);
      sound.once("stop", cleanup);
    } else {
      sound.play();
    }
  }

  /**
   * Plays the menu click sound effect with a standard volume.
   * This is a convenience method for the common pattern of playing click sounds in menus.
   */
  public playMenuClick(): void {
    this.playSoundEffect(SoundEffect.Click, 0.45);
  }

  public playSoundEffectNTimes(name: SoundEffect, times: number): void {
    if (this.disabledSounds.has(name)) {
      return;
    }
    const sound = this.soundEffects.get(name);
    if (!sound) return;

    // Remove any existing event listener for this sound
    const existingHandler = this.alarmEndHandlers.get(name);
    if (existingHandler) {
      sound.off("end", existingHandler);
    }

    // Stop any currently playing instance
    sound.stop();

    let playCount = 0;

    const onEnd = () => {
      playCount++;
      if (playCount < times) {
        sound.play();
      } else {
        sound.off("end", onEnd);
        this.alarmEndHandlers.delete(name);
      }
    };

    this.alarmEndHandlers.set(name, onEnd);
    sound.on("end", onEnd);
    sound.play();
  }

  public setSoundEffectsVolume(volume: number): void {
    this.soundEffectsVolume = this.clampVolume(volume);
    this.soundEffects.forEach((sound) => {
      sound.volume(this.soundEffectsVolume);
    });
  }

  public stopSoundEffect(name: SoundEffect): void {
    const sound = this.soundEffects.get(name);
    if (sound) {
      sound.stop();
    }
  }

  public unloadSoundEffect(name: SoundEffect): void {
    const sound = this.soundEffects.get(name);
    if (sound) {
      sound.unload();
      this.soundEffects.delete(name);
    }
  }

  public setSoundEffectEnabled(name: SoundEffect, enabled: boolean): void {
    if (enabled) {
      this.disabledSounds.delete(name);
    } else {
      this.disabledSounds.add(name);
      // Stop the sound if it's currently playing
      const sound = this.soundEffects.get(name);
      if (sound) {
        sound.stop();
      }
    }
  }

  public isSoundEffectEnabled(name: SoundEffect): boolean {
    return !this.disabledSounds.has(name);
  }

  public setBackgroundMusicEnabled(enabled: boolean): void {
    this.backgroundMusicEnabled = enabled;
    if (enabled) {
      this.playBackgroundMusic();
    } else {
      this.stopBackgroundMusic();
    }
  }

  public isBackgroundMusicEnabled(): boolean {
    return this.backgroundMusicEnabled;
  }

  /**
   * Initializes all sound settings from UserSettings.
   * This consolidates the repeated pattern of loading sound settings from user preferences.
   */
  public initializeFromUserSettings(userSettings: UserSettings): void {
    // Set volumes
    this.setBackgroundMusicVolume(userSettings.backgroundMusicVolume());
    this.setSoundEffectsVolume(userSettings.soundEffectsVolume());

    // Enable/disable all sound effects
    SOUND_EFFECT_CONFIGS.forEach((config) => {
      this.setSoundEffectEnabled(
        config.effect,
        userSettings.isSoundEffectEnabled(config.effect),
      );
    });

    // Set background music enabled state
    this.setBackgroundMusicEnabled(userSettings.isBackgroundMusicEnabled());
  }
}

export { SoundManager };
export default SoundManager;
