import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modalRouter } from "../../src/client/ModalRouter";
import "../../src/client/UserSettingModal";
import type { UserSettingModal } from "../../src/client/UserSettingModal";

type TestModal = UserSettingModal & { updateComplete: Promise<unknown> };

async function mount(tab: string): Promise<TestModal> {
  const el = document.createElement("user-setting") as TestModal;
  document.body.appendChild(el);
  await el.updateComplete;
  el.open({ tab });
  await el.updateComplete;
  return el;
}

/** Drag the slider to `value` and let go, as a player would. */
function dragAndRelease(slider: Element, value: number) {
  const input = slider.querySelector("input[type=range]") as HTMLInputElement;
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("user-setting slider handlers", () => {
  let errors: unknown[];
  const onError = (e: ErrorEvent) => {
    errors.push(e.error);
    e.preventDefault();
  };

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    location.hash = "";
    modalRouter.register("settings", {
      tag: "user-setting",
      pageId: "page-settings",
    });
    errors = [];
    window.addEventListener("error", onError);
  });

  afterEach(() => {
    window.removeEventListener("error", onError);
    vi.restoreAllMocks();
  });

  it("saves the HUD opacity on release without throwing", async () => {
    const el = await mount("graphics");
    const slider = el.querySelector("#hud-opacity-slider");
    expect(slider).not.toBeNull();

    dragAndRelease(slider!, 40);

    expect(errors).toEqual([]);
    expect((el as any).userSettings.hudOpacity()).toBeCloseTo(0.4);
  });

  it("saves the nuke alliance safety duration on release without throwing", async () => {
    const el = await mount("gameplay");
    const slider = Array.from(el.querySelectorAll("setting-slider")).find(
      (s) => (s as HTMLElement & { max: number }).max === 30,
    );
    expect(slider).toBeDefined();

    dragAndRelease(slider!, 12);

    expect(errors).toEqual([]);
    expect((el as any).userSettings.nukeAllianceSafetyDuration()).toBe(12);
  });

  it("ignores a change event that carries no value", async () => {
    const el = await mount("graphics");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = (el as any).userSettings.hudOpacity();

    el.querySelector("#hud-opacity-slider")!.dispatchEvent(new Event("change"));

    expect(errors).toEqual([]);
    expect(warn).toHaveBeenCalled();
    expect((el as any).userSettings.hudOpacity()).toBe(before);
  });
});
