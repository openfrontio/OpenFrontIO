import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const howlInstances: any[] = [];
let nextPlayId = 1;
// vi.mock is hoisted above module-level consts, so anything the factory
// closes over has to be hoisted with it.
const { howlerVolume } = vi.hoisted(() => ({ howlerVolume: vi.fn() }));

vi.mock("howler", () => {
  class MockHowl {
    src: string;
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
      if (v === undefined) return this.volumes.at(-1) ?? 0;
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
      howlInstances.push(this);
    }
  }
  return { Howl: MockHowl, Howler: { volume: howlerVolume } };
});

import {
  AudioMixer,
  perceptualGain,
  resetAudioMixerForTest,
} from "../../../src/client/sound/AudioMixer";
import {
  AmbienceTrack,
  ambienceUrls,
  categoryOf,
  SoundEffect,
  soundEffectUrls,
} from "../../../src/client/sound/Sounds";
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

/** Last volume the mixer pushed at the Howl created for this cue. */
function volumeOf(name: string): number | undefined {
  const howl = howlInstances.find((h) => h.src.includes(name));
  return howl?.volumes.at(-1);
}

let mixer: AudioMixer;
let settings: UserSettings;

function build(overrides: Partial<Record<string, number | boolean>> = {}) {
  settings = new UserSettings();
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "boolean") {
      if (key === "muteOnBlur") settings.setMuteOnBlur(value);
      if (key === "alertsWhenUnfocused") settings.setAlertsWhenUnfocused(value);
    } else {
      settings.setAudioVolume(key as any, value);
    }
  }
  mixer = new AudioMixer(settings);
  return mixer;
}

beforeEach(() => {
  howlInstances.length = 0;
  nextPlayId = 1;
  howlerVolume.mockClear();
  resetSettings();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  mixer?.dispose();
  resetAudioMixerForTest();
  vi.restoreAllMocks();
});

describe("cue routing", () => {
  it("assigns every sound effect and ambience track a channel", () => {
    for (const name of soundEffectUrls.keys()) {
      expect(categoryOf(name as SoundEffect)).toBeTruthy();
    }
    for (const name of ambienceUrls.keys()) {
      expect(categoryOf(name as AmbienceTrack)).toBe("ambience");
    }
  });

  it("routes clicks to interface, warnings to alerts, builds to effects", () => {
    expect(categoryOf("click-2")).toBe("interface");
    expect(categoryOf("slider")).toBe("interface");
    expect(categoryOf("nuke-warning")).toBe("alerts");
    expect(categoryOf("message")).toBe("alerts");
    expect(categoryOf("build-city")).toBe("effects");
    expect(categoryOf("victory")).toBe("effects");
  });
});

describe("channel volumes", () => {
  it("squares the slider into an audio taper", () => {
    build({ effects: 0.5 });
    expect(mixer.volumeFor("effects")).toBeCloseTo(perceptualGain(0.5));
  });

  it("drives master through Howler's own gain node", () => {
    build({ master: 0.5 });
    expect(howlerVolume).toHaveBeenCalledWith(perceptualGain(0.5));
  });

  it("trims music and nothing else", () => {
    build({ music: 1, effects: 1, alerts: 1, interface: 1 });
    expect(mixer.volumeFor("music")).toBeCloseTo(0.89);
    for (const channel of ["effects", "alerts", "interface"] as const) {
      expect(mixer.volumeFor(channel)).toBeCloseTo(1);
    }
  });

  it("moves only the channel whose slider moved", () => {
    build({ effects: 1, alerts: 1 });
    mixer.play("build-city");
    mixer.play("nuke-warning");
    const alertsBefore = volumeOf("nuke-warning");

    settings.setAudioVolume("effects", 0.25);

    expect(volumeOf("build-city")).toBeCloseTo(perceptualGain(0.25));
    expect(volumeOf("nuke-warning")).toBe(alertsBefore);
  });

  it("follows a settings change with no event bus attached", () => {
    build({ effects: 1 });
    mixer.play("build-city");
    settings.setAudioVolume("effects", 0.5);
    expect(volumeOf("build-city")).toBeCloseTo(perceptualGain(0.5));
  });

  it("scales ambience by the zoom envelope", () => {
    build({ ambience: 1 });
    mixer.setAmbienceEnvelope(0.1); // the designer's -20 dB ceiling
    expect(mixer.volumeFor("ambience")).toBeCloseTo(0.1);
    mixer.setAmbienceEnvelope(0);
    expect(mixer.volumeFor("ambience")).toBe(0);
  });

  it("reports a channel inaudible when it or master is zero", () => {
    build({ effects: 0, alerts: 1 });
    expect(mixer.isAudible("effects")).toBe(false);
    expect(mixer.isAudible("alerts")).toBe(true);
    settings.setAudioVolume("master", 0);
    expect(mixer.isAudible("alerts")).toBe(false);
  });
});

describe("per-channel budgets", () => {
  it("steals the oldest effect rather than an alert", () => {
    build({ effects: 1, alerts: 1 });
    mixer.play("nuke-warning");
    const alert = howlInstances.find((h) => h.src.includes("nuke-warning"));
    for (let i = 0; i < 7; i++) mixer.play("build-city");

    const build_ = howlInstances.find((h) => h.src.includes("build-city"));
    expect(build_.fade).toHaveBeenCalled(); // oldest effect ducked out
    expect(alert.fade).not.toHaveBeenCalled();
    expect(alert.stop).not.toHaveBeenCalled();
  });

  it("fades an evicted cue instead of cutting it", () => {
    build({ effects: 1 });
    for (let i = 0; i < 7; i++) mixer.play("build-city");
    const howl = howlInstances.find((h) => h.src.includes("build-city"));
    const [from, to, ms] = howl.fade.mock.calls[0];
    expect(from).toBeGreaterThan(0);
    expect(to).toBe(0);
    expect(ms).toBeGreaterThan(0);
  });

  it("drops the newest interface tick rather than stuttering the ratchet", () => {
    build({ interface: 1 });
    for (let i = 0; i < 5; i++) mixer.play("slider");
    const howl = howlInstances.find((h) => h.src.includes("slider"));
    expect(howl.play).toHaveBeenCalledTimes(4);
    expect(howl.fade).not.toHaveBeenCalled();
  });
});

describe("focus duck", () => {
  function blur() {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    globalThis.dispatchEvent(new Event("blur"));
  }

  it("silences flavour but keeps alerts by default", () => {
    build({ effects: 1, alerts: 1, music: 1 });
    blur();
    expect(mixer.volumeFor("effects")).toBe(0);
    expect(mixer.volumeFor("music")).toBe(0);
    expect(mixer.volumeFor("alerts")).toBeCloseTo(1);
  });

  it("silences alerts too when the player turns that off", () => {
    build({ alerts: 1, alertsWhenUnfocused: false });
    blur();
    expect(mixer.volumeFor("alerts")).toBe(0);
  });

  it("changes nothing when mute-on-blur is off", () => {
    build({ effects: 1, muteOnBlur: false });
    blur();
    expect(mixer.volumeFor("effects")).toBeCloseTo(1);
  });

  it("restores on refocus", () => {
    build({ effects: 1 });
    blur();
    expect(mixer.volumeFor("effects")).toBe(0);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    globalThis.dispatchEvent(new Event("focus"));
    expect(mixer.volumeFor("effects")).toBeCloseTo(1);
  });
});

describe("preview cues", () => {
  it("plays the channel's representative cue and resolves when it ends", async () => {
    build({ effects: 1 });
    const pending = mixer.previewCue("effects");
    const howl = howlInstances.find((h) => h.src.includes("build-city"));
    expect(howl.play).toHaveBeenCalled();
    howl._fire("end", 1);
    await expect(pending).resolves.toBeUndefined();
  });

  it("resolves immediately when the channel is muted", async () => {
    build({ effects: 0 });
    await expect(mixer.previewCue("effects")).resolves.toBeUndefined();
    expect(howlInstances.length).toBe(0);
  });
});
