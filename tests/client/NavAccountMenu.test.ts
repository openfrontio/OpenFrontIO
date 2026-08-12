import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logOut, isOnCrazyGames, showInGameConfirm } = vi.hoisted(() => ({
  logOut: vi.fn(async () => {}),
  isOnCrazyGames: vi.fn(() => false),
  showInGameConfirm: vi.fn(async () => true),
}));
vi.mock("../../src/client/Auth", () => ({ logOut }));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: { isOnCrazyGames },
}));
vi.mock("../../src/client/InGameModal", () => ({ showInGameConfirm }));
vi.mock("../../src/client/Navigation", () => ({
  closeMobileSidebar: vi.fn(),
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

import { NavAccountMenu } from "../../src/client/components/NavAccountMenu";
import { updateAccountNavButton } from "../../src/client/NavAccountButton";
import type { UserMeResponse } from "../../src/core/ApiSchemas";

function userMe(subscribed = false): UserMeResponse {
  return {
    user: { email: "player@example.com" },
    player: {
      publicId: "p",
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

  it("shows no chevron and does not open a menu while signed out", async () => {
    fireUserMe(false);
    await el.updateComplete;
    expect(trigger().querySelector("svg.rotate-180")).toBeNull();
    await click(trigger());
    // Signed out the click must fall through to the data-page router instead.
    expect(menu()).toBeNull();
    expect(trigger().getAttribute("data-page")).toBe("page-account");
  });

  it("stays off for an anonymous session with no linked identity", async () => {
    // /users/@me resolves for guests too, so a bare response must not count as
    // signed in — that's what put the chevron on the signed-out pill.
    fireUserMe({
      user: {},
      player: { publicId: "p" },
    } as unknown as UserMeResponse);
    await el.updateComplete;
    await click(trigger());
    expect(menu()).toBeNull();
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

  it("stays off on CrazyGames, which owns its own account UI", async () => {
    isOnCrazyGames.mockReturnValue(true);
    fireUserMe(userMe());
    await el.updateComplete;
    await click(trigger());
    expect(menu()).toBeNull();
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
