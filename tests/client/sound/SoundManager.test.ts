import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock howler before importing SoundManager
const howlCtor = vi.fn();
const howlInstances: any[] = [];
let nextPlayId = 1;
vi.mock("howler", () => {
  class MockHowl {
    play = vi.fn(() => nextPlayId++);
    stop = vi.fn((id?: number) => {
      if (id !== undefined) {
        this._fireEvent("stop", id);
      }
    });
    volume = vi.fn();
    playing = vi.fn().mockReturnValue(false);
    unload = vi.fn();
    once = vi.fn((event: string, callback: () => void, id?: number) => {
      if (id !== undefined) {
        if (!this._listeners.has(event)) {
          this._listeners.set(event, new Map());
        }
        this._listeners.get(event)!.set(id, callback);
      }
    });
    _listeners: Map<string, Map<number, () => void>> = new Map();
    _fireEvent(event: string, id: number) {
      const cb = this._listeners.get(event)?.get(id);
      if (cb) {
        cb();
        this._listeners.get(event)?.delete(id);
      }
    }
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

// Mock the Sounds module so tests don't depend on actual asset paths
vi.mock("../../../src/client/sound/Sounds", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/client/sound/Sounds")>();
  return {
    ...actual,
    soundEffectUrls: new Map([
      ["click", "mock/click.mp3"],
      ["atom-hit", "mock/atom-hit.mp3"],
      ["atom-launch", "mock/atom-launch.mp3"],
      ["hydrogen-hit", "mock/hydrogen-hit.mp3"],
      ["hydrogen-launch", "mock/hydrogen-launch.mp3"],
      ["mirv-launch", "mock/mirv-launch.mp3"],
      ["ka-ching", "mock/ka-ching.mp3"],
      ["message", "mock/message.mp3"],
      ["build-city", "mock/build-city.mp3"],
    ]),
  };
});

import {
  MAX_CONCURRENT_SOUNDS,
  SoundManager,
} from "../../../src/client/sound/SoundManager";
import {
  PlaySoundEffectEvent,
  SetBackgroundMusicVolumeEvent,
  SetSoundEffectsVolumeEvent,
} from "../../../src/client/sound/Sounds";
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
    nextPlayId = 1;
    eventBus = new EventBus();
    userSettings = createUserSettings();
    soundManager = new SoundManager(eventBus, userSettings);
  });

  it("lazy-loads a sound effect once and reuses it", () => {
    eventBus.emit(new PlaySoundEffectEvent("click"));
    eventBus.emit(new PlaySoundEffectEvent("click"));
    // 3 background music Howls + 1 Click Howl = 4
    expect(howlCtor).toHaveBeenCalledTimes(4);
  });

  it("plays a sound effect when PlaySoundEffectEvent is emitted", () => {
    eventBus.emit(new PlaySoundEffectEvent("atom-hit"));
    const effectHowl = howlInstances[howlInstances.length - 1];
    expect(effectHowl.play).toHaveBeenCalledTimes(1);
  });

  it("applies bootstrap volume from UserSettings to background music", () => {
    const settings = createUserSettings(0.5, 1);
    const bus = new EventBus();
    howlCtor.mockClear();
    howlInstances.length = 0;
    new SoundManager(bus, settings);
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
    bus.emit(new PlaySoundEffectEvent("click"));
    expect(howlCtor).toHaveBeenLastCalledWith(
      expect.objectContaining({ volume: 0.3 }),
    );
  });

  it("responds to SetBackgroundMusicVolumeEvent", () => {
    eventBus.emit(new SetBackgroundMusicVolumeEvent(0.7));
    const bgHowls = howlInstances.slice(0, 3);
    bgHowls.forEach((h) => {
      expect(h.volume).toHaveBeenCalledWith(0.7);
    });
  });

  it("responds to SetSoundEffectsVolumeEvent", () => {
    eventBus.emit(new PlaySoundEffectEvent("click"));
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

  it("dispose() unsubscribes from EventBus so events no longer play sounds", () => {
    eventBus.emit(new PlaySoundEffectEvent("click"));
    const clickHowl = howlInstances[howlInstances.length - 1];
    expect(clickHowl.play).toHaveBeenCalledTimes(1);

    soundManager.dispose();

    eventBus.emit(new PlaySoundEffectEvent("click"));
    expect(clickHowl.play).toHaveBeenCalledTimes(1);
  });

  it("dispose() stops and unloads all loaded sound effects", () => {
    eventBus.emit(new PlaySoundEffectEvent("click"));
    const clickHowl = howlInstances[howlInstances.length - 1];

    soundManager.dispose();

    expect(clickHowl.stop).toHaveBeenCalled();
    expect(clickHowl.unload).toHaveBeenCalled();
  });

  it("dispose() stops and unloads background music", () => {
    const bgHowls = howlInstances.slice(0, 3);

    soundManager.dispose();

    bgHowls.forEach((h) => {
      expect(h.stop).toHaveBeenCalled();
      expect(h.unload).toHaveBeenCalled();
    });
  });

  it("does not throw when playSoundEffect is called directly", () => {
    expect(() => soundManager.playSoundEffect("click")).not.toThrow();
  });

  it("does not throw when playBackgroundMusic and stopBackgroundMusic are called", () => {
    expect(() => soundManager.playBackgroundMusic()).not.toThrow();
    expect(() => soundManager.stopBackgroundMusic()).not.toThrow();
  });

  it("swallows errors from Howler and does not propagate", () => {
    howlInstances.forEach((h) => {
      h.play.mockImplementation(() => {
        throw new Error("audio backend failure");
      });
      h.stop.mockImplementation(() => {
        throw new Error("audio backend failure");
      });
      h.volume.mockImplementation(() => {
        throw new Error("audio backend failure");
      });
    });
    eventBus.emit(new PlaySoundEffectEvent("click"));
    const clickHowl = howlInstances[howlInstances.length - 1];
    clickHowl.play.mockImplementation(() => {
      throw new Error("audio backend failure");
    });
    clickHowl.stop.mockImplementation(() => {
      throw new Error("audio backend failure");
    });
    clickHowl.volume.mockImplementation(() => {
      throw new Error("audio backend failure");
    });

    expect(() => soundManager.playBackgroundMusic()).not.toThrow();
    expect(() => soundManager.stopBackgroundMusic()).not.toThrow();
    expect(() => soundManager.setBackgroundMusicVolume(0.5)).not.toThrow();
    expect(() => soundManager.setSoundEffectsVolume(0.5)).not.toThrow();
    expect(() => soundManager.playSoundEffect("click")).not.toThrow();
    expect(() => soundManager.stopSoundEffect("click")).not.toThrow();
  });
});

describe("Sound channel management", () => {
  let eventBus: EventBus;

  beforeEach(() => {
    howlCtor.mockClear();
    howlInstances.length = 0;
    nextPlayId = 1;
    eventBus = new EventBus();
    new SoundManager(eventBus, createUserSettings());
  });

  it("new sound always plays even when at channel cap", () => {
    for (let i = 0; i < MAX_CONCURRENT_SOUNDS; i++) {
      eventBus.emit(new PlaySoundEffectEvent("click"));
    }

    eventBus.emit(new PlaySoundEffectEvent("atom-hit"));
    const atomHowl = howlInstances[howlInstances.length - 1];
    expect(atomHowl.play).toHaveBeenCalled();
  });

  it("stops the oldest sound when at channel cap", () => {
    for (let i = 0; i < MAX_CONCURRENT_SOUNDS; i++) {
      eventBus.emit(new PlaySoundEffectEvent("click"));
    }
    const clickHowl = howlInstances[howlInstances.length - 1];

    // The first play had id=1. Playing one more should stop id=1.
    eventBus.emit(new PlaySoundEffectEvent("atom-hit"));
    expect(clickHowl.stop).toHaveBeenCalledWith(1);
  });

  it("frees a channel when a sound ends naturally", () => {
    for (let i = 0; i < MAX_CONCURRENT_SOUNDS; i++) {
      eventBus.emit(new PlaySoundEffectEvent("click"));
    }
    const clickHowl = howlInstances[howlInstances.length - 1];

    // Simulate first sound ending naturally
    clickHowl._fireEvent("end", 1);

    // Next sound should play without stopping anything
    clickHowl.stop.mockClear();
    eventBus.emit(new PlaySoundEffectEvent("click"));
    expect(clickHowl.stop).not.toHaveBeenCalled();
  });

  it("allows up to MAX_CONCURRENT_SOUNDS without stopping any", () => {
    for (let i = 0; i < MAX_CONCURRENT_SOUNDS; i++) {
      eventBus.emit(new PlaySoundEffectEvent("click"));
    }
    const clickHowl = howlInstances[howlInstances.length - 1];
    expect(clickHowl.play).toHaveBeenCalledTimes(8);
    // No stop calls with specific IDs (only general stop might be called)
    expect(clickHowl.stop).not.toHaveBeenCalled();
  });
});
