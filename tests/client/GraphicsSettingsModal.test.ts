import { describe, expect, it, vi } from "vitest";
import "../../src/client/UserSettingModal";
import { OModal } from "../../src/client/components/baseComponents/Modal";
import type { GraphicsSettingsModal } from "../../src/client/components/GraphicsSettingsModal";
import type { UserSettingModal } from "../../src/client/UserSettingModal";

async function mount(inline = false) {
  const settings = document.createElement("user-setting") as UserSettingModal;
  settings.inline = inline;
  document.body.appendChild(settings);
  await settings.updateComplete;
  const panel = settings.querySelector<GraphicsSettingsModal>(
    "graphics-settings-modal",
  )!;
  await panel.updateComplete;
  return { settings, panel };
}

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

  it("keeps the inline page mounted and hands Escape back after closing", async () => {
    const { settings, panel } = await mount(true);
    settings.open({ tab: "graphics" });
    await settings.updateComplete;
    const close = vi.spyOn(settings, "close");
    settings.openGraphicsPanel();
    await panel.updateComplete;
    expect(close).not.toHaveBeenCalled();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await Promise.resolve();
    expect(panel.isOpen()).toBe(false);
    expect(settings.isOpen()).toBe(true);
    expect(close).not.toHaveBeenCalled();
    settings.close();
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
