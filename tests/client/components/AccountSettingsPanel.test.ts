import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSettingsPanel } from "../../../src/client/components/AccountSettingsPanel";
import type { UserMeResponse } from "../../../src/core/ApiSchemas";

type UserMePlayer = UserMeResponse["player"];
type UserMeUser = UserMeResponse["user"];

// Mock translateText as identity so key assertions are exact, mirroring
// AccountModal.rendering.test.ts.
vi.mock("../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));

vi.mock("../../../src/client/Api", () => ({
  setMarketingConsent: vi.fn(async () => true),
  deleteAccount: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../../src/client/Auth", () => ({
  clearLocalSession: vi.fn(),
  linkGoogle: vi.fn(async () => true),
  sendMagicLink: vi.fn(async () => true),
}));

function makePlayer(overrides: Partial<UserMePlayer> = {}): UserMePlayer {
  return {
    publicId: "test-player",
    adfree: false,
    unlimitedRanked: false,
    canCreatePublicLobbies: false,
    achievements: { singleplayerMap: [] },
    friends: [],
    subscription: null,
    currency: { soft: 100, hard: 10 },
    ...overrides,
  } as UserMePlayer;
}

describe("AccountSettingsPanel — marketing-consent card", () => {
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
    vi.clearAllMocks();
  });

  async function setState(
    player: UserMePlayer,
    user: UserMeUser,
  ): Promise<void> {
    panel.player = player;
    panel.user = user;
    await panel.updateComplete;
  }

  function findSwitch(): HTMLButtonElement | null {
    return panel.querySelector(
      'button[role="switch"]',
    ) as HTMLButtonElement | null;
  }

  // The bug (OPE-397): Steam-primary AND no email hits both suppressions at
  // once, collapsing the card's only control to nothing.
  it("renders the toggle DISABLED, with Steam-specific copy, for a Steam-primary user with no email", async () => {
    await setState(
      makePlayer({
        marketingConsent: { consented: "no_response", hasEmail: false },
      }),
      { steam: { steamId: "1", personaName: "P", avatarUrl: null } },
    );

    const text = panel.textContent ?? "";
    // The description must not instruct a remedy the build doesn't offer.
    expect(text).toContain("account_modal.marketing_no_email_steam");
    // Not the generic "link an email" copy — that instructs a remedy this
    // build doesn't offer to a Steam-primary player. (Its key is a prefix of
    // the Steam-specific one asserted above, so this can't use toContain.)
    expect(text).not.toMatch(/marketing_no_email(?!_steam)/);
    expect(text).not.toContain("account_modal.marketing_desc");

    // The toggle is present (not omitted) and disabled — the row stays
    // visually intact instead of collapsing to text.
    const toggle = findSwitch();
    expect(toggle).toBeTruthy();
    expect(toggle!.disabled).toBe(true);

    // No email-binding fallback either — Steam is primary, no linking UI.
    expect(panel.querySelector("input[type=email]")).toBeNull();
  });

  // Clicking a disabled control should never fire a consent request — belt
  // and braces alongside the `disabled` attribute (setConsent's own guard).
  it("does not call setMarketingConsent when the disabled Steam toggle is clicked", async () => {
    const { setMarketingConsent } = await import("../../../src/client/Api");
    await setState(
      makePlayer({
        marketingConsent: { consented: "no_response", hasEmail: false },
      }),
      { steam: { steamId: "1", personaName: "P", avatarUrl: null } },
    );

    findSwitch()!.click();
    await panel.updateComplete;

    expect(setMarketingConsent).not.toHaveBeenCalled();
  });

  // Unaffected combination: has email → the working, enabled toggle.
  it("renders a working enabled toggle when the account has an email", async () => {
    const { setMarketingConsent } = await import("../../../src/client/Api");
    await setState(
      makePlayer({
        marketingConsent: { consented: "denied", hasEmail: true },
      }),
      { email: "player@example.com" },
    );

    const text = panel.textContent ?? "";
    expect(text).toContain("account_modal.marketing_desc");
    expect(text).not.toContain("account_modal.marketing_no_email");

    const toggle = findSwitch();
    expect(toggle).toBeTruthy();
    expect(toggle!.disabled).toBe(false);

    toggle!.click();
    await panel.updateComplete;
    expect(setMarketingConsent).toHaveBeenCalledWith(true);
  });

  // Unaffected combination: no email, NOT Steam-primary → existing
  // email-binding UI (magic link + Google), toggle stays omitted.
  it("keeps the email-binding UI (no toggle) for a no-email, non-Steam user", async () => {
    await setState(
      makePlayer({
        marketingConsent: { consented: "no_response", hasEmail: false },
      }),
      {
        discord: {
          id: "1",
          avatar: null,
          username: "player",
          global_name: null,
          discriminator: "0",
        },
      },
    );

    const text = panel.textContent ?? "";
    expect(text).toContain("account_modal.marketing_no_email");
    expect(text).not.toContain("account_modal.marketing_no_email_steam");

    // No toggle at all in this branch — unchanged from before OPE-397.
    expect(findSwitch()).toBeNull();
    expect(panel.querySelector("input[type=email]")).toBeTruthy();
  });
});
