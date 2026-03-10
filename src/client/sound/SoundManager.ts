import { Howl } from "howler";
import of4 from "../../../proprietary/sounds/music/of4.mp3";
import openfront from "../../../proprietary/sounds/music/openfront.mp3";
import war from "../../../proprietary/sounds/music/war.mp3";
import kaChingSound from "/sounds/effects/ka-ching.mp3?url";
import atomHitSound from "/sounds/effects/atom-hit.mp3?url";
import atomLaunchSound from "/sounds/effects/atom-launch.mp3?url";
import hydrogenHitSound from "/sounds/effects/hydrogen-hit.mp3?url";
import hydrogenLaunchSound from "/sounds/effects/hydrogen-launch.mp3?url";
import mirvLaunchSound from "/sounds/effects/mirv-launch.mp3?url";
import samHitSound from "/sounds/effects/sam-hit.mp3?url";
import samShootSound from "/sounds/effects/sam-shoot.mp3?url";
import warshipShotSound from "/sounds/effects/warship-shot.mp3?url";
import warshipLostSound from "/sounds/effects/warship-lost.mp3?url";

export enum SoundEffect {
  KaChing = "ka-ching",
  AtomHit = "atom-hit",
  AtomLaunch = "atom-launch",
  HydrogenHit = "hydrogen-hit",
  HydrogenLaunch = "hydrogen-launch",
  MIRVLaunch = "mirv-launch",
  SAMHit = "sam-hit",
  SAMShoot = "sam-shoot",
  WarshipShot = "warship-shot",
  WarshipLost = "warship-lost",
}

class SoundManager {
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
    this.loadSoundEffect(SoundEffect.AtomHit, atomHitSound);
    this.loadSoundEffect(SoundEffect.AtomLaunch, atomLaunchSound);
    this.loadSoundEffect(SoundEffect.HydrogenHit, hydrogenHitSound);
    this.loadSoundEffect(SoundEffect.HydrogenLaunch, hydrogenLaunchSound);
    this.loadSoundEffect(SoundEffect.MIRVLaunch, mirvLaunchSound);
    this.loadSoundEffect(SoundEffect.SAMHit, samHitSound);
    this.loadSoundEffect(SoundEffect.SAMShoot, samShootSound);
    this.loadSoundEffect(SoundEffect.WarshipShot, warshipShotSound);
    this.loadSoundEffect(SoundEffect.WarshipLost, warshipLostSound);
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

export default new SoundManager();
