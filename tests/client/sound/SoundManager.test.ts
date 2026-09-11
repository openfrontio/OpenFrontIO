import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const howlInstances: any[] = [];
let nextPlayId = 1;
const { howlerVolume } = vi.hoisted(() => ({ howlerVolume: vi.fn() }));

vi.mock("howler", () => {
  class MockHowl {
    src: string;
    loop: boolean;
    html5: boolean;
    volumes: number[] = [];
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
    off = vi.fn();
    _listeners = new Map<string, Map<number, () => void>>();
    _fire(event: string, id: number) {
      const cb = this._listeners.get(event)?.get(id);
      if (cb) {
        this._listeners.get(event)!.delete(id);
        cb();
      }
    }
    constructor(opts: any) {
      this.src = opts.src[0];
      this.loop = opts.loop ?? false;
      this.html5 = opts.html5 ?? false;
      howlInstances.push(this);
    }
  }
  return { Howl: MockHowl, Howler: { volume: howlerVolume } };
});

import {
  AudioMixer,
  resetAudioMixerForTest,
} from "../../../src/client/sound/AudioMixer";
import { SoundManager } from "../../../src/client/sound/SoundManager";
import {
  PlaySoundEffectEvent,
  SetAmbienceEvent,
} from "../../../src/client/sound/Sounds";
import { EventBus } from "../../../src/core/EventBus";
import { UserSettings } from "../../../src/core/game/UserSettings";

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
  it("is a single looping track, not a playlist", () => {
    const music = find("gameplay.mp3");
    expect(music).toBeDefined();
    expect(music.loop).toBe(true);
    expect(howlInstances.filter((h) => h.src.includes("music/")).length).toBe(
      1,
    );
  });

  it("streams instead of waiting for the whole file to decode", () => {
    // Howler's default Web Audio path downloads and decodes the entire track
    // before the first note. gameplay.mp3 is 4.6 MB, which was tens of seconds
    // of silence at game start. Ambience and cues stay on Web Audio, so this
    // has to stay specific to the music track.
    expect(find("gameplay.mp3").html5).toBe(true);
  });

  it("follows the music slider through the mixer", () => {
    settings.setAudioVolume("music", 0.5);
    // 0.5 squared for the audio taper, then the -1 dB music trim.
    expect(
      find("gameplay.mp3").volumes[find("gameplay.mp3").volumes.length - 1],
    ).toBeCloseTo(0.25 * 0.89);
  });

  it("only starts once", () => {
    soundManager.playBackgroundMusic();
    const music = find("gameplay.mp3");
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
    const music = find("gameplay.mp3");
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
