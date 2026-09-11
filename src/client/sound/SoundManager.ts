import { Howl } from "howler";
import { assetUrl } from "../../core/AssetUrls";
import { EventBus } from "../../core/EventBus";
import { UserSettings } from "../../core/game/UserSettings";
import {
  AmbienceTrack,
  ambienceUrls,
  PlaySoundEffectEvent,
  SetAmbienceEvent,
  SetBackgroundMusicVolumeEvent,
  SetSoundEffectsVolumeEvent,
  SoundEffect,
  soundEffectUrls,
} from "./Sounds";

export const MAX_CONCURRENT_SOUNDS = 8;

// The sound assets are mastered to a -0.1 dB peak; the designer asks for a
// ~-5 dB master reduction on effects so several peaks firing at once don't
// clip. 10^(-5/20) ≈ 0.56.
export const EFFECTS_MASTER_GAIN = 0.56;

// "click" fans out to a random variant so rapid menu clicking doesn't sound
// like a stuck sample.
const CLICK_VARIANTS: readonly SoundEffect[] = [
  "click",
  "click-1",
  "click-2",
  "click-3",
];

const AMBIENCE_FADE_MS = 500;

export class SoundManager {
  private backgroundMusic: Howl[] = [];
  private currentTrack: number = 0;
  private soundEffects: Map<SoundEffect, Howl> = new Map();
  private ambienceTracks: Map<AmbienceTrack, Howl> = new Map();
  private currentAmbience: AmbienceTrack | null = null;
  private soundEffectsVolume: number = 1;
  private backgroundMusicVolume: number = 0;
  private activeSounds: { howl: Howl; id: number }[] = [];
  private eventBus: EventBus;
  private onPlaySoundEffect: (e: PlaySoundEffectEvent) => void;
  private onSetAmbience: (e: SetAmbienceEvent) => void;
  private onSetBackgroundMusicVolume: (
    e: SetBackgroundMusicVolumeEvent,
  ) => void;
  private onSetSoundEffectsVolume: (e: SetSoundEffectsVolumeEvent) => void;

  constructor(eventBus: EventBus, userSettings: UserSettings) {
    this.eventBus = eventBus;
    this.safely("initialize background music", () => {
      // Per the sound designer: one gameplay track that keeps looping —
      // including through the victory/defeat cue — so games never hard-cut
      // to silence. The menu theme (MenuMusic.ts) covers the home page.
      this.backgroundMusic = [
        new Howl({
          src: [assetUrl("sounds/music/gameplay.mp3")],
          loop: true,
          volume: 0,
        }),
      ];
    });
    this.setBackgroundMusicVolume(userSettings.backgroundMusicVolume());
    this.setSoundEffectsVolume(userSettings.soundEffectsVolume());
    this.onPlaySoundEffect = (e) => this.playSoundEffect(e.effect);
    this.onSetAmbience = (e) => this.setAmbience(e.track);
    this.onSetBackgroundMusicVolume = (e) =>
      this.setBackgroundMusicVolume(e.volume);
    this.onSetSoundEffectsVolume = (e) => this.setSoundEffectsVolume(e.volume);
    eventBus.on(PlaySoundEffectEvent, this.onPlaySoundEffect);
    eventBus.on(SetAmbienceEvent, this.onSetAmbience);
    eventBus.on(SetBackgroundMusicVolumeEvent, this.onSetBackgroundMusicVolume);
    eventBus.on(SetSoundEffectsVolumeEvent, this.onSetSoundEffectsVolume);
  }

  public dispose(): void {
    this.eventBus.off(PlaySoundEffectEvent, this.onPlaySoundEffect);
    this.eventBus.off(SetAmbienceEvent, this.onSetAmbience);
    this.eventBus.off(
      SetBackgroundMusicVolumeEvent,
      this.onSetBackgroundMusicVolume,
    );
    this.eventBus.off(SetSoundEffectsVolumeEvent, this.onSetSoundEffectsVolume);
    this.backgroundMusic.forEach((track) => {
      this.safely("stop background track", () => track.stop());
      this.safely("unload background track", () => track.unload());
    });
    this.soundEffects.forEach((sound) => {
      this.safely("stop sound effect", () => sound.stop());
      this.safely("unload sound effect", () => sound.unload());
    });
    this.soundEffects.clear();
    this.ambienceTracks.forEach((sound) => {
      this.safely("stop ambience track", () => sound.stop());
      this.safely("unload ambience track", () => sound.unload());
    });
    this.ambienceTracks.clear();
    this.currentAmbience = null;
    this.activeSounds = [];
  }

  private safely(action: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`SoundManager: failed to ${action}`, err);
    }
  }

  public playBackgroundMusic(): void {
    this.safely("play background music", () => {
      if (
        this.backgroundMusic.length > 0 &&
        !this.backgroundMusic[this.currentTrack].playing()
      ) {
        this.backgroundMusic[this.currentTrack].play();
      }
    });
  }

  public stopBackgroundMusic(): void {
    this.safely("stop background music", () => {
      if (this.backgroundMusic.length > 0) {
        this.backgroundMusic[this.currentTrack].stop();
      }
    });
  }

  // Slider positions are linear (0–1) but perceived loudness is roughly
  // logarithmic, so feeding the position straight to Howler makes the top of
  // the range sound identical. Square the position for an audio-taper curve.
  private perceptualGain(position: number): number {
    const clamped = Math.max(0, Math.min(1, position));
    return clamped * clamped;
  }

  public setBackgroundMusicVolume(volume: number): void {
    this.backgroundMusicVolume = this.perceptualGain(volume);
    this.safely("set background music volume", () => {
      this.backgroundMusic.forEach((track) => {
        track.volume(this.backgroundMusicVolume);
      });
    });
  }

  private getOrLoadSoundEffect(name: SoundEffect): Howl | null {
    let sound = this.soundEffects.get(name);
    if (sound) return sound;
    const src = soundEffectUrls.get(name);
    if (!src) return null;
    try {
      sound = new Howl({ src: [src], volume: this.soundEffectsVolume });
      this.soundEffects.set(name, sound);
      return sound;
    } catch (err) {
      console.error(`SoundManager: failed to load sound ${name}`, err);
      return null;
    }
  }

  private removeActiveSoundById(id: number): void {
    this.activeSounds = this.activeSounds.filter((s) => s.id !== id);
  }

  public playSoundEffect(name: SoundEffect): void {
    if (name === "click") {
      name = CLICK_VARIANTS[Math.floor(Math.random() * CLICK_VARIANTS.length)];
    }
    this.safely(`play sound ${name}`, () => {
      const howl = this.getOrLoadSoundEffect(name);
      if (!howl) return;

      if (this.activeSounds.length >= MAX_CONCURRENT_SOUNDS) {
        const oldest = this.activeSounds[0];
        oldest.howl.stop(oldest.id);
        this.removeActiveSoundById(oldest.id);
      }

      const id = howl.play();
      this.activeSounds.push({ howl, id });
      howl.once("end", () => this.removeActiveSoundById(id), id);
      howl.once("stop", () => this.removeActiveSoundById(id), id);
    });
  }

  public setSoundEffectsVolume(volume: number): void {
    this.soundEffectsVolume = this.perceptualGain(volume) * EFFECTS_MASTER_GAIN;
    this.safely("set sound effects volume", () => {
      this.soundEffects.forEach((sound) => {
        sound.volume(this.soundEffectsVolume);
      });
      this.ambienceTracks.forEach((sound) => {
        sound.volume(this.soundEffectsVolume);
      });
    });
  }

  public setAmbience(track: AmbienceTrack | null): void {
    if (track === this.currentAmbience) return;
    this.safely("set ambience", () => {
      if (this.currentAmbience !== null) {
        const current = this.ambienceTracks.get(this.currentAmbience);
        if (current) {
          current.fade(this.soundEffectsVolume, 0, AMBIENCE_FADE_MS);
          current.once("fade", () => current.stop());
        }
      }
      this.currentAmbience = track;
      if (track === null) return;
      const howl = this.getOrLoadAmbience(track);
      if (howl === null) return;
      // Cancel a pending fade-out stop in case this track is coming right
      // back; if it is still audibly fading, keep the running instance
      // rather than layering a second one.
      howl.off("fade");
      if (!howl.playing()) howl.play();
      howl.fade(0, this.soundEffectsVolume, AMBIENCE_FADE_MS);
    });
  }

  private getOrLoadAmbience(name: AmbienceTrack): Howl | null {
    let sound = this.ambienceTracks.get(name);
    if (sound) return sound;
    const src = ambienceUrls.get(name);
    if (!src) return null;
    try {
      sound = new Howl({
        src: [src],
        loop: true,
        volume: this.soundEffectsVolume,
      });
      this.ambienceTracks.set(name, sound);
      return sound;
    } catch (err) {
      console.error(`SoundManager: failed to load ambience ${name}`, err);
      return null;
    }
  }

  public stopSoundEffect(name: SoundEffect): void {
    this.safely(`stop sound ${name}`, () => {
      const howl = this.soundEffects.get(name);
      if (howl) {
        howl.stop();
        this.activeSounds = this.activeSounds.filter((s) => s.howl !== howl);
      }
    });
  }
}
