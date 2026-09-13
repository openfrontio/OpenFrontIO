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
  linkSteam: vi.fn(async () => true),
  steamLogin: vi.fn(),
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
import {
  discordLogin,
  googleLogin,
  linkGoogle,
  linkSteam,
} from "../../src/client/Auth";

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
    delete (window as { openfrontDesktop?: unknown }).openfrontDesktop;
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

    // Currency IS rendered for the Steam branch of renderLoggedInAs(); logging
    // out moved to the nav profile menu, so no log-out control here.
    expect(modal.querySelector("currency-display")).toBeTruthy();
    expect(text).not.toContain("nav_account_menu.log_out");
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
    // Logging out lives in the nav profile menu now.
    expect(text).not.toContain("nav_account_menu.log_out");
  });

  // Desktop re-entry to the account-linking gate. The Electron preload exposes
  // `window.openfrontDesktop.showLinkGate()` for exactly this purpose; it is
  // absent entirely on plain web, which is the signal the action guards on.
  describe("desktop link-gate action", () => {
    function findLinkGateButton(): HTMLButtonElement | undefined {
      return Array.from(modal.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("account_modal.link_existing_account"),
      );
    }

    it("renders and calls showLinkGate() when the desktop bridge is present", async () => {
      const showLinkGate = vi.fn(async () => undefined);
      (window as unknown as { openfrontDesktop: unknown }).openfrontDesktop = {
        showLinkGate,
      };

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

      const button = findLinkGateButton();
      expect(button).toBeTruthy();

      button!.click();
      expect(showLinkGate).toHaveBeenCalledTimes(1);
    });

    it("does not render when the desktop bridge is absent (plain web)", async () => {
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

      expect(findLinkGateButton()).toBeUndefined();
    });

    // Pins the resolved ambiguity from the plan: guard on the function we
    // actually call, not a sibling property. A bridge exposing `linkGate` but
    // no callable `showLinkGate` must not render a dead button.
    it("does not render when the bridge exists but showLinkGate is not a function", async () => {
      (window as unknown as { openfrontDesktop: unknown }).openfrontDesktop = {
        linkGate: { open: vi.fn() },
      };

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

      expect(findLinkGateButton()).toBeUndefined();
    });
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

  // OPE-343. On the desktop shell the provider buttons cannot run an OAuth
  // redirect (the redirect_uri would be app://openfront), so Auth.ts routes
  // them through the shell's browser link flow -- and the captions must say
  // so, keyed on the same bridge check Auth.ts routes on. On the web the
  // login screen is untouched.
  describe("desktop login screen", () => {
    function findButtonByText(key: string): HTMLButtonElement | undefined {
      return Array.from(modal.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === key,
      );
    }

    it("captions the provider buttons as continuing in the browser when the bridge is present", async () => {
      (window as unknown as { openfrontDesktop: unknown }).openfrontDesktop = {
        showLinkGate: vi.fn(async () => undefined),
      };
      modal.open();
      await flushOpen();

      const text = modal.textContent ?? "";
      expect(text).toContain("account_modal.desktop_login_discord");
      expect(text).toContain("account_modal.desktop_login_google");
      expect(text).toContain("account_modal.desktop_sign_in_desc");
      expect(text).not.toContain("main.login_discord");
      expect(text).not.toContain("main.login_google");

      // Still the same handlers: the routing lives in Auth.ts, not here.
      findButtonByText("account_modal.desktop_login_discord")!.click();
      expect(discordLogin).toHaveBeenCalledTimes(1);
      findButtonByText("account_modal.desktop_login_google")!.click();
      expect(googleLogin).toHaveBeenCalledTimes(1);
    });

    it("keeps the web captions on plain web", async () => {
      modal.open();
      await flushOpen();

      const text = modal.textContent ?? "";
      expect(text).toContain("main.login_discord");
      expect(text).toContain("main.login_google");
      expect(text).not.toContain("account_modal.desktop_login_discord");
      expect(text).not.toContain("account_modal.desktop_sign_in_desc");
    });

    // Label and behaviour must agree: Auth.ts never builds the web redirect
    // on any desktop shell (an older shell without showLinkGate gets an
    // update prompt), so the web caption is wrong on every shell, bridge or
    // not.
    it("keeps the browser captions when the bridge lacks showLinkGate", async () => {
      (window as unknown as { openfrontDesktop: unknown }).openfrontDesktop = {
        linkGate: {},
      };
      modal.open();
      await flushOpen();

      const text = modal.textContent ?? "";
      expect(text).toContain("account_modal.desktop_login_discord");
      expect(text).not.toContain("main.login_discord");
    });

    // The Google LINK button (a signed-in Discord/email account attaching
    // Google) goes to the website on desktop -- see linkGoogle in Auth.ts --
    // and its caption says so. Matched on the whole caption, since the web
    // key is a prefix of the desktop one.
    it("captions the Google link button as opening the website on desktop", async () => {
      (window as unknown as { openfrontDesktop: unknown }).openfrontDesktop = {
        showLinkGate: vi.fn(async () => undefined),
      };
      await setLoggedInUser(
        makeUserMe({
          discord: {
            id: "1",
            avatar: null,
            username: "player",
            global_name: null,
            discriminator: "0",
          },
        }),
      );

      expect(findButtonByText("account_modal.link_google_on_web")).toBeTruthy();
      expect(findButtonByText("account_modal.link_google")).toBeUndefined();

      findButtonByText("account_modal.link_google_on_web")!.click();
      expect(linkGoogle).toHaveBeenCalledTimes(1);
    });
  });

  // OPE-115. The Steam link is PERMANENT: Steam recommends that users cannot
  // self-unlink Steam from an external account, so there is no unlink control
  // and the warning has to be readable before the click. Both halves are
  // asserted because a regression in either is invisible in review and
  // irreversible for the player who hits it.
  it("offers a Steam link with the permanence warning to a Discord user", async () => {
    await setLoggedInUser(
      makeUserMe({
        discord: {
          id: "1",
          avatar: null,
          username: "player",
          global_name: null,
          discriminator: "0",
        },
      }),
    );

    const text = modal.textContent ?? "";
    expect(text).toContain("account_modal.link_steam");
    // The warning, before the click — afterwards the link already exists.
    expect(text).toContain("account_modal.link_steam_permanent");
  });

  it("shows the linked Steam account and NO unlink control", async () => {
    await setLoggedInUser(
      makeUserMe({
        discord: {
          id: "1",
          avatar: null,
          username: "player",
          global_name: null,
          discriminator: "0",
        },
        steam: {
          steamId: "76561198000000001",
          personaName: "SnugglePuppy",
          avatarUrl: "https://cdn/x.jpg",
        },
      }),
    );

    const text = modal.textContent ?? "";
    // The linked state, not the CTA.
    expect(text).toContain("account_modal.linked_to_steam");
    // The attached account is NAMED, not just reported as linked: a wrong link
    // cannot be undone by the player, so noticing it immediately is what makes
    // a support fix possible.
    //
    // querySelectorAll with a length, NOT querySelector: the singular form is
    // true for one header OR two, which is exactly how a duplicate render got
    // past this test. renderAccountTab already renders the header for every
    // branch, so the Steam row must not render its own.
    expect(modal.querySelectorAll("steam-user-header")).toHaveLength(1);
    // The explanation for why there is no unlink button stays visible.
    expect(text).toContain("account_modal.link_steam_permanent");
    // There is no unlink affordance anywhere, by key or by label.
    expect(text).not.toContain("unlink");
    expect(text).not.toContain("Unlink");
  });

  it("starts the Steam link when the button is clicked", async () => {
    await setLoggedInUser(
      makeUserMe({
        discord: {
          id: "1",
          avatar: null,
          username: "player",
          global_name: null,
          discriminator: "0",
        },
      }),
    );

    const button = Array.from(modal.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("account_modal.link_steam"),
    );
    expect(button).toBeTruthy();
    button!.click();
    await modal.updateComplete;

    expect(linkSteam).toHaveBeenCalledTimes(1);
  });

  it("offers no Steam sign-in or link inside the desktop shell", async () => {
    // A shell player already holds the Steam identity through the native
    // ticket, so both surfaces would be no-ops that look like options.
    (window as unknown as { openfrontDesktop: unknown }).openfrontDesktop = {};
    await setLoggedInUser(
      makeUserMe({
        discord: {
          id: "1",
          avatar: null,
          username: "player",
          global_name: null,
          discriminator: "0",
        },
      }),
    );

    const text = modal.textContent ?? "";
    expect(text).not.toContain("account_modal.link_steam");
    expect(text).not.toContain("main.login_steam");
  });

  // Pins main.login_steam POSITIVELY. The desktop-shell test above asserts its
  // absence against a translation-key literal, which decays into a no-op if
  // the key is ever renamed; this one breaks loudly instead.
  it("offers Sign in with Steam on the logged-out web login screen", async () => {
    (modal as unknown as { userMeResponse: unknown }).userMeResponse = null;
    (modal as unknown as { isLoadingUser: boolean }).isLoadingUser = false;
    modal.requestUpdate();
    await modal.updateComplete;

    const text = modal.textContent ?? "";
    expect(text).toContain("main.login_steam");
    expect(text).toContain("main.login_discord");
  });

  // Web sign-in never creates an account, so this is an ordinary outcome and
  // the message has to name the two routes that do work.
  it("explains that no account uses this Steam account yet", async () => {
    (modal as unknown as { userMeResponse: unknown }).userMeResponse = null;
    (modal as unknown as { isLoadingUser: boolean }).isLoadingUser = false;
    (modal as unknown as { loginError: string }).loginError = "no_account";
    modal.requestUpdate();
    await modal.updateComplete;

    const text = modal.textContent ?? "";
    expect(text).toContain("account_modal.login_no_account");
    expect(text).not.toContain("account_modal.login_email_exists");
  });
});
