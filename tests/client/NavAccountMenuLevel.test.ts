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

import { NavAccountMenu } from "../../src/client/components/NavAccountMenu";
import type { Progress, UserMeResponse } from "../../src/core/ApiSchemas";

const progress: Progress = {
  prestige: 1,
  level: 23,
  xpInLevel: 250,
  xpForNext: 1000,
  lifetimeXp: 50_000,
  legend: false,
  canPrestige: false,
};

function userMe(opts: {
  progress?: Progress;
  signedIn?: boolean;
}): UserMeResponse {
  return {
    user: opts.signedIn === false ? {} : { email: "player@example.com" },
    player: {
      publicId: "p",
      ...(opts.progress ? { progress: opts.progress } : {}),
    },
  } as unknown as UserMeResponse;
}

describe("nav-account-menu level", () => {
  let el: NavAccountMenu;

  beforeEach(() => {
    if (!customElements.get("nav-account-menu")) {
      customElements.define("nav-account-menu", NavAccountMenu);
    }
  });

  afterEach(() => {
    el?.remove();
  });

  async function mount(
    variant: "desktop" | "mobile",
    response: UserMeResponse | false,
  ): Promise<void> {
    el?.remove();
    el = document.createElement("nav-account-menu") as NavAccountMenu;
    el.variant = variant;
    document.body.appendChild(el);
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: response }),
    );
    await el.updateComplete;
  }

  for (const variant of ["desktop", "mobile"] as const) {
    it(`shows the badge and XP bar on the ${variant} trigger`, async () => {
      await mount(variant, userMe({ progress }));
      const level = el.querySelector("[data-account-level]");
      expect(level).not.toBeNull();
      const badge = level!.querySelector("level-badge") as HTMLElement & {
        level: number;
        prestige: number;
      };
      expect(badge.level).toBe(23);
      expect(badge.prestige).toBe(1);
      const fill = el.querySelector<HTMLElement>(
        "[data-account-xp-bar] [data-xp-bar-fill]",
      );
      expect(fill?.style.width).toBe("25%");
    });
  }

  it("hides everything when /users/@me has no progress", async () => {
    await mount("desktop", userMe({}));
    expect(el.querySelector("[data-account-level]")).toBeNull();
    expect(el.querySelector("[data-account-xp-bar]")).toBeNull();
  });

  it("hides the level for a signed-out session", async () => {
    await mount("desktop", userMe({ progress, signedIn: false }));
    expect(el.querySelector("[data-account-level]")).toBeNull();
    await mount("desktop", false);
    expect(el.querySelector("[data-account-level]")).toBeNull();
  });
});
