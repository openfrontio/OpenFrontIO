import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  logOut,
  isOnCrazyGames,
  showInGameConfirm,
  copyToClipboard,
  showToast,
  getUserProfile,
  showAuthPrompt,
} = vi.hoisted(() => ({
  getUserProfile: vi.fn(async () => null as { username: string } | null),
  showAuthPrompt: vi.fn(async () => null),
  logOut: vi.fn(async () => {}),
  isOnCrazyGames: vi.fn(() => false),
  showInGameConfirm: vi.fn(async () => true),
  copyToClipboard: vi.fn(async (_text: string) => {}),
  showToast: vi.fn(),
}));
vi.mock("../../src/client/Auth", () => ({ logOut }));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: { isOnCrazyGames, getUserProfile, showAuthPrompt },
}));
vi.mock("../../src/client/InGameModal", () => ({ showInGameConfirm }));
vi.mock("../../src/client/Navigation", () => ({
  closeMobileSidebar: vi.fn(),
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  copyToClipboard,
  showToast,
}));

import { NavAccountMenu } from "../../src/client/components/NavAccountMenu";
import { updateAccountNavButton } from "../../src/client/NavAccountButton";
import type { UserMeResponse } from "../../src/core/ApiSchemas";

function userMe(subscribed = false, publicId = "p"): UserMeResponse {
  return {
    user: { email: "player@example.com" },
    player: {
      publicId,
      ...(subscribed ? { subscription: { tier: "plutonium" } } : {}),
    },
  } as unknown as UserMeResponse;
}

function fireUserMe(detail: UserMeResponse | false) {
  document.dispatchEvent(new CustomEvent("userMeResponse", { detail }));
}

describe("nav-account-menu", () => {
  let el: NavAccountMenu;

  beforeEach(async () => {
    // The @customElement decorator's define() side-effect doesn't run under the
    // test transform, so register the element explicitly.
    if (!customElements.get("nav-account-menu")) {
      customElements.define("nav-account-menu", NavAccountMenu);
    }
    el = document.createElement("nav-account-menu") as NavAccountMenu;
    document.body.appendChild(el);
    await el.updateComplete;
  });

  afterEach(() => {
    el.remove();
    vi.clearAllMocks();
    isOnCrazyGames.mockReturnValue(false);
    getUserProfile.mockResolvedValue(null);
    window.showPage = undefined;
  });

  const trigger = () =>
    el.querySelector<HTMLButtonElement>("[data-account-trigger]")!;
  // The panel is portalled to document.body (see NavAccountMenu.updated).
  const menu = () => document.querySelector('[role="menu"]');
  const itemKeys = () =>
    Array.from(document.querySelectorAll("[data-menu-item]")).map((n) =>
      n.getAttribute("data-menu-item"),
    );

  async function click(node: Element) {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await el.updateComplete;
  }

  it("offers sign-in and settings while signed out", async () => {
    // The menu is the only nav route to the settings page now, so it has to
    // open for guests too.
    fireUserMe(false);
    await el.updateComplete;
    await click(trigger());
    expect(itemKeys()).toEqual(["sign-in", "game-settings"]);

    const showPage = vi.fn();
    window.showPage = showPage;
    await click(document.querySelector('[data-menu-item="sign-in"]')!);
    expect(showPage).toHaveBeenCalledWith("page-account");
  });

  it("treats an anonymous session as signed out", async () => {
    // /users/@me resolves for guests too, so a bare response is not a login.
    fireUserMe({
      user: {},
      player: { publicId: "p" },
    } as unknown as UserMeResponse);
    await el.updateComplete;
    await click(trigger());
    expect(itemKeys()).toEqual(["sign-in", "game-settings"]);
  });

  it("toggles the menu for a signed-in user", async () => {
    fireUserMe(userMe());
    await el.updateComplete;
    await click(trigger());
    expect(menu()).not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    await click(trigger());
    expect(menu()).toBeNull();
  });

  it("offers the subscription item only to subscribers", async () => {
    fireUserMe(userMe());
    await el.updateComplete;
    await click(trigger());
    expect(itemKeys()).toEqual([
      "copy-profile-url",
      "view-account",
      "account-settings",
      "game-settings",
      "change-username",
      "log-out",
    ]);

    // The menu stays open across the refresh, so it re-renders with the extra
    // item as soon as the subscription appears on the session.
    fireUserMe(userMe(true));
    await el.updateComplete;
    expect(itemKeys()).toContain("subscription");
  });

  it("copies the profile URL and toasts, and hides without a publicId", async () => {
    fireUserMe(userMe());
    await el.updateComplete;
    await click(trigger());
    await click(document.querySelector('[data-menu-item="copy-profile-url"]')!);
    await new Promise((r) => setTimeout(r, 0));

    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect(vi.mocked(copyToClipboard).mock.calls[0][0]).toContain(
      "modal=profile&publicID=p",
    );
    expect(showToast).toHaveBeenCalledWith("common.copied", "green");

    // No publicId (older backend / unresolved player) — nothing to share.
    fireUserMe(userMe(false, ""));
    await el.updateComplete;
    await click(trigger());
    expect(itemKeys()).not.toContain("copy-profile-url");
  });

  it("keeps the menu on CrazyGames, minus the log-out they own", async () => {
    isOnCrazyGames.mockReturnValue(true);
    getUserProfile.mockResolvedValue({ username: "cg-player" });
    fireUserMe(userMe());
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    await click(trigger());

    // Their username/subscription management still needs reaching…
    expect(itemKeys()).toContain("change-username");
    // …but signing out happens on CrazyGames, not through /auth/logout.
    expect(itemKeys()).not.toContain("log-out");
  });

  it("hands CrazyGames guests to the SDK sign-in prompt", async () => {
    isOnCrazyGames.mockReturnValue(true);
    fireUserMe(false);
    await el.updateComplete;
    await click(trigger());
    await click(document.querySelector('[data-menu-item="sign-in"]')!);
    expect(showAuthPrompt).toHaveBeenCalledTimes(1);
  });

  it("logs out only after the confirmation is accepted", async () => {
    fireUserMe(userMe());
    await el.updateComplete;
    await click(trigger());

    showInGameConfirm.mockResolvedValueOnce(false);
    await click(document.querySelector('[data-menu-item="log-out"]')!);
    await new Promise((r) => setTimeout(r, 0));
    expect(logOut).not.toHaveBeenCalled();

    await click(trigger());
    await click(document.querySelector('[data-menu-item="log-out"]')!);
    await new Promise((r) => setTimeout(r, 0));
    expect(logOut).toHaveBeenCalledTimes(1);
  });

  it("seeds itself from the cached auth state when created late", async () => {
    // Auth resolves once, early. A menu mounted afterwards never sees the
    // userMeResponse event, so it has to read the cached response instead.
    updateAccountNavButton(userMe());

    const late = document.createElement("nav-account-menu") as NavAccountMenu;
    document.body.appendChild(late);
    await late.updateComplete;
    await late.updateComplete;

    late
      .querySelector("[data-account-trigger]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await late.updateComplete;
    expect(menu()).not.toBeNull();
    late.remove();
  });

  it("portals the panel to the body and takes it down again", async () => {
    // Rendered inside the nav it would inherit the nav's stacking context —
    // which put it under open modals, and the nav over the toasts.
    fireUserMe(userMe());
    await el.updateComplete;
    await click(trigger());

    const panel = menu()!;
    expect(panel).not.toBeNull();
    expect(el.contains(panel)).toBe(false);
    expect(panel.closest("body")).not.toBeNull();

    await click(trigger());
    expect(menu()).toBeNull();
  });

  it("closes when a click lands outside the menu", async () => {
    fireUserMe(userMe());
    await el.updateComplete;
    await click(trigger());
    expect(menu()).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await el.updateComplete;
    expect(menu()).toBeNull();
  });
});
