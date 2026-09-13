import { beforeEach, describe, expect, it } from "vitest";

import {
  SetBackgroundMusicVolumeEvent,
  SetSoundEffectsVolumeEvent,
} from "../../src/client/sound/Sounds";
import "../../src/client/UserSettingModal";
import type { UserSettingModal } from "../../src/client/UserSettingModal";
import { EventBus } from "../../src/core/EventBus";
import { UserSettings } from "../../src/core/game/UserSettings";

type TestModal = UserSettingModal & {
  updateComplete: Promise<unknown>;
};

async function mountAudioTab(): Promise<TestModal> {
  const el = document.createElement("user-setting") as TestModal;
  document.body.appendChild(el);
  el.open({ tab: "audio" });
  await el.updateComplete;
  return el;
}

function slide(el: TestModal, id: string, value: number) {
  el.querySelector(`#${id}`)!.dispatchEvent(
    new CustomEvent("change", { detail: { value }, bubbles: true }),
  );
}

describe("user-setting audio tab", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("stores the volumes the sliders produce", async () => {
    const el = await mountAudioTab();
    slide(el, "background-music-volume-slider", 40);
    slide(el, "sound-effects-volume-slider", 65);

    const settings = new UserSettings();
    expect(settings.backgroundMusicVolume()).toBeCloseTo(0.4);
    expect(settings.soundEffectsVolume()).toBeCloseTo(0.65);
  });

  it("also emits the sound events when a game bus is attached", async () => {
    // SoundManager reads UserSettings once at construction, so a running game
    // only follows the sliders through the bus.
    const el = await mountAudioTab();
    const eventBus = new EventBus();
    const music: number[] = [];
    const effects: number[] = [];
    eventBus.on(SetBackgroundMusicVolumeEvent, (e) => music.push(e.volume));
    eventBus.on(SetSoundEffectsVolumeEvent, (e) => effects.push(e.volume));
    el.eventBus = eventBus;

    slide(el, "background-music-volume-slider", 40);
    slide(el, "sound-effects-volume-slider", 65);

    expect(music).toEqual([0.4]);
    expect(effects).toEqual([0.65]);
  });

  it("does not throw without a bus, which is the page instance's case", async () => {
    const el = await mountAudioTab();
    expect(el.eventBus).toBeUndefined();
    expect(() => slide(el, "background-music-volume-slider", 10)).not.toThrow();
    expect(new UserSettings().backgroundMusicVolume()).toBeCloseTo(0.1);
  });
});
