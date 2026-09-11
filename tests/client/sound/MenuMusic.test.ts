import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const howlInstances: any[] = [];

vi.mock("howler", () => {
  class MockHowl {
    src: string;
    loop: boolean;
    html5: boolean;
    play = vi.fn();
    stop = vi.fn();
    unload = vi.fn();
    fade = vi.fn();
    once = vi.fn();
    off = vi.fn();
    volume = vi.fn(() => 0);
    constructor(opts: any) {
      this.src = opts.src[0];
      this.loop = opts.loop ?? false;
      this.html5 = opts.html5 ?? false;
      howlInstances.push(this);
    }
  }
  return { Howl: MockHowl, Howler: { volume: vi.fn() } };
});

import { startMenuMusic } from "../../../src/client/sound/MenuMusic";

// Rebuilt per test: these carry implementations, which clearAllMocks keeps but
// restoreAllMocks would not.
let mixer: any;
let musicLevel: number;
let onChangeCallbacks: Array<(category: string) => void>;
let unsubscribed: number;

const buildMixer = () => {
  // Real defaults: slider 0.5, squared by perceptualGain, times the -1 dB
  // music trim.
  musicLevel = 0.5 * 0.5 * 0.89;
  onChangeCallbacks = [];
  unsubscribed = 0;
  mixer = {
    register: vi.fn(),
    unregister: vi.fn(),
    volumeFor: vi.fn(() => musicLevel),
    onChange: vi.fn((cb: (category: string) => void) => {
      onChangeCallbacks.push(cb);
      return () => unsubscribed++;
    }),
  };
};

// startMenuMusic listens on the document and has no disposer, so without this
// every test would still be running the previous tests' copies and the Howl
// counts below would be measuring the wrong thing.
const registered: Array<[string, EventListener]> = [];
const realAdd = document.addEventListener.bind(document);

beforeEach(() => {
  howlInstances.length = 0;
  registered.length = 0;
  vi.clearAllMocks();
  buildMixer();
  vi.spyOn(document, "addEventListener").mockImplementation(
    (type: any, fn: any, opts?: any) => {
      registered.push([type, fn]);
      realAdd(type, fn, opts);
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const [type, fn] of registered) document.removeEventListener(type, fn);
});

const themes = () => howlInstances.filter((h) => h.src.includes("menu-theme"));

/** Most recent volume the ramp wrote at this Howl. */
const volumeWrites = (howl: any): number[] =>
  howl.volume.mock.calls
    .filter((c: unknown[]) => c.length > 0)
    .map((c: unknown[]) => c[0] as number);

/** Most recent volume the ramp wrote at this Howl. */
const lastVolume = (howl: any) => {
  const writes = volumeWrites(howl);
  return writes[writes.length - 1];
};

describe("menu music", () => {
  it("streams the theme rather than decoding it up front", () => {
    startMenuMusic(mixer);
    // Browsers block audio until a gesture, so the Howl is only built here.
    document.dispatchEvent(new Event("pointerdown"));

    const theme = themes()[0];
    expect(theme).toBeDefined();
    expect(theme.loop).toBe(true);
    // 2.2 MB decoded up front is a wait landing exactly when the player has
    // just clicked something, so this one streams like the gameplay track.
    expect(theme.html5).toBe(true);
    expect(theme.play).toHaveBeenCalled();
  });

  it("ramps up from silence instead of arriving at full level", () => {
    vi.useFakeTimers();
    startMenuMusic(mixer);
    document.dispatchEvent(new Event("pointerdown"));

    const theme = themes()[0];
    // Registering writes the channel volume straight onto the Howl, which is
    // what made the theme snap in at full level. It has to wait for the ramp.
    expect(mixer.register).not.toHaveBeenCalled();
    expect(lastVolume(theme)).toBeLessThan(musicLevel * 0.01);

    vi.advanceTimersByTime(2100);

    expect(mixer.register).toHaveBeenCalledWith(theme, "music");
    expect(unsubscribed).toBe(1);
  });

  it("spreads the ramp evenly in dB, not in amplitude", () => {
    // The mechanism was never the problem; the curve was. Howler's fade() is
    // linear in amplitude, so at the halfway mark it is already 6 dB below
    // target -- perceptually arrived, with a second of inaudible creep left.
    // An even dB ramp is around 24 dB down at the same point.
    vi.useFakeTimers();
    startMenuMusic(mixer);
    document.dispatchEvent(new Event("pointerdown"));
    const theme = themes()[0];
    // Not Howler's fade at all any more: it quantises to 0.01, which at this
    // target makes the very first step a 6 dB jump.
    expect(theme.fade).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    const halfway = 20 * Math.log10(lastVolume(theme) / musicLevel);

    expect(halfway).toBeLessThan(-18);
    expect(halfway).toBeGreaterThan(-30);
  });

  it("keeps climbing through the second half, where linear gives up", () => {
    vi.useFakeTimers();
    startMenuMusic(mixer);
    document.dispatchEvent(new Event("pointerdown"));
    const theme = themes()[0];

    vi.advanceTimersByTime(1000);
    const half = lastVolume(theme);
    vi.advanceTimersByTime(500);
    const threeQuarters = lastVolume(theme);

    // Same dB gain per unit time throughout: the step from half to three
    // quarters is a real, audible climb rather than a fraction of a dB.
    const climb = 20 * Math.log10(threeQuarters / half);
    expect(climb).toBeGreaterThan(6);
  });

  it("does not attempt a hanging fade when the channel is silent", () => {
    buildMixer();
    musicLevel = 0;
    startMenuMusic(mixer);
    document.dispatchEvent(new Event("pointerdown"));

    const theme = themes()[0];
    // fade(0, 0) never completes in Howler, so a settle scheduled on "fade"
    // would never run and the theme would stay unregistered for the session.
    expect(theme.fade).not.toHaveBeenCalled();
    expect(mixer.register).toHaveBeenCalledWith(theme, "music");
  });

  it("hands over at once when the player moves the music slider mid-ramp", () => {
    startMenuMusic(mixer);
    document.dispatchEvent(new Event("pointerdown"));
    const theme = themes()[0];
    expect(mixer.register).not.toHaveBeenCalled();

    // Muting during the ramp must be audible now, not in two seconds.
    musicLevel = 0;
    onChangeCallbacks.forEach((cb) => cb("music"));

    expect(mixer.register).toHaveBeenCalledWith(theme, "music");
    expect(unsubscribed).toBe(1);
  });

  it("ramps again on the start after a menu restore", () => {
    vi.useFakeTimers();
    startMenuMusic(mixer);
    document.dispatchEvent(new Event("pointerdown"));
    document.dispatchEvent(new Event("game-starting"));
    document.dispatchEvent(new Event("menu-restored"));
    document.dispatchEvent(new Event("pointerdown"));

    // Coming back to the home page is the same moment on a page that is
    // already open, so it ramps rather than slamming in.
    const second = themes()[1];
    expect(lastVolume(second)).toBeLessThan(musicLevel * 0.01);
    vi.advanceTimersByTime(1000);
    const halfway = 20 * Math.log10(lastVolume(second) / musicLevel);
    expect(halfway).toBeLessThan(-18);
    expect(halfway).toBeGreaterThan(-30);
  });

  it("stops the ramp when a game starts mid-ramp", () => {
    vi.useFakeTimers();
    startMenuMusic(mixer);
    document.dispatchEvent(new Event("pointerdown"));
    const theme = themes()[0];
    vi.advanceTimersByTime(200);
    const writes = volumeWrites(theme).length;

    document.dispatchEvent(new Event("game-starting"));
    vi.advanceTimersByTime(3000);

    // Left running, the ramp would write over the fade-out and then hand a
    // departing theme back to the mixer, which would go on writing volume to
    // an unloaded Howl for the session.
    expect(volumeWrites(theme).length).toBe(writes);
    expect(mixer.register).not.toHaveBeenCalled();
    expect(mixer.unregister).toHaveBeenCalledWith(theme);
    expect(unsubscribed).toBe(1);
  });

  it("starts once however many gestures arrive", () => {
    startMenuMusic(mixer);
    document.dispatchEvent(new Event("pointerdown"));
    document.dispatchEvent(new Event("keydown"));
    document.dispatchEvent(new Event("pointerdown"));

    expect(themes().length).toBe(1);
  });

  it("can start again after a lobby is left before the game begins", () => {
    // "game-starting" fires at lobby PRESTART, and leaving in the window
    // before the game actually starts puts the home page back in place rather
    // than reloading it (Main.handleLeaveLobby, OPE-255). Tearing the gesture
    // listeners down for good left that live home page silent for the rest of
    // the session, with no gesture able to bring it back.
    startMenuMusic(mixer);
    document.dispatchEvent(new Event("pointerdown"));
    expect(themes().length).toBe(1);

    document.dispatchEvent(new Event("game-starting"));
    document.dispatchEvent(new Event("menu-restored"));
    document.dispatchEvent(new Event("pointerdown"));

    expect(themes().length).toBe(2);
    expect(themes()[1].play).toHaveBeenCalled();
  });

  it("stays silent through a game that actually started", () => {
    // The other side of the same coin: no "menu-restored" means the player is
    // in a game, and a stray gesture must not start the theme over the top of
    // it. keydown matters specifically -- `once` only removes the listener
    // that fired, so after a pointerdown the keydown one is still live.
    startMenuMusic(mixer);
    document.dispatchEvent(new Event("pointerdown"));

    document.dispatchEvent(new Event("game-starting"));
    document.dispatchEvent(new Event("pointerdown"));
    document.dispatchEvent(new Event("keydown"));

    expect(themes().length).toBe(1);
  });

  it("does not stack a second theme when the menu is restored twice", () => {
    startMenuMusic(mixer);
    document.dispatchEvent(new Event("pointerdown"));
    document.dispatchEvent(new Event("game-starting"));

    document.dispatchEvent(new Event("menu-restored"));
    document.dispatchEvent(new Event("menu-restored"));
    document.dispatchEvent(new Event("pointerdown"));

    // One gesture, one theme -- not one per re-arm.
    expect(themes().length).toBe(2);
  });
});
