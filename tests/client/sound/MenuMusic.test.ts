import { beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
  howlInstances.length = 0;
  vi.clearAllMocks();
});

describe("menu music", () => {
  it("streams the theme rather than decoding it up front", () => {
    startMenuMusic(mixer);
    // Browsers block audio until a gesture, so the Howl is only built here.
    document.dispatchEvent(new Event("pointerdown"));

    const theme = howlInstances.find((h) => h.src.includes("menu-theme.mp3"));
    expect(theme).toBeDefined();
    expect(theme.loop).toBe(true);
    // 2.2 MB decoded up front is a wait landing exactly when the player has
    // just clicked something, so this one streams like the gameplay track.
    expect(theme.html5).toBe(true);
    expect(theme.play).toHaveBeenCalled();
    expect(mixer.register).toHaveBeenCalledWith(theme, "music");
  });
});
