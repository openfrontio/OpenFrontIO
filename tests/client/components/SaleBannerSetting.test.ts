import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { Promotion } from "@openfront/shared/CosmeticSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSettingsPanel } from "../../../src/client/components/AccountSettingsPanel";
import {
  bannerSales,
  visibleBannerSales,
} from "../../../src/client/components/SaleBanner";
import { UserSettings } from "../../../src/client/UserSettings";

type UserMeUser = UserMeResponse["user"];

vi.mock("../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));

vi.mock("../../../src/client/Api", () => ({
  setMarketingConsent: vi.fn(async () => true),
  deleteAccount: vi.fn(async () => ({ ok: true })),
  getIdentityTokenAudiences: vi.fn(async () => []),
  setLevelVisibility: vi.fn(async (hidden: boolean) => ({ ok: true, hidden })),
  setSearchVisibility: vi.fn(async (hidden: boolean) => ({ ok: true, hidden })),
  getUserMe: vi.fn(async () => false),
}));

vi.mock("../../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => {}),
}));

vi.mock("../../../src/client/Auth", () => ({
  clearLocalSession: vi.fn(),
  linkGoogle: vi.fn(async () => true),
  sendMagicLink: vi.fn(async () => true),
}));

const STEAM_ONLY: UserMeUser = {
  steam: { steamId: "1", personaName: "P", avatarUrl: null },
};
const STEAM_AND_DISCORD = {
  ...STEAM_ONLY,
  discord: { id: "2", username: "d", global_name: null, avatar: null },
} as UserMeUser;
const DISCORD_ONLY = {
  discord: { id: "2", username: "d", global_name: null, avatar: null },
} as UserMeUser;

function sale(id: string, kind: "flash" | "sale"): Promotion {
  return {
    id,
    kind,
    name: id,
    percentOff: 20,
    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
  } as Promotion;
}

const FLASH = sale("flash-1", "flash");
const STORE_WIDE = sale("sale-1", "sale");

function signIn(user: UserMeUser): void {
  document.dispatchEvent(
    new CustomEvent("userMeResponse", {
      detail: { user, player: { publicId: "p1" } } as UserMeResponse,
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  new UserSettings().removeCached("settings.hideSaleBanners");
});

describe("bannerSales", () => {
  it("drops every sale, flash or not, for a Steam-only player who turned them off", () => {
    expect(bannerSales([STORE_WIDE, FLASH], STEAM_ONLY, true)).toEqual([]);
    expect(bannerSales([STORE_WIDE], STEAM_ONLY, true)).toEqual([]);
    expect(bannerSales([FLASH], STEAM_ONLY, true)).toEqual([]);
  });

  it("keeps every sale while the setting is off", () => {
    expect(bannerSales([STORE_WIDE, FLASH], STEAM_ONLY, false)).toEqual([
      STORE_WIDE,
      FLASH,
    ]);
  });

  it("ignores the setting once another account is linked", () => {
    expect(bannerSales([STORE_WIDE, FLASH], STEAM_AND_DISCORD, true)).toEqual([
      STORE_WIDE,
      FLASH,
    ]);
    expect(bannerSales([STORE_WIDE, FLASH], DISCORD_ONLY, true)).toEqual([
      STORE_WIDE,
      FLASH,
    ]);
  });

  it("ignores the setting when signed out", () => {
    expect(bannerSales([STORE_WIDE, FLASH], undefined, true)).toEqual([
      STORE_WIDE,
      FLASH,
    ]);
  });
});

describe("visibleBannerSales", () => {
  it("reads the signed-in player and their saved setting", () => {
    signIn(STEAM_ONLY);
    expect(visibleBannerSales([STORE_WIDE, FLASH])).toEqual([
      STORE_WIDE,
      FLASH,
    ]);
    new UserSettings().setHideSaleBanners(true);
    expect(visibleBannerSales([STORE_WIDE, FLASH])).toEqual([]);
  });
});

describe("AccountSettingsPanel — store card", () => {
  let panel: AccountSettingsPanel;

  beforeEach(async () => {
    if (!customElements.get("account-settings-panel")) {
      customElements.define("account-settings-panel", AccountSettingsPanel);
    }
    panel = document.createElement(
      "account-settings-panel",
    ) as AccountSettingsPanel;
    document.body.appendChild(panel);
    await panel.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(panel);
  });

  async function setUser(user: UserMeUser): Promise<void> {
    panel.user = user;
    await panel.updateComplete;
  }

  function bannerSwitch(): HTMLButtonElement | null {
    return panel.querySelector(
      '[data-store-settings] button[role="switch"]',
    ) as HTMLButtonElement | null;
  }

  it("shows the sale banners switch, on by default, to a Steam-only player", async () => {
    await setUser(STEAM_ONLY);
    expect(panel.textContent).toContain("account_modal.sale_banners_title");
    expect(bannerSwitch()?.getAttribute("aria-checked")).toBe("true");
  });

  it("isn't offered to anyone else", async () => {
    await setUser(STEAM_AND_DISCORD);
    expect(panel.querySelector("[data-store-settings]")).toBeNull();
    await setUser(DISCORD_ONLY);
    expect(panel.querySelector("[data-store-settings]")).toBeNull();
  });

  it("turning it off saves the setting, and on again clears it", async () => {
    await setUser(STEAM_ONLY);
    bannerSwitch()!.click();
    await panel.updateComplete;
    expect(new UserSettings().hideSaleBanners()).toBe(true);
    expect(bannerSwitch()?.getAttribute("aria-checked")).toBe("false");

    bannerSwitch()!.click();
    await panel.updateComplete;
    expect(new UserSettings().hideSaleBanners()).toBe(false);
    expect(bannerSwitch()?.getAttribute("aria-checked")).toBe("true");
  });

  it("shows a saved choice as off", async () => {
    new UserSettings().setHideSaleBanners(true);
    await setUser(STEAM_ONLY);
    expect(bannerSwitch()?.getAttribute("aria-checked")).toBe("false");
  });
});
