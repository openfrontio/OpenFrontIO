import { Howl } from "howler";
import atomHitSound from "../../../proprietary/sounds/effects/atom_hit.mp3";
import atomLaunchSound from "../../../proprietary/sounds/effects/atom_launch.mp3";
import hydroHitSound from "../../../proprietary/sounds/effects/hydrogen_hit.mp3";
import hydroLaunchSound from "../../../proprietary/sounds/effects/hydrogen_launch.mp3";
import mirvLaunchSound from "../../../proprietary/sounds/effects/mirv_launch.mp3";
import of4 from "../../../proprietary/sounds/music/of4.mp3";
import openfront from "../../../proprietary/sounds/music/openfront.mp3";
import war from "../../../proprietary/sounds/music/war.mp3";
import kaChingSound from "../../../resources/sounds/effects/ka-ching.mp3";

export enum SoundEffect {
  KaChing = "ka-ching",
  AtomLaunch = "atom_launch",
  AtomHit = "atom_hit",
  HydroLaunch = "hydro_launch",
  HydroHit = "hydro_hit",
  MirvHit = "mirv_hit",
  MirvLaunch = "mirv_launch",
}

export class SoundManager {
  private backgroundMusic: Howl[] = [];
  private currentTrack: number = 0;
  private soundEffects: Map<SoundEffect, Howl> = new Map();
  private soundEffectsVolume: number = 1;
  private backgroundMusicVolume: number = 0;

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
    this.loadSoundEffect(SoundEffect.AtomLaunch, atomLaunchSound);
    this.loadSoundEffect(SoundEffect.AtomHit, atomHitSound);
    this.loadSoundEffect(SoundEffect.HydroLaunch, hydroLaunchSound);
    this.loadSoundEffect(SoundEffect.HydroHit, hydroHitSound);
    this.loadSoundEffect(SoundEffect.MirvHit, atomHitSound);
    this.loadSoundEffect(SoundEffect.MirvLaunch, mirvLaunchSound);
  }

  public playBackgroundMusic(): void {
    if (
      this.backgroundMusic.length > 0 &&
      !this.backgroundMusic[this.currentTrack].playing()
    ) {
      this.backgroundMusic[this.currentTrack].play();
    }
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

  public loadSoundEffect(name: SoundEffect, src: string): void {
    if (!this.soundEffects.has(name)) {
      const sound = new Howl({
        src: [src],
        volume: this.soundEffectsVolume,
      });
      this.soundEffects.set(name, sound);
    }
  }

  public playSoundEffect(name: SoundEffect): void {
    const sound = this.soundEffects.get(name);
    if (sound) {
      sound.play();
    }
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
}
