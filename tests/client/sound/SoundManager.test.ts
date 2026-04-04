import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock howler before importing SoundManager
const howlCtor = vi.fn();
vi.mock("howler", () => {
  let mockPlayId = 1;
  class MockHowl {
    play = vi.fn(() => mockPlayId++);
    stop = vi.fn();
    volume = vi.fn();
    playing = vi.fn().mockReturnValue(false);
    unload = vi.fn();
    once = vi.fn();
    constructor(_opts: any) {
      howlCtor(_opts);
    }
  }
  return { Howl: MockHowl };
});

// Mock music imports
vi.mock("../../../../proprietary/sounds/music/of4.mp3", () => ({
  default: "of4.mp3",
}));
vi.mock("../../../../proprietary/sounds/music/openfront.mp3", () => ({
  default: "openfront.mp3",
}));
vi.mock("../../../../proprietary/sounds/music/war.mp3", () => ({
  default: "war.mp3",
}));

// Mock assetUrl
vi.mock("../../../src/core/AssetUrls", () => ({
  assetUrl: (path: string) => path,
}));

import {
  ISoundManager,
  SoundEffect,
} from "../../../src/client/sound/ISoundManager";
import { SoundManager } from "../../../src/client/sound/SoundManager";

describe("SoundManager", () => {
  let soundManager: SoundManager;

  beforeEach(() => {
    soundManager = new SoundManager();
    howlCtor.mockClear();
  });

  it("implements ISoundManager interface", () => {
    const sm: ISoundManager = soundManager;
    expect(sm.playBackgroundMusic).toBeDefined();
    expect(sm.stopBackgroundMusic).toBeDefined();
    expect(sm.setBackgroundMusicVolume).toBeDefined();
    expect(sm.setSoundEffectsVolume).toBeDefined();
    expect(sm.playSoundEffect).toBeDefined();
    expect(sm.stopSoundEffect).toBeDefined();
  });

  it("is not a singleton - each instantiation creates a new instance", () => {
    const sm1 = new SoundManager();
    const sm2 = new SoundManager();
    expect(sm1).not.toBe(sm2);
  });

  it("lazy-loads a sound effect once and reuses it", () => {
    soundManager.playSoundEffect(SoundEffect.Click);
    soundManager.playSoundEffect(SoundEffect.Click);
    // Howl constructor should only be called once for Click
    expect(howlCtor).toHaveBeenCalledTimes(1);
  });

  it("applies current volume to lazily-loaded sounds", () => {
    soundManager.setSoundEffectsVolume(0.3);
    soundManager.playSoundEffect(SoundEffect.Click);
    // The Howl should have been created with volume 0.3
    expect(howlCtor).toHaveBeenCalledWith(
      expect.objectContaining({ volume: 0.3 }),
    );
  });

  it("can be used as ISoundManager type", () => {
    // Verify structural compatibility at runtime
    const sm: ISoundManager = soundManager;
    expect(() => sm.playSoundEffect(SoundEffect.Click)).not.toThrow();
    expect(() => sm.stopSoundEffect(SoundEffect.Click)).not.toThrow();
    expect(() => sm.setBackgroundMusicVolume(0.5)).not.toThrow();
    expect(() => sm.setSoundEffectsVolume(0.5)).not.toThrow();
    expect(() => sm.playBackgroundMusic()).not.toThrow();
    expect(() => sm.stopBackgroundMusic()).not.toThrow();
  });
});

describe("ISoundManager interface", () => {
  it("can be implemented as a mock for testing consumers", () => {
    const mockSoundManager: ISoundManager = {
      playBackgroundMusic: vi.fn(),
      stopBackgroundMusic: vi.fn(),
      setBackgroundMusicVolume: vi.fn(),
      setSoundEffectsVolume: vi.fn(),
      playSoundEffect: vi.fn(),
      stopSoundEffect: vi.fn(),
    };

    // Verify mock works correctly
    mockSoundManager.playSoundEffect(SoundEffect.Click);
    expect(mockSoundManager.playSoundEffect).toHaveBeenCalledWith(
      SoundEffect.Click,
    );

    mockSoundManager.setBackgroundMusicVolume(0.5);
    expect(mockSoundManager.setBackgroundMusicVolume).toHaveBeenCalledWith(0.5);
  });
});

describe("SoundEffect enum", () => {
  it("exports all expected sound effects from ISoundManager", () => {
    expect(SoundEffect.KaChing).toBe("ka-ching");
    expect(SoundEffect.AtomHit).toBe("atom-hit");
    expect(SoundEffect.AtomLaunch).toBe("atom-launch");
    expect(SoundEffect.HydrogenHit).toBe("hydrogen-hit");
    expect(SoundEffect.HydrogenLaunch).toBe("hydrogen-launch");
    expect(SoundEffect.MIRVLaunch).toBe("mirv-launch");
    expect(SoundEffect.AllianceSuggested).toBe("alliance-suggested");
    expect(SoundEffect.AllianceBroken).toBe("alliance-broken");
    expect(SoundEffect.BuildPort).toBe("build-port");
    expect(SoundEffect.BuildCity).toBe("build-city");
    expect(SoundEffect.BuildDefensePost).toBe("build-defense-post");
    expect(SoundEffect.BuildWarship).toBe("build-warship");
    expect(SoundEffect.SAMBuilt).toBe("sam-built");
    expect(SoundEffect.Message).toBe("message");
    expect(SoundEffect.Click).toBe("click");
  });

  it("is exported from ISoundManager module, not SoundManager", async () => {
    const iSoundManagerModule = await import(
      "../../../src/client/sound/ISoundManager"
    );
    expect(iSoundManagerModule.SoundEffect).toBeDefined();
    expect(iSoundManagerModule.SoundEffect.Click).toBe("click");
  });
});
