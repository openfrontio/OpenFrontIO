import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock howler before importing SoundManager
const howlCtor = vi.fn();
const howlInstances: any[] = [];
vi.mock("howler", () => {
  class MockHowl {
    play = vi.fn();
    stop = vi.fn();
    volume = vi.fn();
    playing = vi.fn().mockReturnValue(false);
    unload = vi.fn();
    once = vi.fn();
    constructor(_opts: any) {
      howlCtor(_opts);
      howlInstances.push(this);
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
  PlaySoundEffectEvent,
  SetBackgroundMusicVolumeEvent,
  SetSoundEffectsVolumeEvent,
  SoundEffect,
} from "../../../src/client/sound/ISoundManager";
import { SoundManager } from "../../../src/client/sound/SoundManager";
import { EventBus } from "../../../src/core/EventBus";
import { UserSettings } from "../../../src/core/game/UserSettings";

function createUserSettings(musicVolume = 0, sfxVolume = 1): UserSettings {
  const settings = new UserSettings();
  settings.setBackgroundMusicVolume(musicVolume);
  settings.setSoundEffectsVolume(sfxVolume);
  return settings;
}

describe("SoundManager", () => {
  let eventBus: EventBus;
  let userSettings: UserSettings;
  let soundManager: SoundManager;

  beforeEach(() => {
    howlCtor.mockClear();
    howlInstances.length = 0;
    eventBus = new EventBus();
    userSettings = createUserSettings();
    soundManager = new SoundManager(eventBus, userSettings);
  });

  it("lazy-loads a sound effect once and reuses it", () => {
    eventBus.emit(new PlaySoundEffectEvent(SoundEffect.Click));
    eventBus.emit(new PlaySoundEffectEvent(SoundEffect.Click));
    // 3 background music Howls + 1 Click Howl = 4
    expect(howlCtor).toHaveBeenCalledTimes(4);
  });

  it("plays a sound effect when PlaySoundEffectEvent is emitted", () => {
    eventBus.emit(new PlaySoundEffectEvent(SoundEffect.AtomHit));
    // 3 bg music + 1 effect = 4. The effect is the last created Howl.
    const effectHowl = howlInstances[howlInstances.length - 1];
    expect(effectHowl.play).toHaveBeenCalledTimes(1);
  });

  it("applies bootstrap volume from UserSettings to background music", () => {
    const settings = createUserSettings(0.5, 1);
    const bus = new EventBus();
    howlCtor.mockClear();
    howlInstances.length = 0;
    new SoundManager(bus, settings);
    // All 3 background music Howls should have volume set to 0.5
    const bgHowls = howlInstances.slice(0, 3);
    bgHowls.forEach((h) => {
      expect(h.volume).toHaveBeenCalledWith(0.5);
    });
  });

  it("applies current sfx volume to lazily-loaded sounds", () => {
    const settings = createUserSettings(0, 0.3);
    const bus = new EventBus();
    howlCtor.mockClear();
    howlInstances.length = 0;
    new SoundManager(bus, settings);
    bus.emit(new PlaySoundEffectEvent(SoundEffect.Click));
    // The Click Howl should be created with volume 0.3
    const clickHowl = howlInstances[howlInstances.length - 1];
    expect(howlCtor).toHaveBeenLastCalledWith(
      expect.objectContaining({ volume: 0.3 }),
    );
    expect(clickHowl).toBeDefined();
  });

  it("responds to SetBackgroundMusicVolumeEvent", () => {
    eventBus.emit(new SetBackgroundMusicVolumeEvent(0.7));
    const bgHowls = howlInstances.slice(0, 3);
    bgHowls.forEach((h) => {
      expect(h.volume).toHaveBeenCalledWith(0.7);
    });
  });

  it("responds to SetSoundEffectsVolumeEvent", () => {
    // Load a sound first
    eventBus.emit(new PlaySoundEffectEvent(SoundEffect.Click));
    const clickHowl = howlInstances[howlInstances.length - 1];
    clickHowl.volume.mockClear();
    eventBus.emit(new SetSoundEffectsVolumeEvent(0.4));
    expect(clickHowl.volume).toHaveBeenCalledWith(0.4);
  });

  it("clamps volume values between 0 and 1", () => {
    eventBus.emit(new SetBackgroundMusicVolumeEvent(2));
    const bgHowls = howlInstances.slice(0, 3);
    bgHowls.forEach((h) => {
      expect(h.volume).toHaveBeenCalledWith(1);
    });

    bgHowls.forEach((h) => h.volume.mockClear());
    eventBus.emit(new SetBackgroundMusicVolumeEvent(-0.5));
    bgHowls.forEach((h) => {
      expect(h.volume).toHaveBeenCalledWith(0);
    });
  });

  it("does not throw when playSoundEffect is called directly", () => {
    expect(() => soundManager.playSoundEffect(SoundEffect.Click)).not.toThrow();
  });

  it("does not throw when playBackgroundMusic and stopBackgroundMusic are called", () => {
    expect(() => soundManager.playBackgroundMusic()).not.toThrow();
    expect(() => soundManager.stopBackgroundMusic()).not.toThrow();
  });
});

describe("SoundEffect enum", () => {
  it("exports all expected sound effects", () => {
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
});
