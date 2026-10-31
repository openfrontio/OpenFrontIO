import { afterEach, describe, expect, it, vi } from "vitest";
import "../../src/client/UserSettingModal";
import { OModal } from "../../src/client/components/baseComponents/Modal";
import type { GraphicsSettingsModal } from "../../src/client/components/GraphicsSettingsModal";
import { initNavigation } from "../../src/client/Navigation";
import type { UserSettingModal } from "../../src/client/UserSettingModal";
import { UserSettings } from "../../src/client/UserSettings";

async function mount(inline = false) {
  const settings = document.createElement("user-setting") as UserSettingModal;
  settings.inline = inline;
  if (inline) {
    settings.id = "page-settings";
    settings.classList.add("page-content");
    settings.setAttribute("inline", "");
  }
  document.body.appendChild(settings);
  await settings.updateComplete;
  const panel = settings.querySelector<GraphicsSettingsModal>(
    "graphics-settings-modal",
  )!;
  if (panel) await panel.updateComplete;
  return { settings, panel };
}

afterEach(() => {
  new UserSettings().setHudOpacity(1);
  document.documentElement.style.removeProperty("--hud-opacity");
  vi.restoreAllMocks();
});

describe("graphics preview panel", () => {
  it("renders controls only while open and opts into the left-aligned shell", async () => {
    const { settings, panel } = await mount();
    expect(panel.querySelector("graphics-advanced-settings")).toBeNull();
    settings.openGraphicsPanel();
    await panel.updateComplete;
    const shell = panel.querySelector<OModal>("o-modal")!;
    await shell.updateComplete;
    expect(shell.sidePanel).toBe(true);
    expect(shell.tabs).toEqual([]);
    expect(panel.querySelector("#ambient-light-slider")).not.toBeNull();
    panel.close();
    await panel.updateComplete;
    expect(panel.querySelector("graphics-advanced-settings")).toBeNull();
    expect(OModal.openCount).toBe(0);
  });

  it("dismisses on the unobscured backdrop and returns once", async () => {
    const { settings, panel } = await mount();
    const onReturn = vi.fn();
    settings.openGraphicsPanel(onReturn);
    await panel.updateComplete;
    const shell = panel.querySelector<OModal>("o-modal")!;
    await shell.updateComplete;
    shell.shadowRoot!.querySelector("aside")!.click();
    await Promise.resolve();
    expect(panel.isOpen()).toBe(false);
    expect(onReturn).toHaveBeenCalledOnce();
    expect(OModal.openCount).toBe(0);
  });

  it("expands Advanced in the main settings page without opening a side panel", async () => {
    const { settings, panel } = await mount(true);
    expect(panel).toBeNull();
    settings.open({ tab: "graphics" });
    await settings.updateComplete;
    const close = vi.spyOn(settings, "close");
    settings.openGraphicsPanel();
    await settings.updateComplete;
    expect(close).not.toHaveBeenCalled();
    expect(settings.isOpen()).toBe(true);
    expect(settings.querySelector("#graphics-advanced-inline")).not.toBeNull();
    expect(
      settings
        .querySelector("[data-open-graphics-panel]")!
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(OModal.openCount).toBe(0);
    settings.openGraphicsPanel();
    await settings.updateComplete;
    expect(settings.querySelector("#graphics-advanced-inline")).toBeNull();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await Promise.resolve();
    expect(settings.isOpen()).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });

  it("lets navigation close expanded inline settings without leaving a scroll lock", async () => {
    const originalShowPage = window.showPage;
    const { settings } = await mount(true);
    const play = Object.assign(document.createElement("div"), {
      id: "page-play",
    });
    const join = Object.assign(document.createElement("div"), {
      id: "page-join-lobby",
    });
    join.className = "page-content hidden";
    document.body.append(play, join);
    initNavigation();
    try {
      settings.open({ tab: "graphics" });
      settings.openGraphicsPanel();
      await settings.updateComplete;
      expect(settings.isOpen()).toBe(true);
      window.showPage!("page-join-lobby");
      await settings.updateComplete;
      expect(settings.isOpen()).toBe(false);
      expect(settings.classList.contains("hidden")).toBe(true);
      expect(join.classList.contains("hidden")).toBe(false);
      expect(OModal.openCount).toBe(0);
      expect(document.body.style.overflow).toBe("");
      settings.open({ tab: "graphics" });
      await settings.updateComplete;
      expect(settings.querySelector("#graphics-advanced-inline")).toBeNull();
      settings.close();
    } finally {
      window.showPage = originalShowPage;
    }
  });

  it("applies HUD opacity live from the in-game panel and ignores malformed input", async () => {
    const { settings, panel } = await mount();
    settings.openGraphicsPanel();
    await panel.updateComplete;
    const slider = panel.querySelector("#hud-opacity-slider")!;
    slider.dispatchEvent(
      new CustomEvent("change", { detail: { value: 35 }, bubbles: true }),
    );
    expect(new UserSettings().hudOpacity()).toBe(0.35);
    expect(
      document.documentElement.style.getPropertyValue("--hud-opacity"),
    ).toBe("0.35");
    slider.dispatchEvent(
      new CustomEvent("change", { detail: { value: NaN }, bubbles: true }),
    );
    expect(new UserSettings().hudOpacity()).toBe(0.35);
    expect(panel.isOpen()).toBe(true);
    const shell = panel.querySelector<OModal>("o-modal")!;
    await shell.updateComplete;
    expect(
      shell.shadowRoot!.querySelector(".graphics-panel-surface"),
    ).not.toBeNull();
    panel.close();
  });

  it("closes an active child silently when the owner is closed by navigation", async () => {
    const { settings, panel } = await mount();
    const onReturn = vi.fn();
    settings.openGraphicsPanel(onReturn);
    await panel.updateComplete;
    settings.close();
    expect(panel.isOpen()).toBe(false);
    expect(onReturn).not.toHaveBeenCalled();
    expect(OModal.openCount).toBe(0);
  });
});
