import { Howl } from "howler";
import of4 from "../../../proprietary/sounds/music/of4.mp3";
import openfront from "../../../proprietary/sounds/music/openfront.mp3";
import war from "../../../proprietary/sounds/music/war.mp3";
import { assetUrl } from "../../core/AssetUrls";
import { ISoundManager, SoundEffect } from "./ISoundManager";
const allianceBrokenSound = assetUrl("sounds/effects/alliance-broken.mp3");
const allianceSuggestedSound = assetUrl(
  "sounds/effects/alliance-suggested.mp3",
);
const atomHitSound = assetUrl("sounds/effects/atom-hit.mp3");
const atomLaunchSound = assetUrl("sounds/effects/atom-launch.mp3");
const buildCitySound = assetUrl("sounds/effects/build-city.mp3");
const buildDefensePostSound = assetUrl("sounds/effects/build-defense-post.mp3");
const buildPortSound = assetUrl("sounds/effects/build-port.mp3");
const buildWarshipSound = assetUrl("sounds/effects/build-warship.mp3");
const clickSound = assetUrl("sounds/effects/click.mp3");
const hydrogenHitSound = assetUrl("sounds/effects/hydrogen-hit.mp3");
const hydrogenLaunchSound = assetUrl("sounds/effects/hydrogen-launch.mp3");
const kaChingSound = assetUrl("sounds/effects/ka-ching.mp3");
const messageSound = assetUrl("sounds/effects/message.mp3");
const mirvLaunchSound = assetUrl("sounds/effects/mirv-launch.mp3");
const samBuiltSound = assetUrl("sounds/effects/sam-built.mp3");

export class SoundManager implements ISoundManager {
  private backgroundMusic: Howl[] = [];
  private currentTrack: number = 0;
  private soundEffects: Map<SoundEffect, Howl> = new Map();
  private soundEffectsVolume: number = 1;
  private backgroundMusicVolume: number = 0;

  private static readonly soundEffectUrls: ReadonlyMap<SoundEffect, string> =
    new Map([
      [SoundEffect.KaChing, kaChingSound],
      [SoundEffect.AtomHit, atomHitSound],
      [SoundEffect.AtomLaunch, atomLaunchSound],
      [SoundEffect.HydrogenHit, hydrogenHitSound],
      [SoundEffect.HydrogenLaunch, hydrogenLaunchSound],
      [SoundEffect.MIRVLaunch, mirvLaunchSound],
      [SoundEffect.AllianceSuggested, allianceSuggestedSound],
      [SoundEffect.AllianceBroken, allianceBrokenSound],
      [SoundEffect.BuildPort, buildPortSound],
      [SoundEffect.BuildCity, buildCitySound],
      [SoundEffect.BuildDefensePost, buildDefensePostSound],
      [SoundEffect.BuildWarship, buildWarshipSound],
      [SoundEffect.SAMBuilt, samBuiltSound],
      [SoundEffect.Message, messageSound],
      [SoundEffect.Click, clickSound],
    ]);

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

  private getOrLoadSoundEffect(name: SoundEffect): Howl | null {
    let sound = this.soundEffects.get(name);
    if (sound) return sound;
    const src = SoundManager.soundEffectUrls.get(name);
    if (!src) return null;
    sound = new Howl({ src: [src], volume: this.soundEffectsVolume });
    this.soundEffects.set(name, sound);
    return sound;
  }

  public playSoundEffect(name: SoundEffect): void {
    const sound = this.getOrLoadSoundEffect(name);
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

export { SoundEffect } from "./ISoundManager";
export type { ISoundManager } from "./ISoundManager";
