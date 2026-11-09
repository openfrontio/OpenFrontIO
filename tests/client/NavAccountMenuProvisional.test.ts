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

import type {
  Progress,
  ProgressionConfig,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import { NavAccountMenu } from "../../src/client/components/NavAccountMenu";
import type { GameXpFetchResult } from "../../src/client/ProgressionApi";
import {
  recordPendingXp,
  runCheck,
  startProvisionalProgress,
  stopProvisionalProgress,
} from "../../src/client/ProvisionalProgress";

// Level 1 takes 100 XP and every later level 110.
const CONFIG: ProgressionConfig = {
  version: 1,
  maxLevel: 100,
  maxPrestige: 10,
  levels: Array.from({ length: 100 }, (_, i) => ({
    level: i + 1,
    xpToNext: i + 1 >= 100 ? 0 : i === 0 ? 100 : 110,
    cumulativeXp: 0,
  })),
  flares: [],
};

// "Wonder": level 1 at 0 XP, with 250 provisional XP pending.
const CONFIRMED: Progress = {
  prestige: 0,
  level: 1,
  xpInLevel: 0,
  xpForNext: 100,
  lifetimeXp: 0,
  legend: false,
  canPrestige: false,
};

function userMe(progress: Progress = CONFIRMED): UserMeResponse {
  return {
    user: { email: "wonder@example.com" },
    player: { publicId: "wonder", progress },
  } as unknown as UserMeResponse;
}

describe("nav-account-menu provisional level", () => {
  let el: NavAccountMenu;
  let answer: GameXpFetchResult;

  beforeEach(() => {
    localStorage.clear();
    if (!customElements.get("nav-account-menu")) {
      customElements.define("nav-account-menu", NavAccountMenu);
    }
    answer = { status: "pending", notFound: true };
    startProvisionalProgress({
      fetchXp: async () => answer,
      loadConfig: async () => CONFIG,
      refreshUserMe: async () => undefined,
    });
  });

  afterEach(() => {
    el?.remove();
    stopProvisionalProgress();
    localStorage.clear();
  });

  async function mount(variant: "desktop" | "mobile"): Promise<void> {
    el = document.createElement("nav-account-menu") as NavAccountMenu;
    el.variant = variant;
    document.body.appendChild(el);
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: userMe() }),
    );
    await runCheck();
    await el.updateComplete;
    // The catch-up animation's steps.
    await vi.waitFor(async () => {
      await el.updateComplete;
      const badge = el.querySelector("[data-account-level] level-badge") as
        | (HTMLElement & { level: number })
        | null;
      expect(badge?.level).toBe(3);
    });
  }

  const fill = () =>
    el.querySelector<HTMLElement>("[data-account-xp-bar] [data-xp-bar-fill]");

  for (const variant of ["desktop", "mobile"] as const) {
    it(`shows the projected level on the ${variant} trigger, marked provisional`, async () => {
      recordPendingXp("wonder", { gameId: "g1", xp: 250 });
      await mount(variant);
      // 40 of 110 into level 3.
      await vi.waitFor(() =>
        expect(parseFloat(fill()!.style.width)).toBeCloseTo((40 / 110) * 100),
      );
      const level = el.querySelector("[data-account-level]")!;
      expect(level.hasAttribute("data-provisional")).toBe(true);
      expect(level.getAttribute("title")).toContain(
        "progression.provisional_label",
      );
      expect(
        el.querySelector("[data-account-trigger]")!.getAttribute("aria-label"),
      ).toContain("progression.provisional_label");
    });
  }

  it("says so at the top of the menu", async () => {
    recordPendingXp("wonder", { gameId: "g1", xp: 250 });
    await mount("desktop");
    el.querySelector<HTMLElement>("[data-account-trigger]")!.click();
    await el.updateComplete;
    const note = document.body.querySelector("[data-menu-provisional]");
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain("progression.provisional_label");
    expect(note!.textContent).toContain("40");
    expect(note!.textContent).toContain("110");
  });

  it("drops back to the confirmed level once the game is scored", async () => {
    recordPendingXp("wonder", { gameId: "g1", xp: 250 });
    await mount("desktop");
    // The API scored it lower: level 2 at 10.
    answer = {
      status: "ok",
      data: { gameId: "g1", eligible: false, reason: "too_short" },
    };
    const confirmed: Progress = {
      ...CONFIRMED,
      level: 2,
      xpInLevel: 10,
      xpForNext: 110,
      lifetimeXp: 110,
    };
    await runCheck();
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: userMe(confirmed) }),
    );
    await runCheck();
    await vi.waitFor(async () => {
      await el.updateComplete;
      const badge = el.querySelector("[data-account-level] level-badge") as
        | (HTMLElement & { level: number })
        | null;
      expect(badge?.level).toBe(2);
    });
    expect(
      el
        .querySelector("[data-account-level]")!
        .hasAttribute("data-provisional"),
    ).toBe(false);
  });
});
