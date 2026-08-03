import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMeResponse } from "../../src/core/ApiSchemas";

// ─── Mocks ───────────────────────────────────────────────────────────────

const isLoggedInMock = vi.hoisted(() => vi.fn());
const stashPendingLinkMock = vi.hoisted(() => vi.fn());
const stashPendingCodeEntryMock = vi.hoisted(() => vi.fn());
const fetchSteamLinkTicketMock = vi.hoisted(() => vi.fn());
const redeemSteamLinkMock = vi.hoisted(() => vi.fn());
const redeemSteamLinkCodeMock = vi.hoisted(() => vi.fn());
const getUserMeMock = vi.hoisted(() => vi.fn());
const invalidateUserMeMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/client/Auth", () => ({
  isLoggedIn: isLoggedInMock,
}));

// This is the interface produced by the previous task (SteamLink.ts). Mocking
// it here means this file tests the modal's UI/wiring only — parseSteamLinkToken
// / redeem status-mapping already has its own coverage in SteamLink.test.ts.
// normalizeSteamLinkCode/isValidSteamLinkCode are kept real (via importActual)
// since they're pure and already covered there — re-mocking them here would
// just be reimplementing them a second time in this file.
vi.mock("../../src/client/SteamLink", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/client/SteamLink")>();
  return {
    normalizeSteamLinkCode: actual.normalizeSteamLinkCode,
    isValidSteamLinkCode: actual.isValidSteamLinkCode,
    stashPendingLink: stashPendingLinkMock,
    stashPendingCodeEntry: stashPendingCodeEntryMock,
    fetchSteamLinkTicket: fetchSteamLinkTicketMock,
    redeemSteamLink: redeemSteamLinkMock,
    redeemSteamLinkCode: redeemSteamLinkCodeMock,
  };
});

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

  // ─── Code-entry path (Task 17) ──────────────────────────────────────────
  // The desktop gate's fallback: when the browser handoff itself fails, it
  // shows an 8-character code instead of opening a token-carrying URL. There
  // is no ticket to look up a Steam persona from for this path (see
  // SteamLink.ts's fetchSteamLinkTicket doc comment) — these tests pin that
  // the confirm step still appears, still names the *web* account, and just
  // falls back to the existing "unknown persona" copy instead of a real name.
  describe("code entry", () => {
    const codeInput = () =>
      modal.querySelector<HTMLInputElement>("input.steam-link-code-input");
    const codeSubmitButton = () =>
      modal.querySelector<HTMLButtonElement>(
        "button.steam-link-code-submit-btn",
      );

    const typeCode = (raw: string) => {
      const input = codeInput();
      expect(input).not.toBeNull();
      input!.value = raw;
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    };

    it("when not logged in, stashes a code-entry intent (not a token) and routes to the login flow", async () => {
      isLoggedInMock.mockResolvedValue(false);

      await modal.openForCodeEntry();
      await modal.updateComplete;

      // The intent (not a code — nothing's been typed yet) must survive the
      // login redirect so the player lands back on this form afterward,
      // rather than the flow silently evaporating. See SteamLink.test.ts's
      // resumePendingSteamLink suite for the resume side of this.
      expect(stashPendingCodeEntryMock).toHaveBeenCalledTimes(1);
      expect(stashPendingLinkMock).not.toHaveBeenCalled();
      expect(window.location.hash).toBe("#modal=account");
      expect(modal.isOpen()).toBe(false);
      expect(getUserMeMock).not.toHaveBeenCalled();
      expect(fetchSteamLinkTicketMock).not.toHaveBeenCalled();
      expect(redeemSteamLinkCodeMock).not.toHaveBeenCalled();
    });

    it("shows a code-entry form when logged in", async () => {
      isLoggedInMock.mockResolvedValue(true);

      await modal.openForCodeEntry();
      await modal.updateComplete;

      expect(modal.isOpen()).toBe(true);
      expect(codeInput()).not.toBeNull();
      expect(codeSubmitButton()).not.toBeNull();
    });

    it("rejects a malformed code inline, with no network call at all", async () => {
      isLoggedInMock.mockResolvedValue(true);

      await modal.openForCodeEntry();
      await modal.updateComplete;

      // Contains 'O', which the fixed alphabet deliberately excludes.
      typeCode("2345678O");
      codeSubmitButton()?.click();
      await modal.updateComplete;

      expect(modal.textContent).toContain("steam_link_modal.invalid_code");
      expect(getUserMeMock).not.toHaveBeenCalled();
      expect(redeemSteamLinkCodeMock).not.toHaveBeenCalled();
    });

    it("normalizes a well-formed code (lower case, spaces, hyphen) and proceeds to confirm, showing the web account with the dedicated no-persona prompt", async () => {
      isLoggedInMock.mockResolvedValue(true);
      getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));

      await modal.openForCodeEntry();
      await modal.updateComplete;

      typeCode("  abcd-efgh  ");
      codeSubmitButton()?.click();

      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(confirmButton()?.disabled).toBe(false);
      });

      // No ticket lookup exists for a code, so there's never a persona name
      // to show on this path — it must use the dedicated no-persona prompt
      // key (not the generic "Link Steam {persona} with account {username}"
      // template with a filled-in placeholder, which reads as a doubled
      // "Steam ... Steam account").
      expect(fetchSteamLinkTicketMock).not.toHaveBeenCalled();
      expect(modal.textContent).toContain(
        "steam_link_modal.confirm_prompt_no_persona",
      );
      expect(modal.textContent).not.toContain(
        "steam_link_modal.confirm_prompt:",
      );
      expect(modal.textContent).toContain("web.1234");
    });

    it("pressing Enter in the code field submits it, same as clicking Continue", async () => {
      isLoggedInMock.mockResolvedValue(true);
      getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));

      await modal.openForCodeEntry();
      await modal.updateComplete;

      typeCode("ABCDEFGH");
      codeInput()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );

      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(confirmButton()?.disabled).toBe(false);
      });
      expect(getUserMeMock).toHaveBeenCalledTimes(1);
    });

    it("posts the normalized code, not the raw typed value, to redeemSteamLinkCode on confirm", async () => {
      isLoggedInMock.mockResolvedValue(true);
      getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));
      redeemSteamLinkCodeMock.mockResolvedValue({ ok: true });

      await modal.openForCodeEntry();
      await modal.updateComplete;

      typeCode("  abcd-efgh  ");
      codeSubmitButton()?.click();

      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(confirmButton()?.disabled).toBe(false);
      });

      confirmButton()?.click();

      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(modal.textContent).toContain("steam_link_modal.success");
      });
      expect(redeemSteamLinkCodeMock).toHaveBeenCalledWith("ABCDEFGH");
      expect(redeemSteamLinkMock).not.toHaveBeenCalled();
    });

    it("renders a distinct message for a 429 refusal instead of a generic/wrong-code message", async () => {
      isLoggedInMock.mockResolvedValue(true);
      getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));
      redeemSteamLinkCodeMock.mockResolvedValue({
        ok: false,
        reason: "rate_limited",
        retryAfterSeconds: 30,
      });

      await modal.openForCodeEntry();
      await modal.updateComplete;

      typeCode("ABCDEFGH");
      codeSubmitButton()?.click();

      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(confirmButton()?.disabled).toBe(false);
      });

      confirmButton()?.click();

      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(modal.textContent).toContain(
          "steam_link_modal.reason_rate_limited",
        );
      });
      expect(modal.textContent).not.toContain("steam_link_modal.reason_failed");
    });
  });
});
