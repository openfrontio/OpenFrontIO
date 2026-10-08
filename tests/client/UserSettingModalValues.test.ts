import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modalRouter } from "../../src/client/ModalRouter";
import "../../src/client/UserSettingModal";
import type { UserSettingModal } from "../../src/client/UserSettingModal";

type TestModal = UserSettingModal & { updateComplete: Promise<unknown> };

// The easter-egg controls only render on Gameplay after the konami-style
// unlock; flip the flag directly instead of replaying the key sequence.
async function mountGameplayWithEasterEggs(): Promise<TestModal> {
  const el = document.createElement("user-setting") as TestModal;
  document.body.appendChild(el);
  await el.updateComplete;
  el.open({ tab: "gameplay" });
  (el as any).showEasterEggSettings = true;
  await el.updateComplete;
  return el;
}

describe("user-setting easter-egg value handlers", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    location.hash = "";
    // Main.ts registers this at boot; the URL sync is a no-op without it.
    modalRouter.register("settings", {
      tag: "user-setting",
      pageId: "page-settings",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the writing-speed slider value when the event carries one", async () => {
    const el = await mountGameplayWithEasterEggs();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const slider = el.querySelector("setting-slider[easter]");
    expect(slider).not.toBeNull();
    slider!.dispatchEvent(new CustomEvent("change", { detail: { value: 55 } }));

    expect(log).toHaveBeenCalledWith("Changed:", 55);
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs the bug-count value when the event carries one", async () => {
    const el = await mountGameplayWithEasterEggs();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const number = el.querySelector("setting-number[easter]");
    expect(number).not.toBeNull();
    number!.dispatchEvent(
      new CustomEvent("change", { detail: { value: 250 } }),
    );

    expect(log).toHaveBeenCalledWith("Changed:", 250);
    expect(warn).not.toHaveBeenCalled();
  });
});
