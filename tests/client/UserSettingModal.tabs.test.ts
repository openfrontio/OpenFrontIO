import { beforeEach, describe, expect, it } from "vitest";

import { modalRouter } from "../../src/client/ModalRouter";
import type { UIState } from "../../src/client/UIState";
import "../../src/client/UserSettingModal";
import type { UserSettingModal } from "../../src/client/UserSettingModal";
import { UserSettings } from "../../src/core/game/UserSettings";

type TestModal = UserSettingModal & {
  updateComplete: Promise<unknown>;
  activeTab: string;
  modalConfig(): { tabs?: { key: string; label: string }[] };
};

async function mount(inline: boolean): Promise<TestModal> {
  const el = document.createElement("user-setting") as TestModal;
  if (inline) el.setAttribute("inline", "");
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("user-setting tabs", () => {
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

  it("groups the settings as Gameplay, Audio and Keybinds", async () => {
    const el = await mount(false);
    expect(el.modalConfig().tabs?.map((t) => t.key)).toEqual([
      "gameplay",
      "audio",
      "keybinds",
    ]);
  });

  it("opens on the requested tab", async () => {
    const el = await mount(false);
    el.open({ tab: "audio" });
    await el.updateComplete;
    expect(el.activeTab).toBe("audio");
  });

  it("lands an old tab=basic bookmark on Gameplay", async () => {
    // BaseModal validates the requested tab against tabs[] and falls back to
    // the first one, so no alias for the retired "basic" key is needed.
    const el = await mount(false);
    el.open({ tab: "basic" });
    await el.updateComplete;
    expect(el.activeTab).toBe("gameplay");
  });

  it("shows the toggles that moved out of the in-game menu on Gameplay", async () => {
    const el = await mount(false);
    el.open({ tab: "gameplay" });
    await el.updateComplete;
    expect(el.querySelector("#help-messages-toggle")).not.toBeNull();
    expect(el.querySelector("#attacking-troops-overlay-toggle")).not.toBeNull();
    // The graphics preset stays at the top of Gameplay rather than getting a
    // tab of its own.
    expect(el.querySelector("graphics-preset-selector")).not.toBeNull();
  });

  it("re-reads keybinds on every open, so two instances never diverge", async () => {
    const el = await mount(false);
    el.open({ tab: "keybinds" });
    await el.updateComplete;
    const before = el
      .querySelector('setting-keybind[action="zoomIn"]')
      ?.getAttribute("defaultkey");
    el.close();
    await el.updateComplete;

    // Stand in for the same setting being edited from the other instance.
    // UserSettings' cache is static and shared, so write through it rather
    // than straight to localStorage.
    new UserSettings().setKeybinds({ zoomIn: { value: "KeyJ", key: "J" } });

    el.open({ tab: "keybinds" });
    await el.updateComplete;
    const keybind = el.querySelector('setting-keybind[action="zoomIn"]') as
      | (HTMLElement & { value: string })
      | null;
    expect(keybind).not.toBeNull();
    expect(keybind!.value).toBe("KeyJ");
    expect(keybind!.value).not.toBe(before);
  });

  it("shows the ratio the player is attacking with, not the stored one", async () => {
    // The HUD's own attack ratio slider is session-only: it never writes
    // UserSettings. Without this, a player who nudged it to 50% mid-match
    // would open Settings on the stored 20% and silently reset themselves.
    new UserSettings().setAttackRatio(0.2);
    const el = await mount(false);
    el.uiState = { attackRatio: 0.5 } as UIState;
    el.open({ tab: "gameplay" });
    await el.updateComplete;

    const slider = el.querySelector("#attack-ratio-slider") as HTMLElement & {
      value: number;
    };
    expect(slider.value).toBeCloseTo(50);
    expect(new UserSettings().attackRatio()).toBeCloseTo(0.2);
  });

  it("falls back to the stored ratio on the page instance", async () => {
    new UserSettings().setAttackRatio(0.35);
    const el = await mount(true);
    el.open({ tab: "gameplay" });
    await el.updateComplete;

    const slider = el.querySelector("#attack-ratio-slider") as HTMLElement & {
      value: number;
    };
    expect(el.uiState).toBeUndefined();
    expect(slider.value).toBeCloseTo(35);
  });

  it("keeps the URL out of it on the non-inline in-game instance", async () => {
    // Main.ts's popstate handler treats a hash change during a match as a
    // request to leave the game, so #game-settings must never sync the URL.
    const el = await mount(false);
    const hashBefore = location.hash;
    el.open({ tab: "audio" });
    await el.updateComplete;
    expect(location.hash).toBe(hashBefore);
    el.close();
    await el.updateComplete;
    expect(location.hash).toBe(hashBefore);
  });

  it("still syncs the URL from the inline page instance", async () => {
    const el = await mount(true);
    el.open({ tab: "audio" });
    await el.updateComplete;
    expect(location.hash).toContain("modal=settings");
  });

  it("calls onReturn once, when the modal closes", async () => {
    const el = await mount(false);
    let returns = 0;
    el.open({ tab: "gameplay", onReturn: () => returns++ });
    await el.updateComplete;
    expect(returns).toBe(0);

    el.close();
    await el.updateComplete;
    expect(returns).toBe(1);

    // A later open with no callback must not inherit the previous one.
    el.open({ tab: "gameplay" });
    el.close();
    await el.updateComplete;
    expect(returns).toBe(1);
  });
});
