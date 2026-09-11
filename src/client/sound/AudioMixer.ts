import { Howl, Howler } from "howler";
import {
  AudioCategory,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../../core/game/UserSettings";
import { setCuePlayer } from "./CuePlayer";
import {
  AmbienceTrack,
  categoryOf,
  CueCategory,
  SoundEffect,
  soundEffectUrls,
} from "./Sounds";

/** Every channel a sound can actually play on. */
export type PlayableCategory = Exclude<AudioCategory, "master">;

const PLAYABLE: readonly PlayableCategory[] = [
  "music",
  "effects",
  "alerts",
  "ambience",
  "interface",
];

/**
 * Slider positions are linear but perceived loudness is roughly logarithmic,
 * so feeding the position straight to Howler makes the top of the range sound
 * identical. Squaring gives an audio taper.
 */
export function perceptualGain(position: number): number {
  const clamped = Math.max(0, Math.min(1, position));
  return clamped * clamped;
}

/**
 * Fixed per-channel trim, applied under the player's slider.
 *
 * The sound designer re-bounced the delivery 2 dB down, so effects need no
 * further attenuation — the -5 dB that used to sit here was written for the
 * older masters and stacked with the re-bounce. Music is the only material
 * whose inter-sample peaks still exceed 0 dBFS (+0.11 and +0.19 dBTP), so it
 * is the one channel that takes a trim. Ambience is attenuated by the zoom
 * envelope in AmbienceController, not here.
 */
const CATEGORY_TRIM: Record<PlayableCategory, number> = {
  music: 0.89, // -1 dB
  effects: 1,
  alerts: 1,
  ambience: 1,
  interface: 1,
};

/**
 * Concurrent one-shots per channel, replacing a single global cap. Budgets
 * never cross channels, so a burst of combat cannot silence an alert.
 */
const BUDGET: Record<CueCategory, number> = {
  effects: 6,
  alerts: 3,
  interface: 4,
  ambience: 2,
};

/**
 * Interface ticks drop the newest instead of stealing the oldest: a fifth tick
 * inside one drag is inaudible anyway, and stealing makes the ratchet stutter.
 */
const DROP_NEWEST: ReadonlySet<CueCategory> = new Set<CueCategory>([
  "interface",
]);

/** Representative cue per channel for the settings tab's test buttons. */
const PREVIEW_CUE: Record<Exclude<CueCategory, "ambience">, SoundEffect> = {
  effects: "build-city",
  alerts: "nuke-warning",
  interface: "click",
};

// Evicting with a hard stop clicks. Duck out over a few frames instead.
const EVICT_FADE_MS = 60;

interface ActiveSound {
  howl: Howl;
  id: number;
  category: CueCategory;
}

/**
 * Owns everything about how loud a sound is: the six channels, the window
 * focus duck, and the per-channel concurrency budgets.
 *
 * One instance per page, created in Main.ts, so the home page's menu theme and
 * the in-game SoundManager share it. It follows UserSettings directly through
 * USER_SETTINGS_CHANGED_EVENT rather than an EventBus, because the page and a
 * running game have different bus instances and volume has to reach both.
 */
export class AudioMixer {
  private volumes = new Map<AudioCategory, number>();
  private focused = true;
  private ambienceEnvelope = 1;
  /** Loops (music, ambience) whose volume must follow their channel. */
  private registered = new Map<Howl, PlayableCategory>();
  private cache = new Map<SoundEffect, Howl>();
  private active: ActiveSound[] = [];
  private disposers: (() => void)[] = [];
  private changeListeners = new Set<(category: PlayableCategory) => void>();

  constructor(private readonly userSettings: UserSettings) {
    for (const category of [...PLAYABLE, "master" as const]) {
      this.volumes.set(category, this.userSettings.audioVolume(category));
      this.followSetting(category);
    }
    this.followFocus();
    this.applyAll();
  }

  dispose(): void {
    this.disposers.forEach((off) => off());
    this.disposers = [];
    this.cache.forEach((howl) =>
      this.safely("unload cue", () => howl.unload()),
    );
    this.cache.clear();
    this.registered.clear();
    this.changeListeners.clear();
    this.active = [];
  }

  // ---------------------------------------------------------------- volumes

  /** Final gain for a channel: slider, trim, and the focus duck. */
  volumeFor(category: PlayableCategory): number {
    const slider = perceptualGain(this.volumes.get(category) ?? 0);
    const envelope = category === "ambience" ? this.ambienceEnvelope : 1;
    return (
      slider * CATEGORY_TRIM[category] * this.focusFactor(category) * envelope
    );
  }

  isAudible(category: AudioCategory): boolean {
    if ((this.volumes.get("master") ?? 0) === 0) return false;
    if (category === "master") return true;
    return (this.volumes.get(category) ?? 0) > 0;
  }

  /**
   * Zoom envelope for ambience, 0-1. Kept here rather than on the loop so the
   * value survives a track change mid-zoom.
   */
  setAmbienceEnvelope(gain: number): void {
    const clamped = Math.max(0, Math.min(1, gain));
    if (clamped === this.ambienceEnvelope) return;
    this.ambienceEnvelope = clamped;
    this.applyTo("ambience");
  }

  private focusFactor(category: PlayableCategory): number {
    if (this.focused) return 1;
    if (!this.userSettings.muteOnBlur()) return 1;
    // Alerts are information, not flavour: an inbound nuke should still reach
    // a player who has tabbed away, unless they have said otherwise.
    if (category === "alerts" && this.userSettings.alertsWhenUnfocused()) {
      return 1;
    }
    return 0;
  }

  private applyAll(): void {
    // Master is the one real GainNode Howler exposes; the rest is fan-out.
    this.safely("set master volume", () =>
      Howler.volume(perceptualGain(this.volumes.get("master") ?? 0)),
    );
    for (const category of PLAYABLE) this.applyTo(category);
  }

  /**
   * Notified when a channel's effective volume changes. For loops this class
   * does not own — ambience, which SoundManager crossfades — so they can
   * re-target without the mixer stomping a fade in progress.
   */
  onChange(listener: (category: PlayableCategory) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private applyTo(category: PlayableCategory): void {
    const volume = this.volumeFor(category);
    this.safely(`apply ${category} volume`, () => {
      this.registered.forEach((registeredCategory, howl) => {
        if (registeredCategory === category) howl.volume(volume);
      });
      for (const sound of this.active) {
        if (sound.category === category) sound.howl.volume(volume, sound.id);
      }
    });
    this.changeListeners.forEach((listener) =>
      this.safely("notify volume listener", () => listener(category)),
    );
  }

  private followSetting(category: AudioCategory): void {
    const type = `${USER_SETTINGS_CHANGED_EVENT}:settings.audio.${category}`;
    const handler = (event: Event) => {
      // detail is the serialised value — setCached stores strings.
      const raw = (event as CustomEvent<string>).detail;
      const parsed = typeof raw === "number" ? raw : parseFloat(raw);
      if (isNaN(parsed)) return;
      this.volumes.set(category, parsed);
      if (category === "master") this.applyAll();
      else this.applyTo(category);
    };
    globalThis.addEventListener(type, handler);
    this.disposers.push(() => globalThis.removeEventListener(type, handler));
  }

  private followFocus(): void {
    const update = () => {
      // hasFocus covers alt-tab; hidden covers a backgrounded tab that never
      // fired blur. Recomputed, never counted, so they cannot drift apart.
      const focused = !document.hidden && document.hasFocus();
      if (focused === this.focused) return;
      this.focused = focused;
      this.applyAll();
    };
    for (const type of ["blur", "focus"] as const) {
      globalThis.addEventListener(type, update);
      this.disposers.push(() => globalThis.removeEventListener(type, update));
    }
    document.addEventListener("visibilitychange", update);
    this.disposers.push(() =>
      document.removeEventListener("visibilitychange", update),
    );
  }

  // ------------------------------------------------------------------ loops

  /** Register a looping Howl so its volume follows its channel. */
  register(howl: Howl, category: PlayableCategory): void {
    this.registered.set(howl, category);
    this.safely("set registered volume", () =>
      howl.volume(this.volumeFor(category)),
    );
  }

  unregister(howl: Howl): void {
    this.registered.delete(howl);
  }

  // -------------------------------------------------------------- one-shots

  /** Plays a cue on its own channel, within that channel's budget. */
  play(name: SoundEffect): void {
    const category = categoryOf(name);
    this.safely(`play sound ${name}`, () => {
      const inCategory = this.active.filter((s) => s.category === category);
      if (inCategory.length >= BUDGET[category]) {
        if (DROP_NEWEST.has(category)) return;
        const oldest = inCategory[0];
        // Fade from the channel's current level rather than reading it back:
        // Howler's single-argument volume() is a getter only when the value
        // happens to match a sound id, so volume(id) is ambiguous by design.
        const from = this.volumeFor(category);
        if (from === 0) {
          // fade(0, 0, ...) never completes in Howler -- its done check needs
          // from !== to -- so the stop scheduled on "fade" would never run,
          // leaving the cue playing outside its budget with Howler's interval
          // and the listener leaked. A silent channel has nothing to fade.
          oldest.howl.stop(oldest.id);
        } else {
          oldest.howl.fade(from, 0, EVICT_FADE_MS, oldest.id);
          oldest.howl.once(
            "fade",
            () => oldest.howl.stop(oldest.id),
            oldest.id,
          );
        }
        this.forget(oldest.id);
      }

      const howl = this.load(name);
      if (howl === null) return;
      const id = howl.play();
      howl.volume(this.volumeFor(category), id);
      this.active.push({ howl, id, category });
      this.releaseOnce(howl, id, () => this.forget(id));
    });
  }

  /**
   * Plays a channel's representative cue for the settings tab's test buttons.
   * Resolves when it finishes, so the button's disabled state is the pending
   * promise. Resolves immediately when nothing would be heard.
   */
  previewCue(category: CueCategory): Promise<void> {
    if (category === "ambience") {
      // Ambience is a loop with no natural end; the tab previews it through
      // the normal ambience path instead.
      return Promise.resolve();
    }
    const name = PREVIEW_CUE[category];
    if (!this.isAudible(category)) return Promise.resolve();
    return new Promise((resolve) => {
      const howl = this.load(name);
      if (howl === null) {
        resolve();
        return;
      }
      const id = howl.play();
      howl.volume(this.volumeFor(category), id);
      this.active.push({ howl, id, category });
      this.releaseOnce(howl, id, () => {
        this.forget(id);
        resolve();
      });
    });
  }

  /**
   * Runs `done` on whichever of "end"/"stop" reaches this playback id first.
   *
   * Both have to be watched: a cue that runs out fires only "end", while one
   * stopped early (budget eviction, dispose) fires only "stop". Howler's
   * once() drops only the listener for the event that actually fired, so the
   * unfired sibling would otherwise sit on the Howl forever -- and these Howls
   * are cached per cue on a mixer that lives as long as the page, so a cue
   * like "click" would grow its listener list for the whole session. Clearing
   * the sibling here keeps exactly one registration per play.
   */
  private releaseOnce(howl: Howl, id: number, done: () => void): void {
    const release = () => {
      howl.off("end", release, id);
      howl.off("stop", release, id);
      done();
    };
    howl.once("end", release, id);
    howl.once("stop", release, id);
  }

  private load(name: SoundEffect): Howl | null {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const src = soundEffectUrls.get(name);
    if (!src) return null;
    try {
      const howl = new Howl({ src: [src] });
      this.cache.set(name, howl);
      return howl;
    } catch (err) {
      console.error(`AudioMixer: failed to load sound ${name}`, err);
      return null;
    }
  }

  private forget(id: number): void {
    this.active = this.active.filter((s) => s.id !== id);
  }

  private safely(action: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`AudioMixer: failed to ${action}`, err);
    }
  }
}

let instance: AudioMixer | null = null;

/** Created once, from Main.ts, before anything asks to play. */
export function initAudioMixer(userSettings: UserSettings): AudioMixer {
  instance?.dispose();
  instance = new AudioMixer(userSettings);
  setCuePlayer((name) => instance?.play(name));
  return instance;
}

/** Null until initAudioMixer runs — component tests mount without it. */
export function audioMixer(): AudioMixer | null {
  return instance;
}

/** Test seam: drops the singleton so each case starts clean. */
export function resetAudioMixerForTest(): void {
  instance?.dispose();
  instance = null;
  setCuePlayer(null);
}

export type { AmbienceTrack, CueCategory };
