import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMeResponse } from "../../src/core/ApiSchemas";

// ─── Mocks ───────────────────────────────────────────────────────────────

const isLoggedInMock = vi.hoisted(() => vi.fn());
const stashPendingLinkMock = vi.hoisted(() => vi.fn());
const fetchSteamLinkTicketMock = vi.hoisted(() => vi.fn());
const redeemSteamLinkMock = vi.hoisted(() => vi.fn());
const getUserMeMock = vi.hoisted(() => vi.fn());
const invalidateUserMeMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/client/Auth", () => ({
  isLoggedIn: isLoggedInMock,
}));

// This is the interface produced by the previous task (SteamLink.ts). Mocking
// it here means this file tests the modal's UI/wiring only — parseSteamLinkToken
// / redeem status-mapping already has its own coverage in SteamLink.test.ts.
vi.mock("../../src/client/SteamLink", () => ({
  stashPendingLink: stashPendingLinkMock,
  fetchSteamLinkTicket: fetchSteamLinkTicketMock,
  redeemSteamLink: redeemSteamLinkMock,
}));

vi.mock("../../src/client/Api", () => ({
  getUserMe: getUserMeMock,
  invalidateUserMe: invalidateUserMeMock,
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  ),
}));

import { SteamLinkModal } from "../../src/client/SteamLinkModal";

function makeUserMe(username: string | null): UserMeResponse {
  return {
    user: {},
    player: {
      publicId: "p1",
      adfree: false,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      achievements: { singleplayerMap: [] },
      friends: [],
      subscription: null,
      username,
    },
  };
}

// A promise whose resolution the test controls, so the "still loading" state
// can be inspected deterministically before letting it settle.
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("SteamLinkModal", () => {
  let modal: SteamLinkModal;

  beforeEach(async () => {
    vi.clearAllMocks();
    history.replaceState(null, "", "/");
    if (!customElements.get("steam-link-modal")) {
      customElements.define("steam-link-modal", SteamLinkModal);
    }
    modal = document.createElement("steam-link-modal") as SteamLinkModal;
    document.body.appendChild(modal);
    await modal.updateComplete;
  });

  afterEach(() => {
    modal.remove();
    history.replaceState(null, "", "/");
  });

  const confirmButton = () =>
    modal.querySelector<HTMLButtonElement>("button.steam-link-confirm-btn");

  it("when not logged in, stashes the token and triggers the login flow instead of confirming", async () => {
    isLoggedInMock.mockResolvedValue(false);

    await modal.openWithToken("tok-abc");
    await modal.updateComplete;

    expect(stashPendingLinkMock).toHaveBeenCalledWith("tok-abc");
    // "Trigger the login flow" = route to the account modal, which shows the
    // login options for a logged-out visitor (see AccountModal).
    expect(window.location.hash).toBe("#modal=account");
    expect(modal.isOpen()).toBe(false);
    expect(fetchSteamLinkTicketMock).not.toHaveBeenCalled();
    expect(getUserMeMock).not.toHaveBeenCalled();
    expect(redeemSteamLinkMock).not.toHaveBeenCalled();
  });

  it("renders both names once loaded, and disables confirm until both have loaded", async () => {
    isLoggedInMock.mockResolvedValue(true);
    const ticket = deferred<{ ok: true; personaName: string | null }>();
    const userMe = deferred<UserMeResponse>();
    fetchSteamLinkTicketMock.mockReturnValue(ticket.promise);
    getUserMeMock.mockReturnValue(userMe.promise);

    await modal.openWithToken("tok-abc");
    await modal.updateComplete;

    expect(modal.isOpen()).toBe(true);
    // Still in flight: nothing to confirm yet, so confirm must be disabled.
    expect(confirmButton()?.disabled).toBe(true);

    ticket.resolve({ ok: true, personaName: "Ada" });
    userMe.resolve(makeUserMe("web.1234"));

    await vi.waitFor(async () => {
      await modal.updateComplete;
      expect(confirmButton()?.disabled).toBe(false);
    });

    // Both names present in the rendered prompt — persona from the ticket
    // endpoint, account name from /users/@me.
    expect(modal.textContent).toContain("Ada");
    expect(modal.textContent).toContain("web.1234");
  });

  it("shows a load-error state with no confirm control when the ticket fetch fails", async () => {
    isLoggedInMock.mockResolvedValue(true);
    fetchSteamLinkTicketMock.mockResolvedValue({ ok: false });
    getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));

    await modal.openWithToken("tok-abc");

    await vi.waitFor(async () => {
      await modal.updateComplete;
      expect(modal.textContent).toContain("steam_link_modal.load_error");
    });
    expect(confirmButton()).toBeNull();
    expect(redeemSteamLinkMock).not.toHaveBeenCalled();
  });

  it("shows a load-error state with no confirm control when /users/@me fails", async () => {
    isLoggedInMock.mockResolvedValue(true);
    fetchSteamLinkTicketMock.mockResolvedValue({
      ok: true,
      personaName: "Ada",
    });
    getUserMeMock.mockResolvedValue(false);

    await modal.openWithToken("tok-abc");

    await vi.waitFor(async () => {
      await modal.updateComplete;
      expect(modal.textContent).toContain("steam_link_modal.load_error");
    });
    expect(confirmButton()).toBeNull();
  });

  it("renders a specific message per refusal reason rather than a generic failure", async () => {
    isLoggedInMock.mockResolvedValue(true);
    fetchSteamLinkTicketMock.mockResolvedValue({
      ok: true,
      personaName: "Ada",
    });
    getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));
    redeemSteamLinkMock.mockResolvedValue({
      ok: false,
      reason: "steam_has_progress",
    });

    await modal.openWithToken("tok-abc");
    await vi.waitFor(async () => {
      await modal.updateComplete;
      expect(confirmButton()?.disabled).toBe(false);
    });

    confirmButton()?.click();

    await vi.waitFor(async () => {
      await modal.updateComplete;
      expect(modal.textContent).toContain(
        "steam_link_modal.reason_steam_has_progress",
      );
    });
    // Not the generic bucket — a specific reason was rendered instead.
    expect(modal.textContent).not.toContain("steam_link_modal.reason_failed");
  });

  it("falls back to a generic message for an unrecognised refusal reason", async () => {
    isLoggedInMock.mockResolvedValue(true);
    fetchSteamLinkTicketMock.mockResolvedValue({
      ok: true,
      personaName: "Ada",
    });
    getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));
    redeemSteamLinkMock.mockResolvedValue({ ok: false, reason: "failed" });

    await modal.openWithToken("tok-abc");
    await vi.waitFor(async () => {
      await modal.updateComplete;
      expect(confirmButton()?.disabled).toBe(false);
    });

    confirmButton()?.click();

    await vi.waitFor(async () => {
      await modal.updateComplete;
      expect(modal.textContent).toContain("steam_link_modal.reason_failed");
    });
  });

  it("redeems on confirm and shows success, invalidating the cached /users/@me", async () => {
    isLoggedInMock.mockResolvedValue(true);
    fetchSteamLinkTicketMock.mockResolvedValue({
      ok: true,
      personaName: "Ada",
    });
    getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));
    redeemSteamLinkMock.mockResolvedValue({ ok: true });

    await modal.openWithToken("tok-abc");
    await vi.waitFor(async () => {
      await modal.updateComplete;
      expect(confirmButton()?.disabled).toBe(false);
    });

    confirmButton()?.click();

    await vi.waitFor(async () => {
      await modal.updateComplete;
      expect(modal.textContent).toContain("steam_link_modal.success");
    });
    expect(redeemSteamLinkMock).toHaveBeenCalledWith("tok-abc");
    expect(invalidateUserMeMock).toHaveBeenCalled();
  });
});
