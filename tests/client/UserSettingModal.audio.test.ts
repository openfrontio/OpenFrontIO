import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AudioControls } from "../../src/client/sound/CuePlayer";
import {
  setAudioControls,
  setCuePlayer,
} from "../../src/client/sound/CuePlayer";
import type { CueCategory, SoundEffect } from "../../src/client/sound/Sounds";
import "../../src/client/UserSettingModal";
import type { UserSettingModal } from "../../src/client/UserSettingModal";
import {
  type AudioCategory,
  UserSettings,
} from "../../src/core/game/UserSettings";

// Deliberately not importing AudioMixer: it pulls howler into the import graph
// of every test that mounts a settings modal, which is the reason CuePlayer
// exists. The tab reaches the mixer only through these two seams.

type TestModal = UserSettingModal & {
  updateComplete: Promise<unknown>;
};

const CATEGORIES: AudioCategory[] = [
  "master",
  "music",
  "effects",
  "alerts",
  "ambience",
  "interface",
];

/** previewCue("ambience") resolves without playing, so that row has no button. */
const TESTABLE: CueCategory[] = ["effects", "alerts", "interface"];

function resetUserSettingsState() {
  localStorage.clear();
  const statics = UserSettings as unknown as {
    cache: Map<string, string | null>;
    playerId: string | null;
  };
  statics.cache.clear();
  statics.playerId = null;
}

async function mountAudioTab({
  inGame,
}: { inGame?: boolean } = {}): Promise<TestModal> {
  const el = document.createElement("user-setting") as TestModal;
  if (!inGame) el.setAttribute("inline", "");
  document.body.appendChild(el);
  el.open({ tab: "audio" });
  await el.updateComplete;
  return el;
}

function slide(el: TestModal, category: string, value: number) {
  el.querySelector(`#audio-${category}-slider`)!.dispatchEvent(
    new CustomEvent("change", { detail: { value }, bubbles: true }),
  );
}

/** The host and its inner checkbox share an id; the checkbox is the control. */
function checkbox(el: TestModal, id: string): HTMLInputElement {
  return el.querySelector(`#${id} input[type="checkbox"]`) as HTMLInputElement;
}

function toggle(el: TestModal, id: string, checked: boolean) {
  const input = checkbox(el, id);
  input.checked = checked;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function testButton(el: TestModal, category: string): HTMLButtonElement | null {
  return el.querySelector(`#audio-${category}-test`);
}

/** Stands in for AudioMixer across the CuePlayer seam. */
function stubControls(
  opts: {
    audible?: boolean | ((category: AudioCategory) => boolean);
    manual?: boolean;
  } = {},
): AudioControls & {
  calls: CueCategory[];
  finish: () => void;
  fail: () => void;
} {
  let release: (() => void) | null = null;
  let breaks: ((reason: Error) => void) | null = null;
  const controls = {
    calls: [] as CueCategory[],
    previewCue(category: CueCategory) {
      controls.calls.push(category);
      if (!opts.manual) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        release = resolve;
        breaks = reject;
      });
    },
    isAudible: (category: AudioCategory) =>
      typeof opts.audible === "function"
        ? opts.audible(category)
        : (opts.audible ?? true),
    finish: () => release?.(),
    fail: () => breaks?.(new Error("cue failed")),
  };
  return controls;
}

describe("user-setting audio tab", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resetUserSettingsState();
    setAudioControls(null);
    setCuePlayer(null);
  });

  afterEach(() => {
    setAudioControls(null);
    setCuePlayer(null);
  });

  it("renders the six channels in mixer order", async () => {
    const el = await mountAudioTab();
    expect([...el.querySelectorAll("setting-slider")].map((s) => s.id)).toEqual(
      [
        "audio-master-slider",
        "audio-music-slider",
        "audio-effects-slider",
        "audio-alerts-slider",
        "audio-ambience-slider",
        "audio-interface-slider",
      ],
    );
  });

  it("shows each stored value as a bare 0-100 number, with no percent sign", async () => {
    new UserSettings().setAudioVolume("ambience", 0.35);
    const el = await mountAudioTab();

    const slider = el.querySelector("#audio-ambience-slider")!;
    expect((slider as unknown as { value: number }).value).toBe(35);
    const readout = slider.querySelector("span")!.textContent!.trim();
    expect(readout).toBe("35");
    expect(readout).not.toContain("%");
  });

  it("seeds every slider from its own stored value", async () => {
    const settings = new UserSettings();
    settings.setAudioVolume("master", 0.9);
    settings.setAudioVolume("music", 0.1);
    settings.setAudioVolume("effects", 0.2);
    settings.setAudioVolume("alerts", 0.3);
    settings.setAudioVolume("ambience", 0.4);
    settings.setAudioVolume("interface", 0.5);
    const el = await mountAudioTab();

    const values = CATEGORIES.map(
      (c) =>
        (el.querySelector(`#audio-${c}-slider`) as unknown as { value: number })
          .value,
    );
    expect(values).toEqual([90, 10, 20, 30, 40, 50]);
  });

  it("writes only its own channel's key, as value/100", async () => {
    const el = await mountAudioTab();
    slide(el, "alerts", 65);

    expect(new UserSettings().audioVolume("alerts")).toBeCloseTo(0.65);
    expect(localStorage.getItem("settings.audio.alerts")).toBe("0.65");
    for (const other of CATEGORIES.filter((c) => c !== "alerts")) {
      expect(localStorage.getItem(`settings.audio.${other}`)).toBeNull();
    }
  });

  it("writes the setting and nothing else — no volume event, no bus", async () => {
    const el = await mountAudioTab();
    expect("eventBus" in el).toBe(false);
    slide(el, "music", 40);
    expect(new UserSettings().audioVolume("music")).toBeCloseTo(0.4);
  });

  it("ticks once per drag through the mixer, rate-limited", async () => {
    const cues: SoundEffect[] = [];
    setCuePlayer((name) => cues.push(name));
    const el = await mountAudioTab();

    slide(el, "effects", 30);
    expect(cues).toEqual(["slider"]);

    // Same drag, well inside the 150 ms window: no second tick.
    slide(el, "effects", 31);
    expect(cues).toEqual(["slider"]);
  });

  it("does not tick when a value is set programmatically", async () => {
    const cues: SoundEffect[] = [];
    new UserSettings().setAudioVolume("music", 0.8);
    setCuePlayer((name) => cues.push(name));
    // Mounting seeds every slider's .value; only a user drag may tick.
    const el = await mountAudioTab();
    await el.updateComplete;
    expect(cues).toEqual([]);
  });

  it("puts a test button on exactly the previewable rows", async () => {
    setAudioControls(stubControls());
    const el = await mountAudioTab();
    expect(CATEGORIES.filter((c) => testButton(el, c) !== null)).toEqual(
      TESTABLE,
    );
  });

  it("previews the cue for the row it belongs to", async () => {
    const controls = stubControls();
    setAudioControls(controls);
    const el = await mountAudioTab();

    for (const category of TESTABLE) testButton(el, category)!.click();
    await el.updateComplete;

    expect(controls.calls).toEqual(TESTABLE);
  });

  it("disables the button while its own cue is still playing", async () => {
    const controls = stubControls({ manual: true });
    setAudioControls(controls);
    const el = await mountAudioTab();

    testButton(el, "alerts")!.click();
    await el.updateComplete;
    expect(testButton(el, "alerts")!.disabled).toBe(true);
    expect(testButton(el, "effects")!.disabled).toBe(false);

    controls.finish();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(testButton(el, "alerts")!.disabled).toBe(false);
  });

  it("re-enables the button when a preview fails", async () => {
    const controls = stubControls({ manual: true });
    setAudioControls(controls);
    const el = await mountAudioTab();
    // The click discards the promise, so the component must swallow the
    // rejection itself; the warning is the evidence that it did.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    testButton(el, "effects")!.click();
    await el.updateComplete;
    expect(testButton(el, "effects")!.disabled).toBe(true);

    controls.fail();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(testButton(el, "effects")!.disabled).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("re-enables the button if the preview never settles", async () => {
    // Howler fires neither `end` nor `stop` on loaderror/playerror, so a cue
    // whose asset fails leaves previewCue pending forever.
    setAudioControls({
      previewCue: () => new Promise<void>(() => {}),
      isAudible: () => true,
    });
    const el = await mountAudioTab();

    // Fake timers must be in place before the click, or the ceiling's
    // setTimeout is scheduled on the real clock and never advanced.
    vi.useFakeTimers();
    try {
      testButton(el, "effects")!.click();
      await el.updateComplete;
      expect(testButton(el, "effects")!.disabled).toBe(true);

      await vi.advanceTimersByTimeAsync(10_000);
      await el.updateComplete;
      expect(testButton(el, "effects")!.disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables the button with the channel hint when only that channel is silent", async () => {
    // Master audible, effects at 0.
    setAudioControls(stubControls({ audible: (c) => c !== "effects" }));
    const el = await mountAudioTab();

    const button = testButton(el, "effects")!;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("user_setting.audio_test_muted");
    // A channel that is up still offers a working button.
    expect(testButton(el, "alerts")!.disabled).toBe(false);
  });

  it("blames master, not the channel, when master is the blocker", async () => {
    // A fresh web install: master 0, every channel at its non-zero default.
    // isAudible gates on master first, so all three would otherwise tell the
    // player to turn up a slider that is already up — and there is no Test
    // button on the master row to act on.
    setAudioControls(stubControls({ audible: false }));
    const el = await mountAudioTab();

    for (const category of TESTABLE) {
      const button = testButton(el, category)!;
      expect(button.disabled).toBe(true);
      expect(button.getAttribute("title")).toBe(
        "user_setting.audio_test_master_muted",
      );
    }
  });

  it("renders no test buttons before the mixer registers itself", async () => {
    // Page load before initAudioMixer, and every component test: the hint
    // "turn this channel up" would be wrong advice when nothing can play yet.
    const el = await mountAudioTab();
    expect(CATEGORIES.filter((c) => testButton(el, c) !== null)).toEqual([]);
    expect(el.querySelectorAll("setting-slider")).toHaveLength(6);
  });

  it("stores both blur toggles", async () => {
    const el = await mountAudioTab();
    expect(new UserSettings().muteOnBlur()).toBe(false);
    expect(new UserSettings().alertsWhenUnfocused()).toBe(true);

    // Mute-on-blur is off by default, so keep-alerts starts disabled: turn the
    // parent on before touching it, as a player would have to.
    toggle(el, "audio-mute-on-blur-toggle", true);
    await el.updateComplete;
    expect(new UserSettings().muteOnBlur()).toBe(true);

    toggle(el, "audio-alerts-when-unfocused-toggle", false);
    expect(new UserSettings().alertsWhenUnfocused()).toBe(false);
  });

  it("disables keep-alerts while mute-on-blur is off", async () => {
    const el = await mountAudioTab();
    const dependent = () => checkbox(el, "audio-alerts-when-unfocused-toggle");
    // Off is the default, so the dependent row starts disabled.
    expect(dependent().disabled).toBe(true);

    toggle(el, "audio-mute-on-blur-toggle", true);
    await el.updateComplete;
    expect(dependent().disabled).toBe(false);

    toggle(el, "audio-mute-on-blur-toggle", false);
    await el.updateComplete;
    expect(dependent().disabled).toBe(true);
  });

  it("resets every channel to its default from the button", async () => {
    const before = new UserSettings();
    before.setAudioVolume("music", 0.1);
    before.setAudioVolume("effects", 0.2);
    before.setMuteOnBlur(true);
    const el = await mountAudioTab();
    expect(
      (el.querySelector("#audio-music-slider") as unknown as { value: number })
        .value,
    ).toBe(10);

    (el.querySelector("#audio-reset") as HTMLButtonElement).click();
    await el.updateComplete;

    // Storage is clean, and the sliders re-read it.
    expect(localStorage.getItem("settings.audio.music")).toBeNull();
    const sliderValue = (category: string) =>
      (
        el.querySelector(`#audio-${category}-slider`) as unknown as {
          value: number;
        }
      ).value;
    expect(sliderValue("music")).toBe(50);
    expect(sliderValue("effects")).toBe(70);
    // Web, and nothing stored any more, so master is silent.
    expect(sliderValue("master")).toBe(0);
    expect(checkbox(el, "audio-mute-on-blur-toggle").checked).toBe(false);
  });

  it("un-checks a toggle the player has clicked when reset", async () => {
    // The checkbox's dirty checkedness flag makes an attribute binding inert
    // after the first click, so `?checked` could not put it back.
    const el = await mountAudioTab();
    const box = () => checkbox(el, "audio-mute-on-blur-toggle");
    box().click();
    await el.updateComplete;
    expect(box().checked).toBe(true);
    expect(new UserSettings().muteOnBlur()).toBe(true);

    (el.querySelector("#audio-reset") as HTMLButtonElement).click();
    await el.updateComplete;

    expect(new UserSettings().muteOnBlur()).toBe(false);
    expect(box().checked).toBe(false);
  });

  it("keeps the slider fill in step with a programmatic value change", async () => {
    // Reset to defaults moves .value from outside; without this the thumb
    // moved but the filled part of the track stayed where it was.
    new UserSettings().setAudioVolume("music", 0.1);
    const el = await mountAudioTab();
    const track = () =>
      el.querySelector("#audio-music-slider input[type=range]") as HTMLElement;
    expect(track().style.getPropertyValue("--fill")).toBe("10%");

    (el.querySelector("#audio-reset") as HTMLButtonElement).click();
    await el.updateComplete;

    expect(track().style.getPropertyValue("--fill")).toBe("50%");
  });

  it("renders the same tab on the in-game instance", async () => {
    setAudioControls(stubControls());
    const el = await mountAudioTab({ inGame: true });
    expect([...el.querySelectorAll("setting-slider")].map((s) => s.id)).toEqual(
      [
        "audio-master-slider",
        "audio-music-slider",
        "audio-effects-slider",
        "audio-alerts-slider",
        "audio-ambience-slider",
        "audio-interface-slider",
      ],
    );
    expect(CATEGORIES.filter((c) => testButton(el, c) !== null)).toEqual(
      TESTABLE,
    );
    slide(el, "interface", 20);
    expect(new UserSettings().audioVolume("interface")).toBeCloseTo(0.2);
  });

  // translateText falls back to the raw key without a <lang-selector>, and the
  // repo's TranslationSystem sync test does not catch a missing user_setting
  // key, so assert the copy exists here.
  it("has en.json copy for every key the tab renders", () => {
    const en = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "..", "..", "resources", "lang", "en.json"),
        "utf8",
      ),
    ) as { user_setting: Record<string, string> };

    const required = [
      ...CATEGORIES.flatMap((c) => [`audio_${c}`, `audio_${c}_desc`]),
      "audio_mute_on_blur",
      "audio_mute_on_blur_desc",
      "audio_alerts_when_unfocused",
      "audio_alerts_when_unfocused_desc",
      "audio_test",
      "audio_test_muted",
      "audio_test_master_muted",
      "audio_reset",
    ];
    expect(required.filter((k) => !(k in en.user_setting))).toEqual([]);

    expect("background_music_volume" in en.user_setting).toBe(false);
    expect("sound_effects_volume" in en.user_setting).toBe(false);
  });
});
