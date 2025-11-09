import { Howl } from "howler";
import of4 from "../../../proprietary/sounds/music/of4.mp3";
import openfront from "../../../proprietary/sounds/music/openfront.mp3";
import war from "../../../proprietary/sounds/music/war.mp3";
import alarmSound from "../../../resources/sounds/effects/alarm.mp3";
import buildingDestroyedSound from "../../../resources/sounds/effects/building-destory.mp3";
import buildingSound from "../../../resources/sounds/effects/building.mp3";
import kaChingSound from "../../../resources/sounds/effects/ka-ching.mp3";

export enum SoundEffect {
  KaChing = "ka-ching",
  Building = "building",
  Alarm = "alarm",
  BuildingDestroyed = "building-destroyed",
}

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
    this.backgroundMusic = [
      new Howl({
        src: [of4],
        loop: false,
        onend: this.playNext.bind(this),
        volume: 0,
      }),
      new Howl({
        src: [openfront],
        loop: false,
        onend: this.playNext.bind(this),
        volume: 0,
      }),
      new Howl({
        src: [war],
        loop: false,
        onend: this.playNext.bind(this),
        volume: 0,
      }),
    ];
    this.loadSoundEffect(SoundEffect.KaChing, kaChingSound);
    this.loadSoundEffect(SoundEffect.Building, buildingSound);
    this.loadSoundEffect(SoundEffect.Alarm, alarmSound, false);
    this.loadSoundEffect(SoundEffect.BuildingDestroyed, buildingDestroyedSound);
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
    this.backgroundMusicVolume = Math.max(0, Math.min(1, volume));
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

  public playSoundEffect(name: SoundEffect): void {
    if (this.disabledSounds.has(name)) {
      return;
    }
    const sound = this.soundEffects.get(name);
    if (sound) {
      sound.play();
    }
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
    this.soundEffectsVolume = Math.max(0, Math.min(1, volume));
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
}

export default new SoundManager();
