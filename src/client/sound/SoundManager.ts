import { assetUrl } from "@openfront/shared/AssetUrls";
import { EventBus } from "@openfront/shared/EventBus";
import { Howl } from "howler";
import { AudioMixer, PlayableCategory, streamsMusic } from "./AudioMixer";
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
  /** The game wants music playing, whether or not it is audible right now. */
  private wantsMusic = false;
  /** play() has been called, so it must not be called a second time. */
  private musicStarted = false;
  private ambienceTracks = new Map<AmbienceTrack, Howl>();
  private currentAmbience: AmbienceTrack | null = null;
  private fadingOut = new Set<Howl>();
  private fadingIn = new Set<Howl>();
  private onPlaySoundEffect: (e: PlaySoundEffectEvent) => void;
  private onSetAmbience: (e: SetAmbienceEvent) => void;
  private stopFollowingVolume: () => void;

  constructor(
    private readonly eventBus: EventBus,
    private readonly mixer: AudioMixer,
  ) {
    this.buildBackgroundMusic(streamsMusic());

    this.onPlaySoundEffect = (e) => this.mixer.play(e.effect);
    this.onSetAmbience = (e) => this.setAmbience(e.track, e.gain);
    eventBus.on(PlaySoundEffectEvent, this.onPlaySoundEffect);
    eventBus.on(SetAmbienceEvent, this.onSetAmbience);

    // Ambience is crossfaded here rather than registered with the mixer, so
    // the mixer cannot stomp a fade in progress. Re-target on every change.
    this.stopFollowingVolume = this.mixer.onChange((category) => {
      if (category === "ambience") this.retargetAmbience();
      if (category === "music") this.startMusicIfAudible();
    });
  }

  /**
   * Builds the looping gameplay track. One track that keeps looping —
   * including through the victory and defeat cues — so a game never hard-cuts
   * to silence, per the sound designer's note. The menu theme (MenuMusic.ts)
   * covers the home page.
   *
   * `preload` is a parameter rather than just `streamsMusic()` because a
   * rebuild after a failed load must not fetch on its own: that would retry
   * on a loop for as long as the file kept failing. A rebuild waits to be
   * asked, the way AudioMixer's discarded cues do.
   */
  private buildBackgroundMusic(preload: boolean): void {
    this.safely("initialize background music", () => {
      const music = new Howl({
        src: [assetUrl("sounds/music/gameplay.mp3")],
        loop: true,
        volume: 0,
        // Stream it. Howler's default Web Audio path XHRs the whole file and
        // decodes it to PCM before the first note, and this track is 4.6 MB,
        // so play() queued behind tens of seconds of silence at game start on
        // a slow connection. Cues and ambience stay on Web Audio.
        //
        // iOS is the exception: it ignores volume on a media element, so a
        // streamed track cannot be turned down or muted there at all, and Web
        // Audio is the only path with a working gain. Cues are unaffected
        // because they are already Web Audio.
        html5: streamsMusic(),
        // Web Audio holds the whole track decoded to PCM -- 209 seconds of
        // 44.1 kHz stereo is ~74 MB, an order of magnitude more than the file
        // -- so on iOS nothing is fetched or decoded until the music channel
        // is actually audible. See startMusicIfAudible.
        preload,
      });
      this.backgroundMusic = music;
      // Bound without an id, like AudioMixer's: Howler emits loaderror with a
      // null id for everything but a media-element error, and an id-bound
      // listener would be dead code for the cases that matter.
      music.once("loaderror", () => this.replaceFailedMusic(music));
      // Nothing is playing after a rejected play(), so let a later change try
      // again rather than latching the track off for the rest of the game.
      music.on("playerror", () => {
        this.musicStarted = false;
      });
      this.mixer.register(music, "music");
    });
  }

  /**
   * Swaps in a fresh Howl after a load that failed.
   *
   * The dead one cannot simply be retried: the play() that was queued behind
   * the failed load is still sitting in Howler's queue, so a later successful
   * load would drain that one as well as the one the retry asks for, and the
   * track would play over itself. Replacing it drops the queue with it.
   *
   * Deliberate rather than giving up: a blip on the CDN should not mean a
   * silent game, and the retry only costs a fetch when the player's own
   * volume change asks for one.
   */
  private replaceFailedMusic(failed: Howl): void {
    if (this.backgroundMusic !== failed) return;
    this.mixer.unregister(failed);
    this.safely("unload failed background music", () => failed.unload());
    this.backgroundMusic = null;
    this.musicStarted = false;
    this.buildBackgroundMusic(false);
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
    this.fadingIn.clear();
    this.currentAmbience = null;
  }

  private safely(action: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.warn(`SoundManager: failed to ${action}`, err);
    }
  }

  public playBackgroundMusic(): void {
    this.wantsMusic = true;
    this.startMusicIfAudible();
  }

  /**
   * Starts the track, loading it first if it is not loaded yet.
   *
   * Gated on the channel being audible because on the Web Audio path (iOS)
   * loading means holding the whole track decoded, and the web defaults every
   * channel to silence until the player opts in -- so a player who never
   * turns music on would otherwise pay the download and the decode for
   * something they never hear. Called again whenever the music channel
   * changes, so turning the slider up mid-game still starts it.
   *
   * isAudible, not volumeFor: the question is whether the player has the
   * channel on at all, not whether it happens to be ducked this instant.
   * Starting a track because the window regained focus would be wrong.
   */
  private startMusicIfAudible(): void {
    const music = this.backgroundMusic;
    if (music === null || !this.wantsMusic || this.musicStarted) return;
    if (!this.mixer.isAudible("music")) return;
    // Latched before play(), not after, and in preference to playing(): this
    // runs on every tick of a slider drag, and a Howl still loading reports
    // playing() === false while play() queues another sound each time. Those
    // all start when the load lands, so the track would play over itself
    // once per tick of the drag that started it.
    this.musicStarted = true;
    try {
      // Howler's play() queues behind a load but does not start one, so an
      // unloaded Howl would sit there silently forever without this.
      if (music.state() === "unloaded") music.load();
      music.play();
    } catch (err) {
      // Not safely(), which would leave the latch set on a throw: nothing
      // started, so a later change should be free to try again.
      this.musicStarted = false;
      console.warn("SoundManager: failed to play background music", err);
    }
  }

  public stopBackgroundMusic(): void {
    // Both cleared so a later volume change does not read a stale intent and
    // start the track again through startMusicIfAudible, while a later
    // playBackgroundMusic() still can.
    this.wantsMusic = false;
    this.musicStarted = false;
    this.safely("stop background music", () => this.backgroundMusic?.stop());
  }

  /** Kept for callers that still reach for it; the mixer owns cue playback. */
  public playSoundEffect(name: SoundEffect): void {
    this.mixer.play(name);
  }

  // ------------------------------------------------------------- ambience

  public setAmbience(track: AmbienceTrack | null, gain: number = 1): void {
    // Same track, so there is nothing to cross over: the gain is the whole
    // update and the mixer's change listener retargets the running loop.
    if (track === this.currentAmbience) {
      this.mixer.setAmbienceEnvelope(gain);
      return;
    }
    this.safely("set ambience", () => {
      // The outgoing loop has to start fading from the level it is audibly at,
      // so the new envelope lands *after* it. Leaving ambience range always
      // arrives as (null, 0); pushing that gain in first would run the mixer's
      // change listener back through retargetAmbience(), snap the outgoing
      // loop to silence, and turn the fade below into a hard cut.
      this.fadeOutCurrent();
      this.mixer.setAmbienceEnvelope(gain);
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
      // Howler's fade only completes while the volume is moving toward the
      // target, so any fade whose start equals its end hangs and leaks its
      // interval. Zero is the common case, but panning between two structures
      // at a constant zoom can also re-enter with the loop already at target.
      const from = howl.volume() as number;
      if (target === 0 || from === target) {
        this.fadingIn.delete(howl);
        howl.volume(target);
      } else {
        this.fadeInTo(howl, from, target);
      }
    });
  }

  /**
   * Ramps a loop up to `target` and remembers that it is moving, so a volume
   * change arriving mid-ramp can re-aim it instead of cutting it short.
   */
  private fadeInTo(howl: Howl, from: number, target: number): void {
    this.fadingIn.add(howl);
    howl.fade(from, target, AMBIENCE_FADE_MS);
    howl.once("fade", () => this.fadingIn.delete(howl));
  }

  /**
   * Follows the ambience channel while a loop is already running: the zoom
   * envelope moves every tick, and the slider can move at any time.
   *
   * Neither direction of an in-flight fade may be cut short by this. Howler's
   * volume() setter calls _stopFade internally, so a plain write lands the
   * loop on the new level instantly -- which is the abruptness the fades are
   * here to avoid. A fade-out is left alone; it is on its way to silence
   * whatever the envelope now says. A fade-in is re-aimed from wherever the
   * ramp has actually reached, so it stays smooth and still ends up at the
   * level the envelope is asking for.
   */
  private retargetAmbience(): void {
    if (this.currentAmbience === null) return;
    const howl = this.ambienceTracks.get(this.currentAmbience);
    if (howl === undefined || this.fadingOut.has(howl)) return;
    this.safely("retarget ambience", () => {
      const target = this.mixer.volumeFor("ambience");
      if (!this.fadingIn.has(howl)) {
        howl.volume(target);
        return;
      }
      const live = howl.volume() as number;
      // Drop the old ramp's completion handler before starting another, or it
      // would clear the fading-in flag out from under the new one.
      howl.off("fade");
      this.fadingIn.delete(howl);
      // Same trap as everywhere else: a fade from a value to itself never
      // completes in Howler. Landing on the target is all that is left to do.
      if (live === target) {
        howl.volume(target);
        return;
      }
      this.fadeInTo(howl, live, target);
    });
  }

  private fadeOutCurrent(): void {
    if (this.currentAmbience === null) return;
    const current = this.ambienceTracks.get(this.currentAmbience);
    if (current === undefined) return;
    // Whatever it was doing, it is leaving now.
    this.fadingIn.delete(current);
    const from = current.volume() as number;
    if (from === 0) {
      current.stop();
      // Flagged even though there is no fade to protect. setAmbience pushes
      // the new envelope in right after this, which runs the mixer's change
      // listener back through retargetAmbience() while currentAmbience is
      // still this outgoing track -- and with nothing to stop it, that stamps
      // the stopped loop with the INCOMING track's level. A later revisit
      // then reads that stale value as its starting volume, and if it happens
      // to equal the target it plays at full level instead of fading in.
      this.fadingOut.add(current);
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
      console.warn(`SoundManager: failed to load ambience ${name}`, err);
      return null;
    }
  }
}

export type { PlayableCategory };
