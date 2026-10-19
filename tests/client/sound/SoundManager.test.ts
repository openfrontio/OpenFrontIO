import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const howlInstances: any[] = [];
let nextPlayId = 1;
const { howlerVolume } = vi.hoisted(() => ({ howlerVolume: vi.fn() }));

vi.mock("howler", () => {
  class MockHowl {
    src: string;
    loop: boolean;
    html5: boolean;
    preload: boolean;
    volumes: number[] = [];
    _state: "unloaded" | "loaded";
    state = vi.fn(() => this._state);
    // Howler's play() queues behind a load but never starts one, so the test
    // double must not load here either -- that is the bug being guarded.
    load = vi.fn(() => {
      this._state = "loaded";
      return this;
    });
    play = vi.fn(() => nextPlayId++);
    stop = vi.fn((id?: number) => this._fire("stop", id ?? -1));
    // Howler's volume() reports the live value during a fade and the target
    // once it lands; model the landed state so a crossfade reads a real level.
    fade = vi.fn((_from: number, to: number) => {
      this.volumes.push(to);
      return this;
    });
    playing = vi.fn().mockReturnValue(false);
    unload = vi.fn();
    volume = vi.fn((v?: number) => {
      if (v === undefined) return this.volumes[this.volumes.length - 1] ?? 0;
      this.volumes.push(v);
      return this;
    });
    once = vi.fn((event: string, cb: () => void, id?: number) => {
      if (!this._listeners.has(event)) this._listeners.set(event, new Map());
      this._listeners.get(event)!.set(id ?? -1, cb);
    });
    // Kept separate from once(): _fire deletes a once() listener, and these
    // have to survive being fired.
    on = vi.fn((event: string, cb: () => void, id?: number) => {
      if (!this._persistent.has(event)) this._persistent.set(event, new Map());
      this._persistent.get(event)!.set(id ?? -1, cb);
    });
    _persistent = new Map<string, Map<number, () => void>>();
    off = vi.fn();
    _listeners = new Map<string, Map<number, () => void>>();
    _fire(event: string, id: number) {
      const cb = this._listeners.get(event)?.get(id);
      if (cb) {
        this._listeners.get(event)!.delete(id);
        cb();
      }
      this._persistent.get(event)?.get(id)?.();
    }
    constructor(opts: any) {
      this.src = opts.src[0];
      this.loop = opts.loop ?? false;
      this.html5 = opts.html5 ?? false;
      this.preload = opts.preload ?? true;
      this._state = this.preload ? "loaded" : "unloaded";
      howlInstances.push(this);
    }
  }
  return { Howl: MockHowl, Howler: { volume: howlerVolume } };
});

import { EventBus } from "@openfront/shared/EventBus";
import { Platform } from "../../../src/client/Platform";
import {
  AudioMixer,
  resetAudioMixerForTest,
} from "../../../src/client/sound/AudioMixer";
import { SoundManager } from "../../../src/client/sound/SoundManager";
import {
  PlaySoundEffectEvent,
  SetAmbienceEvent,
} from "../../../src/client/sound/Sounds";
import { UserSettings } from "../../../src/client/UserSettings";

function resetSettings() {
  localStorage.clear();
  const statics = UserSettings as unknown as {
    cache: Map<string, string | null>;
    playerId: string | null;
  };
  statics.cache.clear();
  statics.playerId = null;
}

const find = (fragment: string) =>
  howlInstances.find((h) => h.src.includes(fragment));

const musicHowls = () =>
  howlInstances.filter((h) => h.src.includes("sounds/music/"));

/** The gameplay track the manager currently holds: the last one it built. */
const currentMusic = () => musicHowls()[musicHowls().length - 1];

/**
 * Runs `body` against a SoundManager built as though this were iOS.
 *
 * Rebuilt rather than flipped in place, because the platform is read when the
 * music Howl is constructed.
 */
function onIOS(body: () => void, options?: { music?: number }) {
  soundManager.dispose();
  mixer.dispose();
  howlInstances.length = 0;
  const previousIsIOS = Platform.isIOS;
  Platform.isIOS = true;
  try {
    build(options);
    body();
  } finally {
    Platform.isIOS = previousIsIOS;
  }
}

let eventBus: EventBus;
let settings: UserSettings;
let mixer: AudioMixer;
let soundManager: SoundManager;

function build({ ambience = 1, music = 1 } = {}) {
  settings = new UserSettings();
  settings.setAudioVolume("ambience", ambience);
  settings.setAudioVolume("music", music);
  settings.setAudioVolume("effects", 1);
  mixer = new AudioMixer(settings);
  eventBus = new EventBus();
  soundManager = new SoundManager(eventBus, mixer);
}

beforeEach(() => {
  howlInstances.length = 0;
  nextPlayId = 1;
  howlerVolume.mockClear();
  resetSettings();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  build();
});

afterEach(() => {
  soundManager?.dispose();
  mixer?.dispose();
  resetAudioMixerForTest();
  vi.restoreAllMocks();
});

describe("background music", () => {
  it("builds one track at a time, and does not loop it", () => {
    // On iOS a loaded track is ~75 MB of PCM, so the playlist must not hold
    // every track at once. Each one ends so the next can take over.
    expect(musicHowls().length).toBe(1);
    expect(currentMusic().loop).toBe(false);
  });

  it("starts on a random track", () => {
    soundManager.dispose();
    mixer.dispose();
    howlInstances.length = 0;
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    build();
    expect(currentMusic().src).toContain("gameplay-2.mp3");
  });

  it("plays the next track when one ends, and wraps around", () => {
    soundManager.dispose();
    mixer.dispose();
    howlInstances.length = 0;
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    build();
    soundManager.playBackgroundMusic();

    const last = currentMusic();
    expect(last.src).toContain("gameplay-3.mp3");
    last._fire("end", -1);

    // The finished track is released, not kept for the next time round.
    expect(last.unload).toHaveBeenCalled();
    const first = currentMusic();
    expect(first).not.toBe(last);
    expect(first.src).toContain("gameplay.mp3");
    expect(first.load).toHaveBeenCalled();
    expect(first.play).toHaveBeenCalledTimes(1);

    first._fire("end", -1);
    expect(currentMusic().src).toContain("gameplay-2.mp3");
    expect(currentMusic().play).toHaveBeenCalledTimes(1);
  });

  it("waits for music to be audible before fetching the next track", () => {
    soundManager.playBackgroundMusic();
    settings.setAudioVolume("music", 0);
    currentMusic()._fire("end", -1);

    const next = currentMusic();
    expect(next.load).not.toHaveBeenCalled();
    expect(next.play).not.toHaveBeenCalled();

    settings.setAudioVolume("music", 1);
    expect(next.load).toHaveBeenCalled();
    expect(next.play).toHaveBeenCalledTimes(1);
  });

  it("gives the next track the music channel's volume", () => {
    soundManager.playBackgroundMusic();
    settings.setAudioVolume("music", 0.5);
    currentMusic()._fire("end", -1);
    const next = currentMusic();
    expect(next.volumes[next.volumes.length - 1]).toBeCloseTo(0.25 * 0.89);
  });

  it("streams instead of waiting for the whole file to decode", () => {
    // Howler's default Web Audio path downloads and decodes the entire track
    // before the first note. Each track is ~4.5 MB, which was tens of seconds
    // of silence at game start. Ambience and cues stay on Web Audio, so this
    // has to stay specific to the music track.
    expect(currentMusic().html5).toBe(true);
  });

  it("uses Web Audio on iOS, where a streamed track cannot be turned down", () => {
    onIOS(() => {
      // iOS ignores volume writes to a media element, so the streamed track
      // could not be muted at all there (#5457).
      expect(currentMusic().html5).toBe(false);
    });
  });

  it("never fetches the track from the constructor", () => {
    // The Howl is built before anyone knows whether the player has music on,
    // and Howler's default preload would start the fetch right there: 4.6 MB
    // buffered on a media element, or ~74 MB of PCM on iOS. The web defaults
    // every channel to silence, so most of that is spent on players who hear
    // nothing. startMusicIfAudible does the one fetch instead.
    expect(currentMusic().preload).toBe(false);
    expect(currentMusic().load).not.toHaveBeenCalled();
  });

  it("defers the fetch until music is audible on every platform", () => {
    soundManager.dispose();
    mixer.dispose();
    howlInstances.length = 0;
    build({ music: 0 });

    const music = currentMusic();
    soundManager.playBackgroundMusic();
    expect(music.load).not.toHaveBeenCalled();

    settings.setAudioVolume("music", 1);
    expect(music.load).toHaveBeenCalled();
    expect(music.play).toHaveBeenCalled();
  });

  it("does not fetch or decode the track on iOS until music is audible", () => {
    // Web Audio holds the whole track as PCM -- ~74 MB for this one, against
    // a 4.6 MB file -- and the web defaults every channel to silence, so a
    // player who never turns music on must not pay for it.
    onIOS(
      () => {
        const music = currentMusic();
        soundManager.playBackgroundMusic();
        expect(music.preload).toBe(false);
        expect(music.load).not.toHaveBeenCalled();
        expect(music.play).not.toHaveBeenCalled();

        // Turning the slider up is what pays for it, and has to both load and
        // start the track: Howler's play() queues behind a load but never
        // starts one.
        settings.setAudioVolume("music", 1);
        expect(music.load).toHaveBeenCalled();
        expect(music.play).toHaveBeenCalled();
      },
      { music: 0 },
    );
  });

  it("does not stack playbacks across a slider drag before the load lands", () => {
    // A Howl still loading reports playing() === false while play() queues
    // another sound each time, so every tick of the drag that turned music on
    // would start the track again and they would all begin together.
    onIOS(
      () => {
        const music = currentMusic();
        soundManager.playBackgroundMusic();
        for (const v of [0.2, 0.4, 0.6, 0.8, 1]) {
          settings.setAudioVolume("music", v);
        }
        expect(music.play).toHaveBeenCalledTimes(1);
        expect(music.load).toHaveBeenCalledTimes(1);
      },
      { music: 0 },
    );
  });

  it("loads the track on iOS when music is already on", () => {
    onIOS(() => {
      const music = currentMusic();
      soundManager.playBackgroundMusic();
      expect(music.load).toHaveBeenCalled();
      expect(music.play).toHaveBeenCalled();
    });
  });

  it("can try again after a load that failed", () => {
    // The latch must not make one bad fetch permanent: a blip on the CDN
    // would otherwise mean a silent game, since every later slider change
    // reads the latch and declines.
    const failed = currentMusic();
    soundManager.playBackgroundMusic();
    expect(failed.play).toHaveBeenCalledTimes(1);

    failed._fire("loaderror", -1);

    // Replaced rather than reset: the play() queued behind the failed load is
    // still in Howler's queue, so reusing the Howl would start the track
    // twice once a later load succeeded.
    expect(failed.unload).toHaveBeenCalled();
    const replacement = currentMusic();
    expect(replacement).not.toBe(failed);
    // The same track again, not the next one.
    expect(replacement.src).toBe(failed.src);
    // Does not fetch on its own, or a permanently failing file would retry in
    // a loop.
    expect(replacement.preload).toBe(false);

    settings.setAudioVolume("music", 1);
    expect(replacement.load).toHaveBeenCalled();
    expect(replacement.play).toHaveBeenCalled();
  });

  it("releases the latch when playback itself is rejected", () => {
    const music = currentMusic();
    soundManager.playBackgroundMusic();
    expect(music.play).toHaveBeenCalledTimes(1);

    // Nothing is playing after a rejected play(), so a later change should be
    // free to ask again on the same Howl -- it loaded fine.
    music._fire("playerror", -1);
    settings.setAudioVolume("music", 1);
    expect(music.play).toHaveBeenCalledTimes(2);
  });

  it("follows the music slider through the mixer", () => {
    settings.setAudioVolume("music", 0.5);
    // 0.5 squared for the audio taper, then the -1 dB music trim.
    expect(
      currentMusic().volumes[currentMusic().volumes.length - 1],
    ).toBeCloseTo(0.25 * 0.89);
  });

  it("only starts once", () => {
    soundManager.playBackgroundMusic();
    const music = currentMusic();
    music.playing.mockReturnValue(true);
    soundManager.playBackgroundMusic();
    expect(music.play).toHaveBeenCalledTimes(1);
  });
});

describe("cue playback", () => {
  it("hands cues to the mixer, which routes them by channel", () => {
    const play = vi.spyOn(mixer, "play");
    eventBus.emit(new PlaySoundEffectEvent("build-city"));
    expect(play).toHaveBeenCalledWith("build-city");
  });
});

describe("ambience", () => {
  it("starts the requested loop and fades it up", () => {
    eventBus.emit(new SetAmbienceEvent("city", 0.1));
    const city = find("city.mp3");
    expect(city.loop).toBe(true);
    expect(city.play).toHaveBeenCalled();
    expect(city.fade).toHaveBeenCalled();
  });

  it("crossfades when the nearest structure changes", () => {
    eventBus.emit(new SetAmbienceEvent("city", 0.1));
    eventBus.emit(new SetAmbienceEvent("factory", 0.1));
    expect(find("city.mp3").fade).toHaveBeenCalledTimes(2); // up, then down
    expect(find("factory.mp3").play).toHaveBeenCalled();
  });

  it("does not restart the loop that is already playing", () => {
    eventBus.emit(new SetAmbienceEvent("city", 0.1));
    const city = find("city.mp3");
    city.playing.mockReturnValue(true);
    eventBus.emit(new SetAmbienceEvent("city", 0.1));
    expect(city.play).toHaveBeenCalledTimes(1);
  });

  it("tracks the zoom envelope without restarting the loop", () => {
    eventBus.emit(new SetAmbienceEvent("city", 0.1));
    const city = find("city.mp3");
    const plays = city.play.mock.calls.length;

    eventBus.emit(new SetAmbienceEvent("city", 0.05));

    expect(city.play.mock.calls.length).toBe(plays);
    // ambience slider 1 -> taper 1, times the 0.05 envelope.
    expect(city.volumes[city.volumes.length - 1]).toBeCloseTo(0.05);
  });

  it("does not fade a loop that is already at its target", () => {
    // Panning between two structures at a constant zoom can re-enter with the
    // loop still sitting at the target; fade(V, V, ...) never completes in
    // Howler and leaks its interval.
    eventBus.emit(new SetAmbienceEvent("city", 0.1));
    const city = find("city.mp3");
    eventBus.emit(new SetAmbienceEvent("factory", 0.1));
    // The fade-out has been issued but has not stepped the volume yet.
    city.volume(mixer.volumeFor("ambience"));
    city.fade.mockClear();

    eventBus.emit(new SetAmbienceEvent("city", 0.1));

    expect(city.fade).not.toHaveBeenCalled();
  });

  it("fades the loop out rather than cutting it when the player zooms out", () => {
    eventBus.emit(new SetAmbienceEvent("city", 0.1));
    const city = find("city.mp3");
    city.fade.mockClear();

    // Leaving ambience range always arrives as (null, 0). The zero envelope
    // must not reach the mixer before the fade-out starts, or the change
    // listener snaps this loop to silence and the fade turns into a hard cut.
    eventBus.emit(new SetAmbienceEvent(null, 0));

    expect(city.fade).toHaveBeenCalledTimes(1);
    const [from, to, ms] = city.fade.mock.calls[0];
    expect(from).toBeGreaterThan(0);
    expect(to).toBe(0);
    expect(ms).toBeGreaterThan(0);
    expect(city.stop).not.toHaveBeenCalled();
  });

  it("stays on web audio, which loops without a seam", () => {
    eventBus.emit(new SetAmbienceEvent("city", 0.1));
    expect(find("city.mp3").html5).toBe(false);
  });

  it("re-aims a fade-in instead of snapping it to the new level", () => {
    // AmbienceController re-emits for the same track whenever the zoom gain
    // moves past its epsilon, which lands inside the 500ms fade-in. Howler's
    // volume() setter calls _stopFade, so writing the volume there killed the
    // ramp and jumped the loop straight to full -- the exact abruptness the
    // fade exists to prevent.
    eventBus.emit(new SetAmbienceEvent("city", 0.1));
    const city = find("city.mp3");
    expect(city.fade).toHaveBeenCalledTimes(1);
    const volumeWrites = city.volume.mock.calls.filter(
      (c: unknown[]) => c.length > 0,
    ).length;

    eventBus.emit(new SetAmbienceEvent("city", 0.05));

    // Still a ramp, not a write, and aimed at the level the envelope now asks
    // for rather than stalling wherever the first ramp had reached.
    expect(city.fade).toHaveBeenCalledTimes(2);
    expect(
      city.volume.mock.calls.filter((c: unknown[]) => c.length > 0).length,
    ).toBe(volumeWrites);
    const [, to] = city.fade.mock.calls[1];
    expect(to).toBeCloseTo(0.05);
  });

  it("lands on the target when a retarget arrives after the fade-in ends", () => {
    eventBus.emit(new SetAmbienceEvent("city", 0.1));
    const city = find("city.mp3");
    // Howler fires "fade" when the ramp completes; the manager clears its
    // fading-in flag there, so later changes are plain writes again.
    city._fire("fade", -1);
    city.fade.mockClear();

    settings.setAudioVolume("ambience", 0.5);

    expect(city.fade).not.toHaveBeenCalled();
    expect(city.volumes[city.volumes.length - 1]).toBeCloseTo(0.25 * 0.1);
  });

  it("does not stamp the outgoing loop with the incoming track's level", () => {
    // Zoomed out to silence, so the outgoing loop is stopped rather than
    // faded. setAmbienceEnvelope then runs the mixer's change listener back
    // through retargetAmbience while currentAmbience is still the outgoing
    // track -- which used to write the INCOMING level onto the stopped Howl.
    eventBus.emit(new SetAmbienceEvent("city", 0.1));
    const city = find("city.mp3");
    settings.setAudioVolume("ambience", 0);
    eventBus.emit(new SetAmbienceEvent("city", 0));
    expect(city.volumes[city.volumes.length - 1]).toBe(0);
    settings.setAudioVolume("ambience", 1);

    eventBus.emit(new SetAmbienceEvent("factory", 0.1));

    // It is stopped and silent; it must not be carrying factory's level.
    expect(city.volumes[city.volumes.length - 1]).toBe(0);
  });

  it("fades a revisited loop in rather than cutting to full", () => {
    // The consequence of the stamp above: on the way back, setAmbience reads
    // the stale value as its starting volume, and a start that equals the
    // target skips the fade entirely.
    eventBus.emit(new SetAmbienceEvent("city", 0.1));
    settings.setAudioVolume("ambience", 0);
    eventBus.emit(new SetAmbienceEvent("city", 0));
    settings.setAudioVolume("ambience", 1);
    eventBus.emit(new SetAmbienceEvent("factory", 0.1));
    const city = find("city.mp3");
    city.fade.mockClear();

    eventBus.emit(new SetAmbienceEvent("city", 0.1));

    expect(city.fade).toHaveBeenCalledTimes(1);
    expect(city.fade.mock.calls[0][0]).toBe(0);
  });

  it("follows the ambience slider while a loop is running", () => {
    eventBus.emit(new SetAmbienceEvent("city", 0.1));
    settings.setAudioVolume("ambience", 0.5);
    // slider 0.5 squared, times the 0.1 envelope.
    expect(
      find("city.mp3").volumes[find("city.mp3").volumes.length - 1],
    ).toBeCloseTo(0.25 * 0.1);
  });
});

describe("teardown", () => {
  it("stops and unloads everything it owns", () => {
    eventBus.emit(new SetAmbienceEvent("city", 0.1));
    const music = currentMusic();
    const city = find("city.mp3");

    soundManager.dispose();

    expect(music.stop).toHaveBeenCalled();
    expect(music.unload).toHaveBeenCalled();
    expect(city.stop).toHaveBeenCalled();
    expect(city.unload).toHaveBeenCalled();
  });

  it("stops following the bus", () => {
    const play = vi.spyOn(mixer, "play");
    soundManager.dispose();
    eventBus.emit(new PlaySoundEffectEvent("build-city"));
    expect(play).not.toHaveBeenCalled();
  });
});
