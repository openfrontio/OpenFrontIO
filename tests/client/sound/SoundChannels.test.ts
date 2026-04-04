import { beforeEach, describe, expect, it, vi } from "vitest";

let nextPlayId = 1;
const allHowlInstances: MockHowlInstance[] = [];

interface MockHowlInstance {
  play: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  volume: ReturnType<typeof vi.fn>;
  playing: ReturnType<typeof vi.fn>;
  unload: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  _listeners: Map<string, Map<number, () => void>>;
  _fireEvent: (event: string, id: number) => void;
}

vi.mock("howler", () => {
  class MockHowl implements MockHowlInstance {
    play = vi.fn(() => nextPlayId++);
    stop = vi.fn((id?: number) => {
      if (id !== undefined) {
        // Fire stop listeners for this id
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
    constructor(_opts?: any) {
      allHowlInstances.push(this);
    }
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

import {
  MAX_CONCURRENT_SOUNDS,
  SOUND_PRIORITY,
  SoundEffect,
} from "../../../src/client/sound/ISoundManager";
import { SoundManager } from "../../../src/client/sound/SoundManager";

describe("Sound channel management", () => {
  let sm: SoundManager;
  let baselineHowlCount = 0;

  beforeEach(() => {
    nextPlayId = 1;
    allHowlInstances.length = 0;
    sm = new SoundManager();
    baselineHowlCount = allHowlInstances.length;
  });

  it("MAX_CONCURRENT_SOUNDS is 4", () => {
    expect(MAX_CONCURRENT_SOUNDS).toBe(4);
  });

  it("allows playing up to MAX_CONCURRENT_SOUNDS simultaneously", () => {
    sm.playSoundEffect(SoundEffect.Click);
    sm.playSoundEffect(SoundEffect.Message);
    sm.playSoundEffect(SoundEffect.KaChing);
    sm.playSoundEffect(SoundEffect.BuildCity);

    // All 4 should have played (each lazy-loads a Howl, which calls play)
    // 3 background music Howls + 4 effect Howls = 7 total
    const effectHowls = allHowlInstances.slice(baselineHowlCount); // skip background music
    expect(effectHowls.length).toBe(4);
    effectHowls.forEach((h) => expect(h.play).toHaveBeenCalledTimes(1));
  });

  it("drops a new sound when at cap and new sound has lower priority", () => {
    // Fill with high priority sounds
    sm.playSoundEffect(SoundEffect.AtomHit); // priority 7
    sm.playSoundEffect(SoundEffect.HydrogenHit); // priority 7
    sm.playSoundEffect(SoundEffect.AtomLaunch); // priority 6
    sm.playSoundEffect(SoundEffect.MIRVLaunch); // priority 6

    const effectHowlsBefore = allHowlInstances.slice(baselineHowlCount);
    expect(effectHowlsBefore.length).toBe(4);

    // Try to play a Click (priority 1) - should be dropped
    sm.playSoundEffect(SoundEffect.Click);

    // Total play count should still be 4 — Click was dropped
    const totalPlayCount = allHowlInstances.reduce(
      (sum, h) => sum + h.play.mock.calls.length,
      0,
    );
    expect(totalPlayCount).toBe(4);
  });

  it("drops a new sound when at cap and new sound has equal priority", () => {
    // Fill with KaChing (priority 2)
    sm.playSoundEffect(SoundEffect.KaChing);
    sm.playSoundEffect(SoundEffect.KaChing);
    sm.playSoundEffect(SoundEffect.KaChing);
    sm.playSoundEffect(SoundEffect.KaChing);

    // Try another KaChing (same priority 2) - should be dropped
    const playCountBefore = allHowlInstances
      .slice(baselineHowlCount)
      .reduce((sum, h) => sum + h.play.mock.calls.length, 0);

    sm.playSoundEffect(SoundEffect.KaChing);

    const playCountAfter = allHowlInstances
      .slice(baselineHowlCount)
      .reduce((sum, h) => sum + h.play.mock.calls.length, 0);

    // No additional play call
    expect(playCountAfter).toBe(playCountBefore);
  });

  it("preempts lowest priority sound when new sound has higher priority", () => {
    // Fill channels with low-priority sounds
    sm.playSoundEffect(SoundEffect.Click); // priority 1
    sm.playSoundEffect(SoundEffect.KaChing); // priority 2
    sm.playSoundEffect(SoundEffect.BuildCity); // priority 3
    sm.playSoundEffect(SoundEffect.Message); // priority 4

    // The Click Howl is the lowest priority
    const clickHowl = allHowlInstances[baselineHowlCount]; // first effect Howl after 3 bg music

    // Play a nuke hit (priority 7) - should preempt Click
    sm.playSoundEffect(SoundEffect.AtomHit);

    // Click's Howl should have been stopped with its specific ID
    expect(clickHowl.stop).toHaveBeenCalledWith(1); // id=1 was first play
  });

  it("frees a channel when a sound ends naturally", () => {
    sm.playSoundEffect(SoundEffect.Click); // id=1
    sm.playSoundEffect(SoundEffect.Message); // id=2
    sm.playSoundEffect(SoundEffect.KaChing); // id=3
    sm.playSoundEffect(SoundEffect.BuildCity); // id=4

    // Simulate Click finishing naturally
    const clickHowl = allHowlInstances[baselineHowlCount];
    clickHowl._fireEvent("end", 1);

    // Now we should be able to play another sound without preemption
    sm.playSoundEffect(SoundEffect.BuildPort); // id=5
    const portHowl = allHowlInstances.find(
      (h) =>
        h !== clickHowl && h.play.mock.results.some((r: any) => r.value === 5),
    );
    // BuildPort should have played successfully
    expect(portHowl).toBeDefined();
    expect(portHowl!.play).toHaveBeenCalled();
  });

  it("frees a channel when a sound is stopped via stopSoundEffect", () => {
    sm.playSoundEffect(SoundEffect.Click);
    sm.playSoundEffect(SoundEffect.Message);
    sm.playSoundEffect(SoundEffect.KaChing);
    sm.playSoundEffect(SoundEffect.BuildCity);

    // Stop all Click sounds
    sm.stopSoundEffect(SoundEffect.Click);

    // Should be able to play another low-priority sound
    sm.playSoundEffect(SoundEffect.Click);
    // The new click should have played (check total play count on click howl)
    const clickHowl = allHowlInstances[baselineHowlCount];
    expect(clickHowl.play).toHaveBeenCalledTimes(2);
  });

  it("preempts the correct sound when multiple have different priorities", () => {
    sm.playSoundEffect(SoundEffect.Click); // priority 1, id=1
    sm.playSoundEffect(SoundEffect.KaChing); // priority 2, id=2
    sm.playSoundEffect(SoundEffect.BuildCity); // priority 3, id=3
    sm.playSoundEffect(SoundEffect.AllianceBroken); // priority 5, id=4

    // Play AtomLaunch (priority 6) - should preempt Click (priority 1)
    sm.playSoundEffect(SoundEffect.AtomLaunch);

    const clickHowl = allHowlInstances[baselineHowlCount]; // first effect howl = Click
    expect(clickHowl.stop).toHaveBeenCalledWith(1);
  });
});

describe("Sound priority configuration", () => {
  it("every SoundEffect has a priority defined", () => {
    for (const effect of Object.values(SoundEffect)) {
      expect(SOUND_PRIORITY[effect]).toBeDefined();
      expect(typeof SOUND_PRIORITY[effect]).toBe("number");
    }
  });

  it("nuke hits have the highest priority", () => {
    const maxPriority = Math.max(...Object.values(SOUND_PRIORITY));
    expect(SOUND_PRIORITY[SoundEffect.AtomHit]).toBe(maxPriority);
    expect(SOUND_PRIORITY[SoundEffect.HydrogenHit]).toBe(maxPriority);
  });

  it("click has the lowest priority", () => {
    const minPriority = Math.min(...Object.values(SOUND_PRIORITY));
    expect(SOUND_PRIORITY[SoundEffect.Click]).toBe(minPriority);
  });

  it("launches are higher priority than builds", () => {
    expect(SOUND_PRIORITY[SoundEffect.AtomLaunch]).toBeGreaterThan(
      SOUND_PRIORITY[SoundEffect.BuildCity],
    );
  });

  it("alliance events are higher priority than builds", () => {
    expect(SOUND_PRIORITY[SoundEffect.AllianceBroken]).toBeGreaterThan(
      SOUND_PRIORITY[SoundEffect.BuildWarship],
    );
  });

  it("message is higher priority than builds", () => {
    expect(SOUND_PRIORITY[SoundEffect.Message]).toBeGreaterThan(
      SOUND_PRIORITY[SoundEffect.BuildCity],
    );
  });

  it("message is higher priority than conquest", () => {
    expect(SOUND_PRIORITY[SoundEffect.Message]).toBeGreaterThan(
      SOUND_PRIORITY[SoundEffect.KaChing],
    );
  });
});
