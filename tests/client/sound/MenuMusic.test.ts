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

const mixer = {
  register: vi.fn(),
  unregister: vi.fn(),
} as any;

// startMenuMusic listens on the document and has no disposer, so without this
// every test would still be running the previous tests' copies and the Howl
// counts below would be measuring the wrong thing.
const registered: Array<[string, EventListener]> = [];
const realAdd = document.addEventListener.bind(document);

beforeEach(() => {
  howlInstances.length = 0;
  registered.length = 0;
  vi.clearAllMocks();
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
    expect(mixer.register).toHaveBeenCalledWith(theme, "music");
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
