import { describe, expect, it, vi } from "vitest";
import {
  ISoundManager,
  SoundEffect,
} from "../../../src/client/sound/ISoundManager";

describe("SoundManager DI contract", () => {
  function createMockSoundManager() {
    return {
      playBackgroundMusic: vi.fn<() => void>(),
      stopBackgroundMusic: vi.fn<() => void>(),
      setBackgroundMusicVolume: vi.fn<(volume: number) => void>(),
      setSoundEffectsVolume: vi.fn<(volume: number) => void>(),
      playSoundEffect: vi.fn<(name: SoundEffect) => void>(),
      stopSoundEffect: vi.fn<(name: SoundEffect) => void>(),
    } satisfies ISoundManager;
  }

  it("mock ISoundManager tracks playSoundEffect calls", () => {
    const mock = createMockSoundManager();
    mock.playSoundEffect(SoundEffect.AtomHit);
    mock.playSoundEffect(SoundEffect.KaChing);
    mock.playSoundEffect(SoundEffect.Click);

    expect(mock.playSoundEffect).toHaveBeenCalledTimes(3);
    expect(mock.playSoundEffect).toHaveBeenCalledWith(SoundEffect.AtomHit);
    expect(mock.playSoundEffect).toHaveBeenCalledWith(SoundEffect.KaChing);
    expect(mock.playSoundEffect).toHaveBeenCalledWith(SoundEffect.Click);
  });

  it("mock ISoundManager tracks volume changes", () => {
    const mock = createMockSoundManager();
    mock.setBackgroundMusicVolume(0.5);
    mock.setSoundEffectsVolume(0.8);

    expect(mock.setBackgroundMusicVolume).toHaveBeenCalledWith(0.5);
    expect(mock.setSoundEffectsVolume).toHaveBeenCalledWith(0.8);
  });

  it("mock ISoundManager tracks background music lifecycle", () => {
    const mock = createMockSoundManager();
    mock.playBackgroundMusic();
    mock.stopBackgroundMusic();

    expect(mock.playBackgroundMusic).toHaveBeenCalledTimes(1);
    expect(mock.stopBackgroundMusic).toHaveBeenCalledTimes(1);
  });

  it("SoundEffect enum is independent of SoundManager implementation", () => {
    // SoundEffect can be used without importing SoundManager at all
    const effects: SoundEffect[] = [
      SoundEffect.KaChing,
      SoundEffect.AtomHit,
      SoundEffect.Click,
    ];
    expect(effects).toHaveLength(3);
    expect(effects[0]).toBe("ka-ching");
  });

  it("ISoundManager interface has exactly the required methods", () => {
    const mock = createMockSoundManager();
    const methods = Object.keys(mock);
    expect(methods).toContain("playBackgroundMusic");
    expect(methods).toContain("stopBackgroundMusic");
    expect(methods).toContain("setBackgroundMusicVolume");
    expect(methods).toContain("setSoundEffectsVolume");
    expect(methods).toContain("playSoundEffect");
    expect(methods).toContain("stopSoundEffect");
    expect(methods).toHaveLength(6);
  });
});

describe("No singleton exports", () => {
  it("SoundManager module does not export a default singleton", async () => {
    // Mock dependencies before importing
    vi.mock("howler", () => {
      class MockHowl {
        play = vi.fn();
        stop = vi.fn();
        volume = vi.fn();
        playing = vi.fn().mockReturnValue(false);
        unload = vi.fn();
        constructor(_opts: any) {}
      }
      return { Howl: MockHowl };
    });
    vi.mock("../../../../proprietary/sounds/music/of4.mp3", () => ({
      default: "of4.mp3",
    }));
    vi.mock("../../../../proprietary/sounds/music/openfront.mp3", () => ({
      default: "openfront.mp3",
    }));
    vi.mock("../../../../proprietary/sounds/music/war.mp3", () => ({
      default: "war.mp3",
    }));
    vi.mock("../../../src/core/AssetUrls", () => ({
      assetUrl: (path: string) => path,
    }));

    const module = await import("../../../src/client/sound/SoundManager");

    // Should export SoundManager as a named class export, not a default instance
    expect(module.SoundManager).toBeDefined();
    expect(typeof module.SoundManager).toBe("function"); // It's a class (constructor)

    // Should NOT have a default export that is an instance
    const defaultExport = (module as any).default;
    if (defaultExport !== undefined) {
      // If there is a default export, it should not be a SoundManager instance
      expect(defaultExport).not.toBeInstanceOf(module.SoundManager);
    }
  });
});
