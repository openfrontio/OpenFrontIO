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
  musicLevel = 0.89;
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
  vi.restoreAllMocks();
  for (const [type, fn] of registered) document.removeEventListener(type, fn);
});

const themes = () => howlInstances.filter((h) => h.src.includes("menu-theme"));

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
    startMenuMusic(mixer);
    document.dispatchEvent(new Event("pointerdown"));

    const theme = themes()[0];
    // Registering writes the channel volume straight onto the Howl, which is
    // what made the theme snap in at full level. It has to wait for the ramp.
    expect(mixer.register).not.toHaveBeenCalled();
    expect(theme.fade).toHaveBeenCalledTimes(1);
    const [from, to, ms] = theme.fade.mock.calls[0];
    expect(from).toBe(0);
    expect(to).toBeCloseTo(0.89);
    expect(ms).toBeGreaterThanOrEqual(1000);

    // Howler fires "fade" when the ramp lands; the mixer takes it on there.
    theme.once.mock.calls.find((c: any[]) => c[0] === "fade")[1]();
    expect(mixer.register).toHaveBeenCalledWith(theme, "music");
    expect(unsubscribed).toBe(1);
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
    startMenuMusic(mixer);
    document.dispatchEvent(new Event("pointerdown"));
    document.dispatchEvent(new Event("game-starting"));
    document.dispatchEvent(new Event("menu-restored"));
    document.dispatchEvent(new Event("pointerdown"));

    const second = themes()[1];
    expect(second.fade).toHaveBeenCalledTimes(1);
    expect(second.fade.mock.calls[0][0]).toBe(0);
  });

  it("drops the fade-in settle when a game starts mid-ramp", () => {
    startMenuMusic(mixer);
    document.dispatchEvent(new Event("pointerdown"));
    const theme = themes()[0];

    document.dispatchEvent(new Event("game-starting"));

    // The pending settle would otherwise fire off the fade-OUT and hand a
    // departing theme back to the mixer, which would then keep writing volume
    // to an unloaded Howl forever.
    expect(theme.off).toHaveBeenCalledWith("fade");
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
