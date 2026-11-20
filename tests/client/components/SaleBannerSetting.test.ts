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

const DISCORD_USER = {
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

// The Steam app's preload exposes `openfrontDesktop.steam`; the web, Android
// and portals don't (DesktopShell.isSteamShell).
function inSteamApp(on: boolean): void {
  (window as { openfrontDesktop?: unknown }).openfrontDesktop = on
    ? { steam: {} }
    : undefined;
}

beforeEach(() => {
  localStorage.clear();
  new UserSettings().removeCached("settings.hideSaleBanners");
  inSteamApp(false);
});

afterEach(() => {
  inSteamApp(false);
});

describe("bannerSales", () => {
  it("drops every sale, flash or not, in the Steam app with banners off", () => {
    expect(bannerSales([STORE_WIDE, FLASH], true, true)).toEqual([]);
  });

  it("keeps every sale in the Steam app while banners are on", () => {
    expect(bannerSales([STORE_WIDE, FLASH], true, false)).toEqual([
      STORE_WIDE,
      FLASH,
    ]);
  });

  it("ignores the setting outside the Steam app", () => {
    expect(bannerSales([STORE_WIDE, FLASH], false, true)).toEqual([
      STORE_WIDE,
      FLASH,
    ]);
  });
});

describe("visibleBannerSales", () => {
  it("hides the banners in the Steam app once they're turned off", () => {
    inSteamApp(true);
    expect(visibleBannerSales([STORE_WIDE, FLASH])).toEqual([
      STORE_WIDE,
      FLASH,
    ]);
    new UserSettings().setHideSaleBanners(true);
    expect(visibleBannerSales([STORE_WIDE, FLASH])).toEqual([]);
  });

  it("shows them outside the Steam app even with the setting saved", () => {
    new UserSettings().setHideSaleBanners(true);
    expect(visibleBannerSales([STORE_WIDE, FLASH])).toEqual([
      STORE_WIDE,
      FLASH,
    ]);
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
    panel.user = DISCORD_USER;
    document.body.appendChild(panel);
    await panel.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(panel);
  });

  async function rerender(): Promise<void> {
    panel.requestUpdate();
    await panel.updateComplete;
  }

  function bannerSwitch(): HTMLButtonElement | null {
    return panel.querySelector(
      '[data-store-settings] button[role="switch"]',
    ) as HTMLButtonElement | null;
  }

  it("shows the sale banners switch, on by default, in the Steam app", async () => {
    inSteamApp(true);
    await rerender();
    expect(panel.textContent).toContain("account_modal.sale_banners_title");
    expect(bannerSwitch()?.getAttribute("aria-checked")).toBe("true");
  });

  it("doesn't exist outside the Steam app", async () => {
    await rerender();
    expect(panel.querySelector("[data-store-settings]")).toBeNull();
  });

  it("turning it off saves the setting, and on again clears it", async () => {
    inSteamApp(true);
    await rerender();
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
    inSteamApp(true);
    new UserSettings().setHideSaleBanners(true);
    await rerender();
    expect(bannerSwitch()?.getAttribute("aria-checked")).toBe("false");
  });
});
