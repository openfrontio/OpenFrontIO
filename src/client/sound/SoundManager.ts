import { Howl } from "howler";
import { assetUrl } from "../../core/AssetUrls";
import { EventBus } from "../../core/EventBus";
import { AudioMixer, PlayableCategory } from "./AudioMixer";
import {
  AmbienceTrack,
  ambienceUrls,
  PlaySoundEffectEvent,
  SetAmbienceEvent,
  SoundEffect,
} from "./Sounds";

const AMBIENCE_FADE_MS = 500;

/**
 * The audio a running game owns: the looping gameplay track and the structure
 * ambience. Cue playback, channel volumes and the concurrency budgets all live
 * in AudioMixer, which outlives any one game.
 */
export class SoundManager {
  private backgroundMusic: Howl | null = null;
  private ambienceTracks = new Map<AmbienceTrack, Howl>();
  private currentAmbience: AmbienceTrack | null = null;
  private fadingOut = new Set<Howl>();
  private onPlaySoundEffect: (e: PlaySoundEffectEvent) => void;
  private onSetAmbience: (e: SetAmbienceEvent) => void;
  private stopFollowingVolume: () => void;

  constructor(
    private readonly eventBus: EventBus,
    private readonly mixer: AudioMixer,
  ) {
    this.safely("initialize background music", () => {
      // One track that keeps looping — including through the victory and
      // defeat cues — so a game never hard-cuts to silence, per the sound
      // designer's note. The menu theme (MenuMusic.ts) covers the home page.
      this.backgroundMusic = new Howl({
        src: [assetUrl("sounds/music/gameplay.mp3")],
        loop: true,
        volume: 0,
      });
      this.mixer.register(this.backgroundMusic, "music");
    });

    this.onPlaySoundEffect = (e) => this.mixer.play(e.effect);
    this.onSetAmbience = (e) => this.setAmbience(e.track, e.gain);
    eventBus.on(PlaySoundEffectEvent, this.onPlaySoundEffect);
    eventBus.on(SetAmbienceEvent, this.onSetAmbience);

    // Ambience is crossfaded here rather than registered with the mixer, so
    // the mixer cannot stomp a fade in progress. Re-target on every change.
    this.stopFollowingVolume = this.mixer.onChange((category) => {
      if (category === "ambience") this.retargetAmbience();
    });
  }

  dispose(): void {
    this.eventBus.off(PlaySoundEffectEvent, this.onPlaySoundEffect);
    this.eventBus.off(SetAmbienceEvent, this.onSetAmbience);
    this.stopFollowingVolume();
    if (this.backgroundMusic !== null) {
      const music = this.backgroundMusic;
      this.mixer.unregister(music);
      this.safely("stop background music", () => music.stop());
      this.safely("unload background music", () => music.unload());
      this.backgroundMusic = null;
    }
    this.ambienceTracks.forEach((sound) => {
      this.safely("stop ambience track", () => sound.stop());
      this.safely("unload ambience track", () => sound.unload());
    });
    this.ambienceTracks.clear();
    this.fadingOut.clear();
    this.currentAmbience = null;
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
      if (this.backgroundMusic !== null && !this.backgroundMusic.playing()) {
        this.backgroundMusic.play();
      }
    });
  }

  public stopBackgroundMusic(): void {
    this.safely("stop background music", () => this.backgroundMusic?.stop());
  }

  /** Kept for callers that still reach for it; the mixer owns cue playback. */
  public playSoundEffect(name: SoundEffect): void {
    this.mixer.play(name);
  }

  // ------------------------------------------------------------- ambience

  public setAmbience(track: AmbienceTrack | null, gain: number = 1): void {
    this.mixer.setAmbienceEnvelope(gain);
    if (track === this.currentAmbience) return;
    this.safely("set ambience", () => {
      this.fadeOutCurrent();
      this.currentAmbience = track;
      if (track === null) return;

      const target = this.mixer.volumeFor("ambience");
      const howl = this.getOrLoadAmbience(track);
      if (howl === null) return;
      // Cancel a pending fade-out stop in case this track is coming straight
      // back; if it is still audibly fading, keep the running instance rather
      // than layering a second one on top.
      howl.off("fade");
      this.fadingOut.delete(howl);
      if (!howl.playing()) howl.play();
      if (target === 0) {
        // fade(0, 0, ...) never completes in Howler — its done check needs
        // from !== to — so a zero-target fade would hang the callback.
        howl.volume(0);
      } else {
        howl.fade(howl.volume() as number, target, AMBIENCE_FADE_MS);
      }
    });
  }

  /**
   * Follows the ambience channel while a loop is already running: the zoom
   * envelope moves every tick, and the slider can move at any time. Skips
   * anything mid fade-out, which is on its way to silence regardless.
   */
  private retargetAmbience(): void {
    if (this.currentAmbience === null) return;
    const howl = this.ambienceTracks.get(this.currentAmbience);
    if (howl === undefined || this.fadingOut.has(howl)) return;
    this.safely("retarget ambience", () =>
      howl.volume(this.mixer.volumeFor("ambience")),
    );
  }

  private fadeOutCurrent(): void {
    if (this.currentAmbience === null) return;
    const current = this.ambienceTracks.get(this.currentAmbience);
    if (current === undefined) return;
    const from = current.volume() as number;
    if (from === 0) {
      current.stop();
      return;
    }
    this.fadingOut.add(current);
    current.fade(from, 0, AMBIENCE_FADE_MS);
    current.once("fade", () => {
      current.stop();
      this.fadingOut.delete(current);
    });
  }

  private getOrLoadAmbience(name: AmbienceTrack): Howl | null {
    const cached = this.ambienceTracks.get(name);
    if (cached) return cached;
    const src = ambienceUrls.get(name);
    if (!src) return null;
    try {
      const sound = new Howl({ src: [src], loop: true, volume: 0 });
      this.ambienceTracks.set(name, sound);
      return sound;
    } catch (err) {
      console.error(`SoundManager: failed to load ambience ${name}`, err);
      return null;
    }
  }
}

export type { PlayableCategory };
