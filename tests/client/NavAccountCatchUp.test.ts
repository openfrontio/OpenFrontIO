import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Auth", () => ({ logOut: vi.fn() }));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: () => false,
    getUserProfile: vi.fn(async () => null),
    showAuthPrompt: vi.fn(),
  },
}));
vi.mock("../../src/client/InGameModal", () => ({ showInGameConfirm: vi.fn() }));
vi.mock("../../src/client/Navigation", () => ({
  closeMobileSidebar: vi.fn(),
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  copyToClipboard: vi.fn(),
  showToast: vi.fn(),
}));

import type { Progress, UserMeResponse } from "@openfront/shared/ApiSchemas";
import {
  NAV_CATCH_UP_MS,
  NAV_LEVEL_POP_MS,
  NavAccountMenu,
  navCatchUp,
} from "../../src/client/components/NavAccountMenu";

const at = (
  level: number,
  xpInLevel: number,
  lifetimeXp: number,
  prestige = 3,
): Progress => ({
  prestige,
  level,
  xpInLevel,
  xpForNext: 2000,
  lifetimeXp,
  legend: false,
  canPrestige: false,
});

// Sample player Wonder: level 46, most of the way through it.
const before = at(46, 1500, 124_000);
const sameLevel = at(46, 1800, 124_300);
const nextLevel = at(47, 500, 125_000);

const env = { onScreen: true, pageVisible: true, reducedMotion: false };

describe("navCatchUp", () => {
  it("grows within a level and levels up across one", () => {
    expect(navCatchUp(before, sameLevel, env)).toBe("grow");
    expect(navCatchUp(before, nextLevel, env)).toBe("level_up");
  });

  it("snaps on first load, and for progress that isn't higher", () => {
    expect(navCatchUp(null, nextLevel, env)).toBe("snap");
    expect(navCatchUp(before, null, env)).toBe("snap");
    expect(navCatchUp(before, before, env)).toBe("snap");
    expect(navCatchUp(nextLevel, before, env)).toBe("snap");
    // A prestige resets the level without adding XP: no catch-up.
    expect(navCatchUp(at(100, 0, 500_000, 3), at(1, 0, 500_000, 4), env)).toBe(
      "snap",
    );
  });

  it("snaps when nobody can watch it", () => {
    expect(navCatchUp(before, nextLevel, { ...env, onScreen: false })).toBe(
      "snap",
    );
    expect(navCatchUp(before, nextLevel, { ...env, pageVisible: false })).toBe(
      "snap",
    );
    expect(navCatchUp(before, nextLevel, { ...env, reducedMotion: true })).toBe(
      "snap",
    );
  });
});

function userMe(progress: Progress): UserMeResponse {
  return {
    user: { email: "wonder@example.com" },
    player: { publicId: "wonder01", progress },
  } as unknown as UserMeResponse;
}

describe("nav-account-menu catch-up", () => {
  let el: NavAccountMenu;
  let onScreen = true;

  beforeEach(() => {
    vi.useFakeTimers();
    if (!customElements.get("nav-account-menu")) {
      customElements.define("nav-account-menu", NavAccountMenu);
    }
    onScreen = true;
    vi.spyOn(
      NavAccountMenu.prototype as unknown as { isOnScreen: () => boolean },
      "isOnScreen",
    ).mockImplementation(() => onScreen);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });

  afterEach(() => {
    el?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function mount(progress: Progress): Promise<void> {
    el = document.createElement("nav-account-menu") as NavAccountMenu;
    el.variant = "desktop";
    document.body.appendChild(el);
    await send(progress);
  }

  async function send(progress: Progress): Promise<void> {
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: userMe(progress) }),
    );
    await el.updateComplete;
  }

  const fill = () =>
    el.querySelector<HTMLElement>("[data-account-xp-bar] [data-xp-bar-fill]")!;
  const badgeLevel = () =>
    (
      el.querySelector("[data-account-level] level-badge") as HTMLElement & {
        level: number;
      }
    ).level;
  const popping = () =>
    el
      .querySelector("[data-account-level]")!
      .classList.contains("nav-level-pop");
  const transitionEnd = async () => {
    const e = new Event("transitionend") as TransitionEvent;
    Object.defineProperty(e, "propertyName", { value: "width" });
    fill().dispatchEvent(e);
    await vi.advanceTimersByTimeAsync(0);
    await el.updateComplete;
  };

  it("shows the first progress as it is", async () => {
    await mount(before);
    expect(badgeLevel()).toBe(46);
    expect(fill().style.width).toBe("75%");
    expect(fill().style.transition).toBe("");
  });

  it("fills, ticks the level over with a pop, then grows to the new progress", async () => {
    await mount(before);
    await send(nextLevel);
    // 1. Fill to the end of the old level.
    expect(badgeLevel()).toBe(46);
    expect(fill().style.width).toBe("100%");
    expect(fill().style.transition).toContain(`${NAV_CATCH_UP_MS}ms`);
    // 2. When it gets there, the level ticks over and the badge pops; 3. the
    // bar empties without a transition; 4. it grows to the new width.
    await transitionEnd();
    expect(badgeLevel()).toBe(47);
    expect(popping()).toBe(true);
    expect(fill().style.width).toBe("25%");
    expect(fill().style.transition).toContain(`${NAV_CATCH_UP_MS}ms`);
    await transitionEnd();
    expect(fill().style.transition).toBe("");
    await vi.advanceTimersByTimeAsync(NAV_LEVEL_POP_MS);
    await el.updateComplete;
    expect(popping()).toBe(false);
  });

  it("empties the bar without a transition before growing it", async () => {
    await mount(before);
    await send(nextLevel);
    // Record the fill's styles at each render.
    const seen: string[] = [];
    const observer = new MutationObserver(() =>
      seen.push(`${fill().style.width}|${fill().style.transition}`),
    );
    observer.observe(fill(), { attributes: true, attributeFilter: ["style"] });
    await transitionEnd();
    observer.disconnect();
    expect(seen[0]).toBe("0%|");
    expect(seen[seen.length - 1]).toContain("25%|width");
  });

  it("carries on if the transition never reports its end", async () => {
    await mount(before);
    await send(nextLevel);
    await vi.advanceTimersByTimeAsync(NAV_CATCH_UP_MS + 200);
    await el.updateComplete;
    expect(badgeLevel()).toBe(47);
    await vi.advanceTimersByTimeAsync(NAV_CATCH_UP_MS + 200);
    await el.updateComplete;
    expect(fill().style.width).toBe("25%");
    expect(fill().style.transition).toBe("");
  });

  it("grows within a level", async () => {
    await mount(before);
    await send(sameLevel);
    expect(badgeLevel()).toBe(46);
    expect(fill().style.width).toBe("90%");
    expect(fill().style.transition).toContain(`${NAV_CATCH_UP_MS}ms`);
    expect(popping()).toBe(false);
  });

  it("snaps when the menu is hidden", async () => {
    await mount(before);
    onScreen = false;
    await send(nextLevel);
    expect(badgeLevel()).toBe(47);
    expect(fill().style.width).toBe("25%");
    expect(fill().style.transition).toBe("");
  });

  it("snaps when the page is hidden", async () => {
    await mount(before);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await send(nextLevel);
    expect(badgeLevel()).toBe(47);
    expect(fill().style.transition).toBe("");
  });

  it("snaps under reduced motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    await mount(before);
    await send(nextLevel);
    expect(badgeLevel()).toBe(47);
    expect(fill().style.transition).toBe("");
    expect(popping()).toBe(false);
  });
});

describe("nav-account-menu layout", () => {
  let el: NavAccountMenu;

  beforeEach(() => {
    if (!customElements.get("nav-account-menu")) {
      customElements.define("nav-account-menu", NavAccountMenu);
    }
  });

  afterEach(() => {
    el?.remove();
  });

  async function mount(variant: "desktop" | "mobile"): Promise<void> {
    el = document.createElement("nav-account-menu") as NavAccountMenu;
    el.variant = variant;
    document.body.appendChild(el);
    await el.updateComplete;
  }

  async function send(progress: Progress | undefined): Promise<void> {
    const u = userMe(before) as unknown as { player: { progress?: Progress } };
    if (progress === undefined) delete u.player.progress;
    else u.player.progress = progress;
    document.dispatchEvent(new CustomEvent("userMeResponse", { detail: u }));
    await el.updateComplete;
  }

  it("keeps the desktop bar under the badge and avatar row, clear of the avatar", async () => {
    await mount("desktop");
    await send(undefined);
    const row = el.querySelector<HTMLElement>("[data-account-identity]")!;
    // No progress: no bar, and the row adds no padding for one.
    expect(el.querySelector("[data-account-xp-bar]")).toBeNull();
    expect(row.classList.contains("pb-1.5")).toBe(false);
    const avatar = el.querySelector("[data-account-avatar]");

    await send(before);
    const bar = el.querySelector<HTMLElement>("[data-account-xp-bar]")!;
    // The bar sits in the row's own bottom padding, spanning badge and
    // avatar only, and the avatar is a size smaller so it doesn't overhang.
    expect(bar.parentElement).toBe(row);
    expect(bar.className).toContain("bottom-0 left-0 right-0");
    expect(row.classList.contains("pb-1.5")).toBe(true);
    expect(row.className).toContain("[&_[data-account-avatar]]:h-7");
    expect(row.querySelector("[data-account-level]")).not.toBeNull();
    expect(row.querySelector("[data-account-avatar]")).not.toBeNull();
    // The chevron is outside the row, so the bar never runs under it.
    const chevron = el.querySelector(
      "[data-account-trigger]",
    )!.lastElementChild!;
    expect(chevron.tagName.toLowerCase()).toBe("svg");
    expect(row.contains(chevron)).toBe(false);
    // The avatar NavAccountButton drives is the same element as before.
    expect(el.querySelector("[data-account-avatar]")).toBe(avatar);
  });

  it("keeps the mobile bar under the avatar", async () => {
    await mount("mobile");
    await send(before);
    const bar = el.querySelector<HTMLElement>("[data-account-xp-bar]")!;
    expect(bar.className).toContain("-bottom-1.5 left-0 right-0");
    expect(
      bar.parentElement!.querySelector("[data-account-avatar]"),
    ).not.toBeNull();
  });
});
