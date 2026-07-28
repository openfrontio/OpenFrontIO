import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMeResponse } from "../../src/core/ApiSchemas";

// ─── Mocks (mirrors tests/client/clan/ClanModalTestUtils.ts factories) ──────

vi.mock("../../src/client/Api", () => ({
  getUserMe: vi.fn(async () => false as const),
  invalidateUserMe: vi.fn(),
  fetchPlayerById: vi.fn(async () => null),
  setMarketingConsent: vi.fn(async () => true),
  getApiBase: vi.fn(() => ""),
}));

vi.mock("../../src/client/Auth", () => ({
  discordLogin: vi.fn(),
  googleLogin: vi.fn(),
  linkGoogle: vi.fn(async () => true),
  logOut: vi.fn(async () => true),
  reauthAfterCrazyGamesChange: vi.fn(async () => false),
  sendMagicLink: vi.fn(async () => true),
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  showToast: vi.fn(),
  getDiscordAvatarUrl: vi.fn(() => null),
  copyToClipboard: vi.fn(),
  renderNumber: vi.fn((n: number) => String(n)),
  getMapName: vi.fn((m: string) => m),
  renderDuration: vi.fn(() => ""),
}));

vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: vi.fn(() => false),
    getUserProfile: vi.fn(async () => null),
    showAuthPrompt: vi.fn(async () => null),
    isAvailable: false,
  },
}));

vi.mock("../../src/client/Cosmetics", () => ({
  fetchCosmetics: vi.fn(async () => null),
  translateCosmetic: vi.fn((v: unknown) => v),
}));

vi.stubGlobal("localStorage", {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
});

import { AccountModal } from "../../src/client/AccountModal";

function makeUserMe(
  overrides: Partial<UserMeResponse["user"]>,
): UserMeResponse {
  return {
    user: { ...overrides },
    player: {
      publicId: "test-player",
      adfree: false,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      achievements: { singleplayerMap: [] },
      friends: [],
      subscription: null,
      currency: { soft: 100, hard: 10 },
    },
  };
}

describe("AccountModal — rendering", () => {
  let modal: AccountModal;

  beforeEach(async () => {
    if (!customElements.get("account-modal")) {
      customElements.define("account-modal", AccountModal);
    }
    modal = document.createElement("account-modal") as AccountModal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
    await modal.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(modal);
    vi.clearAllMocks();
  });

  // Directly install a resolved userMeResponse and flip off the loading state,
  // bypassing onOpen()'s network calls — this mirrors ClanModalTestUtils'
  // setState() helper, but userMeResponse is a plain private field (not a Lit
  // @state), so we force a render manually afterward.
  async function setLoggedInUser(userMe: UserMeResponse): Promise<void> {
    (
      modal as unknown as { userMeResponse: UserMeResponse | null }
    ).userMeResponse = userMe;
    (modal as unknown as { isLoadingUser: boolean }).isLoadingUser = false;
    modal.requestUpdate();
    await modal.updateComplete;
  }

  it("shows the Steam account (no link/login CTAs) for a Steam-primary user", async () => {
    const userMe = makeUserMe({
      steam: {
        steamId: "76561198000000001",
        personaName: "SnugglePuppy",
        avatarUrl: "https://cdn/x.jpg",
      },
    });
    await setLoggedInUser(userMe);

    // Logged-in Account tab is rendered (not the login-options screen).
    const steamHeader = modal.querySelector("steam-user-header");
    expect(steamHeader).toBeTruthy();

    // No login CTAs (Discord/Google login buttons, email field) — those only
    // render on the logged-out `renderLoginOptions()` screen.
    const text = modal.textContent ?? "";
    expect(text).not.toContain("main.login_discord");
    expect(text).not.toContain("main.login_google");

    // No Google-link CTA either — Steam is primary in v1, no linking UI.
    expect(text).not.toContain("account_modal.link_google");

    // Currency + logout ARE rendered for the Steam branch of renderLoggedInAs().
    expect(modal.querySelector("currency-display")).toBeTruthy();
    expect(text).toContain("account_modal.log_out");
  });
});
