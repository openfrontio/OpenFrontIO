import { beforeEach, describe, expect, it } from "vitest";
import {
  AudioCategory,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../src/core/game/UserSettings";

// UserSettings keeps a static in-memory cache and the active player id; reset
// both so each test reads fresh from the (cleared) localStorage as logged out.
function resetUserSettingsState() {
  localStorage.clear();
  const statics = UserSettings as unknown as {
    cache: Map<string, string | null>;
    playerId: string | null;
  };
  statics.cache.clear();
  statics.playerId = null;
}

const INHERITS_EFFECTS: AudioCategory[] = [
  "effects",
  "alerts",
  "ambience",
  "interface",
];

describe("audio channel volumes", () => {
  beforeEach(resetUserSettingsState);

  it("returns the per-channel defaults when nothing is stored", () => {
    const s = new UserSettings();
    expect(s.audioVolume("master")).toBeCloseTo(1.0);
    expect(s.audioVolume("music")).toBeCloseTo(0.5);
    expect(s.audioVolume("effects")).toBeCloseTo(0.7);
    expect(s.audioVolume("alerts")).toBeCloseTo(0.8);
    expect(s.audioVolume("ambience")).toBeCloseTo(0.4);
    expect(s.audioVolume("interface")).toBeCloseTo(0.5);
  });

  it("inherits the legacy effects volume across every channel that split out of it", () => {
    localStorage.setItem("settings.soundEffectsVolume", "0.65");
    const s = new UserSettings();
    for (const category of INHERITS_EFFECTS) {
      expect(s.audioVolume(category)).toBeCloseTo(0.65);
    }
  });

  it("inherits the legacy music volume", () => {
    localStorage.setItem("settings.backgroundMusicVolume", "0.2");
    expect(new UserSettings().audioVolume("music")).toBeCloseTo(0.2);
  });

  it("respects a stored zero rather than treating it as unset", () => {
    // The only writer is a slider drag, so 0 is a deliberate mute. Un-muting
    // someone who muted is the worse error.
    localStorage.setItem("settings.soundEffectsVolume", "0");
    const s = new UserSettings();
    for (const category of INHERITS_EFFECTS) {
      expect(s.audioVolume(category)).toBe(0);
    }
  });

  it("prefers a channel's own key over the legacy value", () => {
    localStorage.setItem("settings.soundEffectsVolume", "0.65");
    localStorage.setItem("settings.audio.alerts", "0.9");
    const s = new UserSettings();
    expect(s.audioVolume("alerts")).toBeCloseTo(0.9);
    expect(s.audioVolume("effects")).toBeCloseTo(0.65);
  });

  it("has no legacy fallback for master", () => {
    localStorage.setItem("settings.soundEffectsVolume", "0.1");
    localStorage.setItem("settings.backgroundMusicVolume", "0.1");
    expect(new UserSettings().audioVolume("master")).toBeCloseTo(1.0);
  });

  it("writes the channel key and clamps to 0-1", () => {
    const s = new UserSettings();
    s.setAudioVolume("ambience", 0.33);
    expect(localStorage.getItem("settings.audio.ambience")).toBe("0.33");
    s.setAudioVolume("ambience", 5);
    expect(s.audioVolume("ambience")).toBe(1);
    s.setAudioVolume("ambience", -2);
    expect(s.audioVolume("ambience")).toBe(0);
  });

  it("announces a channel change so the mixer can follow it without a bus", () => {
    // detail is the serialised value: setCached stores strings and hands the
    // same string to emitChange, so a listener has to parse it.
    const seen: string[] = [];
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:settings.audio.music`,
      (e) => seen.push((e as CustomEvent<string>).detail),
    );
    new UserSettings().setAudioVolume("music", 0.42);
    expect(seen).toEqual(["0.42"]);
  });
});

describe("audio focus settings", () => {
  beforeEach(resetUserSettingsState);

  it("defaults both focus options on", () => {
    const s = new UserSettings();
    expect(s.muteOnBlur()).toBe(true);
    expect(s.alertsWhenUnfocused()).toBe(true);
  });

  it("round-trips both", () => {
    const s = new UserSettings();
    s.setMuteOnBlur(false);
    s.setAlertsWhenUnfocused(false);
    expect(s.muteOnBlur()).toBe(false);
    expect(s.alertsWhenUnfocused()).toBe(false);
  });
});

describe("legacy volume accessors", () => {
  beforeEach(resetUserSettingsState);

  it("read through to their channels, so old callers see the new defaults", () => {
    const s = new UserSettings();
    expect(s.backgroundMusicVolume()).toBeCloseTo(0.5);
    expect(s.soundEffectsVolume()).toBeCloseTo(0.7);
  });

  it("write to the channel key, so old and new sliders agree", () => {
    const s = new UserSettings();
    s.setBackgroundMusicVolume(0.4);
    s.setSoundEffectsVolume(0.65);
    expect(s.audioVolume("music")).toBeCloseTo(0.4);
    expect(s.audioVolume("effects")).toBeCloseTo(0.65);
    expect(localStorage.getItem("settings.audio.music")).toBe("0.4");
  });
});
