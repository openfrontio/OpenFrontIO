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

  // onOpen kicks off getUserMe(); let the microtasks settle before asserting on
  // the rendered output.
  async function flushOpen(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
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

  // The complement of the test above, and it earns its keep twice over:
  //
  // 1. It covers the direction the isSteamPrimary() primacy fix was about —
  //    a non-Steam user must keep their account-linking UI.
  // 2. It pins `account_modal.link_google` *positively*. The assertions above
  //    are negative checks against translation-key literals, which silently
  //    decay into no-ops if a key is ever renamed. Asserting the same key is
  //    present here means a rename breaks this test loudly instead.
  it("keeps the Google-link CTA for a Discord user (unaffected by the Steam branch)", async () => {
    const userMe = makeUserMe({
      discord: {
        id: "1",
        avatar: null,
        username: "player",
        global_name: null,
        discriminator: "0",
      },
    });
    await setLoggedInUser(userMe);

    const text = modal.textContent ?? "";

    // Discord takes the first branch of renderLoggedInAs() — no Steam header.
    expect(modal.querySelector("steam-user-header")).toBeNull();

    // The linking CTA a Steam-primary user does NOT get.
    expect(text).toContain("account_modal.link_google");

    // Still a logged-in view, not the login-options screen.
    expect(modal.querySelector("currency-display")).toBeTruthy();
    expect(text).toContain("account_modal.log_out");
  });
  // The duplicate-account rejection: the auth callback bounced us back with
  // `login=email_exists` rather than creating a second account, and the user
  // needs to be told why nothing happened and what to do instead.
  it("shows the duplicate-account error after a rejected sign-in", async () => {
    modal.open({ login: "email_exists" });
    await flushOpen();

    // Logged out, so the login options screen is what renders.
    const text = modal.textContent ?? "";
    expect(text).toContain("main.login_google");
    expect(text).toContain("account_modal.login_email_exists");
  });

  it("shows no login error on an ordinary open", async () => {
    modal.open();
    await flushOpen();

    const text = modal.textContent ?? "";
    expect(text).toContain("main.login_google");
    expect(text).not.toContain("account_modal.login_email_exists");
  });

  it("drops the error when the modal is reopened", async () => {
    modal.open({ login: "email_exists" });
    await flushOpen();
    expect(modal.textContent ?? "").toContain(
      "account_modal.login_email_exists",
    );

    modal.close();
    modal.open();
    await flushOpen();

    expect(modal.textContent ?? "").not.toContain(
      "account_modal.login_email_exists",
    );
  });
});
