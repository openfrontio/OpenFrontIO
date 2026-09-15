import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

/** The shell sets this global; isDesktopShell() keys off it. */
function pretendDesktopShell() {
  (
    globalThis as unknown as { window: Record<string, unknown> }
  ).window.openfrontDesktop = {};
}

function pretendWeb() {
  delete (globalThis as unknown as { window: Record<string, unknown> }).window
    .openfrontDesktop;
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
    // Master is the one platform-dependent default; see the master describe
    // block below. Everything else is the same everywhere.
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
    expect(new UserSettings().audioVolume("master")).toBeCloseTo(0.9);
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

  it("defaults mute-on-blur off, and keep-alerts on for when it is turned on", () => {
    const s = new UserSettings();
    expect(s.muteOnBlur()).toBe(false);
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

  it("move every channel the single old effects slider covered", () => {
    // Until the Audio tab ships there is one slider for all four; writing
    // only effects would leave clicks, alerts and ambience uncontrollable.
    const s = new UserSettings();
    s.setSoundEffectsVolume(0.3);
    for (const category of INHERITS_EFFECTS) {
      expect(s.audioVolume(category)).toBeCloseTo(0.3);
    }
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

describe("master volume default", () => {
  beforeEach(() => {
    resetUserSettingsState();
    pretendWeb();
  });

  afterEach(pretendWeb);

  it("starts web silent when the player has never chosen any audio value", () => {
    // Parity with main, where both old sliders defaulted to 0, and ordinary
    // autoplay etiquette: nothing should start making noise by itself.
    const s = new UserSettings();
    expect(s.audioVolume("master")).toBe(0);
    // The channels themselves are untouched — only master differs.
    expect(s.audioVolume("music")).toBeCloseTo(0.5);
    expect(s.audioVolume("effects")).toBeCloseTo(0.7);
    expect(s.audioVolume("alerts")).toBeCloseTo(0.8);
    expect(s.audioVolume("ambience")).toBeCloseTo(0.4);
    expect(s.audioVolume("interface")).toBeCloseTo(0.5);
  });

  it("starts the desktop shell audible, at the default master level", () => {
    pretendDesktopShell();
    expect(new UserSettings().audioVolume("master")).toBeCloseTo(0.9);
  });

  it("keeps a returning web player audible when only a legacy key is stored", () => {
    // Master has no legacy key, so without this carve-out a player who had
    // deliberately set the old sliders would upgrade into silence.
    localStorage.setItem("settings.backgroundMusicVolume", "0.5");
    const s = new UserSettings();
    expect(s.audioVolume("master")).toBeCloseTo(0.9);
    expect(s.audioVolume("music")).toBeCloseTo(0.5);
  });

  it("counts a stored channel key as having chosen, even at zero", () => {
    localStorage.setItem("settings.audio.effects", "0");
    const s = new UserSettings();
    expect(s.audioVolume("master")).toBeCloseTo(0.9);
    expect(s.audioVolume("effects")).toBe(0);
  });

  it("announces master when the first write flips the carve-out", () => {
    // Otherwise the mixer stays at master 0 — a silent game — while the tab
    // shows master at its default.
    const seen: unknown[] = [];
    const type = `${USER_SETTINGS_CHANGED_EVENT}:settings.audio.master`;
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    globalThis.addEventListener(type, listener);

    const s = new UserSettings();
    expect(s.audioVolume("master")).toBe(0);
    s.setAudioVolume("effects", 0.7);

    globalThis.removeEventListener(type, listener);
    expect(s.audioVolume("master")).toBeCloseTo(0.9);
    expect(seen).toEqual(["0.9"]);
  });

  it("announces the flip through the legacy setters too", () => {
    const seen: unknown[] = [];
    const type = `${USER_SETTINGS_CHANGED_EVENT}:settings.audio.master`;
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    globalThis.addEventListener(type, listener);

    new UserSettings().setBackgroundMusicVolume(0.5);

    globalThis.removeEventListener(type, listener);
    expect(seen).toEqual(["0.9"]);
  });

  it("announces the flip only once, not on every later write", () => {
    const seen: unknown[] = [];
    const type = `${USER_SETTINGS_CHANGED_EVENT}:settings.audio.master`;
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    globalThis.addEventListener(type, listener);

    const s = new UserSettings();
    s.setAudioVolume("effects", 0.7);
    s.setAudioVolume("music", 0.3);
    s.setAudioVolume("alerts", 0.2);

    globalThis.removeEventListener(type, listener);
    expect(seen).toEqual(["0.9"]);
  });

  it("does not announce a flip when master is stored", () => {
    const s = new UserSettings();
    s.setAudioVolume("master", 0.3);
    const seen: unknown[] = [];
    const type = `${USER_SETTINGS_CHANGED_EVENT}:settings.audio.master`;
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    globalThis.addEventListener(type, listener);

    s.setAudioVolume("effects", 0.7);

    globalThis.removeEventListener(type, listener);
    expect(seen).toEqual([]);
    expect(s.audioVolume("master")).toBeCloseTo(0.3);
  });

  it("trips the carve-out on a legacy effects value alone", () => {
    localStorage.setItem("settings.soundEffectsVolume", "0.65");
    expect(new UserSettings().audioVolume("master")).toBeCloseTo(0.9);
  });

  it("does not trip the carve-out on the blur toggles alone", () => {
    // Those are not a volume choice, so they must not unmute a web player.
    const s = new UserSettings();
    s.setMuteOnBlur(true);
    s.setAlertsWhenUnfocused(false);
    expect(new UserSettings().audioVolume("master")).toBe(0);
  });

  it("lets a stored master value win on either platform", () => {
    localStorage.setItem("settings.audio.master", "0.3");
    expect(new UserSettings().audioVolume("master")).toBeCloseTo(0.3);

    pretendDesktopShell();
    resetUserSettingsState();
    pretendDesktopShell();
    localStorage.setItem("settings.audio.master", "0.3");
    expect(new UserSettings().audioVolume("master")).toBeCloseTo(0.3);
  });
});

describe("resetAudio", () => {
  beforeEach(() => {
    resetUserSettingsState();
    pretendWeb();
  });

  afterEach(pretendWeb);

  it("clears every audio key, including the legacy pair", () => {
    const s = new UserSettings();
    s.setAudioVolume("master", 0.2);
    s.setAudioVolume("music", 0.3);
    s.setAudioVolume("effects", 0.4);
    s.setMuteOnBlur(true);
    s.setAlertsWhenUnfocused(false);
    localStorage.setItem("settings.backgroundMusicVolume", "0.9");
    localStorage.setItem("settings.soundEffectsVolume", "0.9");

    s.resetAudio();

    for (const key of [
      "settings.audio.master",
      "settings.audio.music",
      "settings.audio.effects",
      "settings.audio.alerts",
      "settings.audio.ambience",
      "settings.audio.interface",
      "settings.audio.muteOnBlur",
      "settings.audio.alertsWhenUnfocused",
      "settings.backgroundMusicVolume",
      "settings.soundEffectsVolume",
    ]) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it("returns a web player to the fresh-install state", () => {
    const s = new UserSettings();
    s.setAudioVolume("master", 0.2);
    s.setAudioVolume("effects", 0.1);
    s.setMuteOnBlur(true);
    s.setAlertsWhenUnfocused(false);

    s.resetAudio();

    const after = new UserSettings();
    // Silent on web, because nothing is stored any more — not even the
    // legacy keys that would otherwise trip the master carve-out.
    expect(after.audioVolume("master")).toBe(0);
    expect(after.audioVolume("music")).toBeCloseTo(0.5);
    expect(after.audioVolume("effects")).toBeCloseTo(0.7);
    expect(after.audioVolume("alerts")).toBeCloseTo(0.8);
    expect(after.audioVolume("ambience")).toBeCloseTo(0.4);
    expect(after.audioVolume("interface")).toBeCloseTo(0.5);
    expect(after.muteOnBlur()).toBe(false);
    expect(after.alertsWhenUnfocused()).toBe(true);
  });

  it("returns a desktop player to an audible master", () => {
    pretendDesktopShell();
    const s = new UserSettings();
    s.setAudioVolume("master", 0.2);
    s.resetAudio();
    expect(new UserSettings().audioVolume("master")).toBeCloseTo(0.9);
  });

  it("is safe to call twice, and on empty storage", () => {
    const s = new UserSettings();
    expect(() => s.resetAudio()).not.toThrow();
    s.setAudioVolume("music", 0.9);
    expect(() => {
      s.resetAudio();
      s.resetAudio();
    }).not.toThrow();
    expect(new UserSettings().audioVolume("music")).toBeCloseTo(0.5);
  });

  it("announces resolved values for a channel and for the blur toggles", () => {
    const seen: Record<string, unknown[]> = {
      effects: [],
      muteOnBlur: [],
      alertsWhenUnfocused: [],
    };
    const types = Object.keys(seen).map((k) => [
      k,
      `${USER_SETTINGS_CHANGED_EVENT}:settings.audio.${k}`,
    ]);
    const listeners = types.map(([k, type]) => {
      const l = (e: Event) => seen[k].push((e as CustomEvent).detail);
      globalThis.addEventListener(type, l);
      return [type, l] as const;
    });

    const s = new UserSettings();
    s.setAudioVolume("effects", 0.1);
    s.setMuteOnBlur(true);
    s.setAlertsWhenUnfocused(false);
    for (const key of Object.keys(seen)) seen[key].length = 0;
    s.resetAudio();

    for (const [type, l] of listeners) {
      globalThis.removeEventListener(type, l);
    }
    expect(seen.effects).toEqual(["0.7"]);
    expect(seen.muteOnBlur).toEqual(["false"]);
    expect(seen.alertsWhenUnfocused).toEqual(["true"]);
  });

  it("announces the value each channel now resolves to, not null", () => {
    // The mixer parses detail as a number and ignores NaN, so a null payload
    // would leave it playing at the old volumes.
    const seen: unknown[] = [];
    const type = `${USER_SETTINGS_CHANGED_EVENT}:settings.audio.master`;
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    globalThis.addEventListener(type, listener);

    const s = new UserSettings();
    s.setAudioVolume("master", 0.2);
    seen.length = 0;
    s.resetAudio();

    globalThis.removeEventListener(type, listener);
    expect(seen).toEqual(["0"]);
    expect(seen.every((d) => !isNaN(parseFloat(String(d))))).toBe(true);
  });
});

describe("one-time audio reset", () => {
  beforeEach(() => {
    resetUserSettingsState();
    pretendWeb();
  });

  afterEach(pretendWeb);

  it("clears the state that had a web player hearing cues they never chose", () => {
    // The reported case: the old build's music slider was dragged once and
    // effects was left alone, so the master carve-out reads "has chosen" and
    // the four channels that slider never covered fall through to the new
    // defaults. Audible, at full level, opted into by nobody.
    localStorage.setItem("settings.backgroundMusicVolume", "0.4");
    const before = new UserSettings();
    expect(before.audioVolume("master")).toBeCloseTo(0.9);
    expect(before.audioVolume("effects")).toBeCloseTo(0.7);

    expect(new UserSettings().resetAudioOnce()).toBe(true);

    const after = new UserSettings();
    expect(after.audioVolume("master")).toBe(0);
    expect(localStorage.getItem("settings.backgroundMusicVolume")).toBeNull();
  });

  it("runs once and then leaves the player's own choices alone", () => {
    const s = new UserSettings();
    expect(s.resetAudioOnce()).toBe(true);

    s.setAudioVolume("master", 0.3);
    s.setAudioVolume("ambience", 0.9);
    s.setMuteOnBlur(true);

    expect(new UserSettings().resetAudioOnce()).toBe(false);
    const after = new UserSettings();
    expect(after.audioVolume("master")).toBeCloseTo(0.3);
    expect(after.audioVolume("ambience")).toBeCloseTo(0.9);
    expect(after.muteOnBlur()).toBe(true);
  });

  it("spends the version on a fresh install too, so it cannot fire later", () => {
    // Nothing to clear here, but the stamp still has to be written: otherwise
    // the reset would be waiting to go off after the player has set levels.
    expect(new UserSettings().resetAudioOnce()).toBe(true);
    expect(localStorage.getItem("settings.audio.resetVersion")).toBe("1");
    expect(new UserSettings().resetAudioOnce()).toBe(false);
  });

  it("runs on the desktop shell as well, landing on the desktop default", () => {
    pretendDesktopShell();
    localStorage.setItem("settings.audio.master", "1");
    expect(new UserSettings().resetAudioOnce()).toBe(true);
    expect(new UserSettings().audioVolume("master")).toBeCloseTo(0.9);
  });

  it.each([
    ["not-a-number"],
    // parseInt would read this as 1 and skip a reset that has never run.
    ["1-corrupt"],
    ["1.5"],
    ["-1"],
    [""],
    ["Infinity"],
  ])("re-runs when the stamp reads %j, which is not a version", (stamp) => {
    localStorage.setItem("settings.audio.resetVersion", stamp);
    localStorage.setItem("settings.audio.master", "1");
    expect(new UserSettings().resetAudioOnce()).toBe(true);
    expect(localStorage.getItem("settings.audio.resetVersion")).toBe("1");
    expect(localStorage.getItem("settings.audio.master")).toBeNull();
  });

  it("does not re-run when a later version has already stamped it", () => {
    localStorage.setItem("settings.audio.resetVersion", "99");
    localStorage.setItem("settings.audio.master", "1");
    expect(new UserSettings().resetAudioOnce()).toBe(false);
    expect(new UserSettings().audioVolume("master")).toBeCloseTo(1);
  });

  it("survives the tab's own reset button, which must not re-arm it", () => {
    const s = new UserSettings();
    s.resetAudioOnce();
    s.setAudioVolume("master", 0.3);
    s.resetAudio();
    expect(localStorage.getItem("settings.audio.resetVersion")).toBe("1");
    expect(new UserSettings().resetAudioOnce()).toBe(false);
  });

  it("announces the reset values, so a running mixer follows it", () => {
    localStorage.setItem("settings.soundEffectsVolume", "0.9");
    const seen: unknown[] = [];
    const type = `${USER_SETTINGS_CHANGED_EVENT}:settings.audio.master`;
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    globalThis.addEventListener(type, listener);

    new UserSettings().resetAudioOnce();

    globalThis.removeEventListener(type, listener);
    expect(seen).toEqual(["0"]);
  });
});
