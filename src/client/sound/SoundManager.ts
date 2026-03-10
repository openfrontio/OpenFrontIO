import { Howl } from "howler";
import of4 from "../../../proprietary/sounds/music/of4.mp3";
import openfront from "../../../proprietary/sounds/music/openfront.mp3";
import war from "../../../proprietary/sounds/music/war.mp3";
import allianceBrokenSound from "/sounds/effects/alliance-broken.mp3?url";
import allianceSuggestedSound from "/sounds/effects/alliance-suggested.mp3?url";
import atomHitSound from "/sounds/effects/atom-hit.mp3?url";
import atomLaunchSound from "/sounds/effects/atom-launch.mp3?url";
import buildCitySound from "/sounds/effects/build-city.mp3?url";
import buildDefensePostSound from "/sounds/effects/build-defense-post.mp3?url";
import buildPortSound from "/sounds/effects/build-port.mp3?url";
import buildWarshipSound from "/sounds/effects/build-warship.mp3?url";
import clickSound from "/sounds/effects/click.mp3?url";
import hydrogenHitSound from "/sounds/effects/hydrogen-hit.mp3?url";
import hydrogenLaunchSound from "/sounds/effects/hydrogen-launch.mp3?url";
import kaChingSound from "/sounds/effects/ka-ching.mp3?url";
import messageSound from "/sounds/effects/message.mp3?url";
import mirvLaunchSound from "/sounds/effects/mirv-launch.mp3?url";
import samBuiltSound from "/sounds/effects/sam-built.mp3?url";

export enum SoundEffect {
  KaChing = "ka-ching",
  AtomHit = "atom-hit",
  AtomLaunch = "atom-launch",
  HydrogenHit = "hydrogen-hit",
  HydrogenLaunch = "hydrogen-launch",
  MIRVLaunch = "mirv-launch",
  AllianceSuggested = "alliance-suggested",
  AllianceBroken = "alliance-broken",
  BuildPort = "build-port",
  BuildCity = "build-city",
  BuildDefensePost = "build-defense-post",
  BuildWarship = "build-warship",
  SAMBuilt = "sam-built",
  Message = "message",
  Click = "click",
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
    this.loadSoundEffect(SoundEffect.AllianceSuggested, allianceSuggestedSound);
    this.loadSoundEffect(SoundEffect.AllianceBroken, allianceBrokenSound);
    this.loadSoundEffect(SoundEffect.BuildPort, buildPortSound);
    this.loadSoundEffect(SoundEffect.BuildCity, buildCitySound);
    this.loadSoundEffect(SoundEffect.BuildDefensePost, buildDefensePostSound);
    this.loadSoundEffect(SoundEffect.BuildWarship, buildWarshipSound);
    this.loadSoundEffect(SoundEffect.SAMBuilt, samBuiltSound);
    this.loadSoundEffect(SoundEffect.Message, messageSound);
    this.loadSoundEffect(SoundEffect.Click, clickSound);
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
