import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMeResponse } from "../../src/core/ApiSchemas";

// ─── Mocks ───────────────────────────────────────────────────────────────

const isLoggedInMock = vi.hoisted(() => vi.fn());
const stashPendingLinkMock = vi.hoisted(() => vi.fn());
const stashPendingCodeEntryMock = vi.hoisted(() => vi.fn());
const fetchSteamLinkTicketMock = vi.hoisted(() => vi.fn());
const redeemSteamLinkMock = vi.hoisted(() => vi.fn());
const redeemSteamLinkCodeMock = vi.hoisted(() => vi.fn());
const answerSteamLinkConflictMock = vi.hoisted(() => vi.fn());
const getUserMeMock = vi.hoisted(() => vi.fn());
const invalidateUserMeMock = vi.hoisted(() => vi.fn());
const showToastMock = vi.hoisted(() => vi.fn());

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
    answerSteamLinkConflict: answerSteamLinkConflictMock,
  };
});

vi.mock("../../src/client/Api", () => ({
  getUserMe: getUserMeMock,
  invalidateUserMe: invalidateUserMeMock,
}));

vi.mock("../../src/client/Utils", () => ({
  showToast: showToastMock,
  translateText: vi.fn((key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  ),
}));

import { SteamLinkModal } from "../../src/client/SteamLinkModal";

// Defaults to an account with a real identity on it, because that is the
// precondition the modal now gates on -- a bare session is NOT enough (see
// the guest-account suite below). Pass `user` explicitly to build a guest.
function makeUserMe(
  username: string | null,
  user: UserMeResponse["user"] = { email: "player@example.com" },
): UserMeResponse {
  return {
    user,
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
    expect(showToastMock).toHaveBeenCalledWith(
      "steam_link_modal.login_required",
      "red",
    );
    // "Trigger the login flow" = route to the account modal, which shows the
    // login options for a logged-out visitor (see AccountModal).
    expect(window.location.hash).toBe("#modal=account");
    expect(modal.isOpen()).toBe(false);
    expect(fetchSteamLinkTicketMock).not.toHaveBeenCalled();
    expect(getUserMeMock).not.toHaveBeenCalled();
    expect(redeemSteamLinkMock).not.toHaveBeenCalled();
  });

  // The site hands every visitor a session: POST /auth/refresh with no cookie
  // creates a guest account and returns a signed JWT, so isLoggedIn() is true
  // for someone who has never signed in to anything. Gating on that alone let
  // a guest reach the confirm step and bind their Steam account to a
  // throwaway player -- which POST /auth/steam/link then treats as the owner,
  // so linking from their real account afterwards is refused
  // (steam_has_progress) with no way for the player to undo it. The gate is
  // "does this account have an identity", not "is there a session".
  describe("guest account (a session, but no linked identity)", () => {
    it("routes a guest to the login flow instead of confirming, stashing the token", async () => {
      isLoggedInMock.mockResolvedValue(true);
      getUserMeMock.mockResolvedValue(makeUserMe("Ada", {}));

      await modal.openWithToken("tok-abc");
      await modal.updateComplete;

      expect(stashPendingLinkMock).toHaveBeenCalledWith("tok-abc");
      expect(showToastMock).toHaveBeenCalledWith(
        "steam_link_modal.login_required",
        "red",
      );
      expect(window.location.hash).toBe("#modal=account");
      expect(modal.isOpen()).toBe(false);
      expect(fetchSteamLinkTicketMock).not.toHaveBeenCalled();
      expect(redeemSteamLinkMock).not.toHaveBeenCalled();
    });

    it("routes a guest to the login flow from the code-entry path too, stashing the intent", async () => {
      isLoggedInMock.mockResolvedValue(true);
      getUserMeMock.mockResolvedValue(makeUserMe(null, {}));

      await modal.openForCodeEntry();
      await modal.updateComplete;

      expect(stashPendingCodeEntryMock).toHaveBeenCalledTimes(1);
      expect(stashPendingLinkMock).not.toHaveBeenCalled();
      expect(window.location.hash).toBe("#modal=account");
      expect(modal.isOpen()).toBe(false);
      expect(redeemSteamLinkCodeMock).not.toHaveBeenCalled();
    });

    it("accepts an account whose only identity is Steam, which is a real account", async () => {
      isLoggedInMock.mockResolvedValue(true);
      getUserMeMock.mockResolvedValue(
        makeUserMe("Ada", {
          steam: {
            steamId: "76561198000000000",
            personaName: "Ada",
            avatarUrl: null,
          },
        }),
      );
      fetchSteamLinkTicketMock.mockResolvedValue({
        ok: true,
        personaName: "Ada",
      });

      await modal.openWithToken("tok-abc");
      await modal.updateComplete;

      expect(modal.isOpen()).toBe(true);
      expect(stashPendingLinkMock).not.toHaveBeenCalled();
      expect(window.location.hash).not.toBe("#modal=account");
    });

    // `false` from getUserMe means EITHER signed out OR a transient failure
    // (5xx, timeout -- see Api.ts). isLoggedIn() has already said a session
    // exists, so it cannot mean "guest" here. Opening and showing the
    // load-error state is the honest outcome; bouncing a signed-in player to
    // the login screen over a network blip is not. Covered end-to-end by
    // "shows a load-error state with no confirm control when /users/@me
    // fails" above -- asserted here as the gate's own decision.
    it("does not treat an unreadable /users/@me as a guest", async () => {
      isLoggedInMock.mockResolvedValue(true);
      getUserMeMock.mockResolvedValue(false);
      fetchSteamLinkTicketMock.mockResolvedValue({
        ok: true,
        personaName: "Ada",
      });

      await modal.openWithToken("tok-abc");
      await modal.updateComplete;

      expect(stashPendingLinkMock).not.toHaveBeenCalled();
      expect(window.location.hash).not.toBe("#modal=account");
      expect(modal.isOpen()).toBe(true);
    });

    // The window the gate above cannot close on its own. getUserMe() memoises
    // its answer, but Api.ts deliberately UN-caches an aborted/timed-out
    // attempt (and a 401 clears the session outright), so the gate's read and
    // the modal's own read are not guaranteed to agree. A first read that
    // times out returns `false` -- correctly not treated as a guest -- and
    // the modal opens; the next read is then a fresh fetch that can succeed
    // and hand back the very guest profile the gate never got to see. If only
    // `userMe === false` is checked there, that guest reaches "ready" with the
    // confirm control enabled, and confirming binds Steam to the throwaway
    // account for good (steam_has_progress, unrecoverable) -- the exact
    // outcome this whole change exists to prevent. The rule has to be applied
    // at every read of userMe, not once at the door.
    describe("when the gate's read failed and a later read sees the guest", () => {
      it("routes to the login flow from the token path instead of reaching confirm", async () => {
        isLoggedInMock.mockResolvedValue(true);
        // 1st = the gate's read, timed out (Api.ts clears its cache for
        // exactly this case). 2nd = onOpen's, a fresh fetch that succeeds.
        getUserMeMock
          .mockResolvedValueOnce(false)
          .mockResolvedValue(makeUserMe("Ada", {}));
        fetchSteamLinkTicketMock.mockResolvedValue({
          ok: true,
          personaName: "Ada",
        });

        await modal.openWithToken("tok-abc");
        await vi.waitFor(async () => {
          await modal.updateComplete;
          expect(window.location.hash).toBe("#modal=account");
        });

        // Same destination as the gate's: stashed so the login redirect does
        // not lose the token, and the modal is gone rather than sitting on a
        // confirm step it must never show.
        expect(stashPendingLinkMock).toHaveBeenCalledWith("tok-abc");
        expect(modal.isOpen()).toBe(false);
        // close() hides the shell but leaves the rendered body in the light
        // DOM, so assert the state that actually matters: Confirm was never
        // enabled (it is enabled only in loadState "ready"), so there was no
        // moment at which a click could have redeemed anything.
        expect(confirmButton()?.disabled ?? true).toBe(true);
        expect(redeemSteamLinkMock).not.toHaveBeenCalled();
      });

      it("routes to the login flow from the code path instead of reaching confirm", async () => {
        isLoggedInMock.mockResolvedValue(true);
        // 1st = the gate's read (openForCodeEntry), timed out. 2nd =
        // handleCodeSubmit's, which succeeds and returns the guest.
        getUserMeMock
          .mockResolvedValueOnce(false)
          .mockResolvedValue(makeUserMe(null, {}));

        await modal.openForCodeEntry();
        await modal.updateComplete;
        expect(modal.isOpen()).toBe(true);

        const input = modal.querySelector<HTMLInputElement>(
          "input.steam-link-code-input",
        );
        expect(input).not.toBeNull();
        input!.value = "ABCDEFGH";
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        modal
          .querySelector<HTMLButtonElement>("button.steam-link-code-submit-btn")
          ?.click();

        await vi.waitFor(async () => {
          await modal.updateComplete;
          expect(window.location.hash).toBe("#modal=account");
        });

        expect(stashPendingCodeEntryMock).toHaveBeenCalledTimes(1);
        expect(stashPendingLinkMock).not.toHaveBeenCalled();
        expect(modal.isOpen()).toBe(false);
        // See the token-path case above: absent-or-disabled, never enabled.
        expect(confirmButton()?.disabled ?? true).toBe(true);
        expect(redeemSteamLinkCodeMock).not.toHaveBeenCalled();
      });

      // The control: the same disagreement between the two reads, but the
      // second one returns a REAL account. A rule applied at every read must
      // still let this through, or a single timed-out read would strand a
      // logged-in player at the login screen.
      it("still reaches confirm when the later read returns a real account", async () => {
        isLoggedInMock.mockResolvedValue(true);
        getUserMeMock
          .mockResolvedValueOnce(false)
          .mockResolvedValue(makeUserMe("web.1234"));
        fetchSteamLinkTicketMock.mockResolvedValue({
          ok: true,
          personaName: "Ada",
        });

        await modal.openWithToken("tok-abc");
        await vi.waitFor(async () => {
          await modal.updateComplete;
          expect(confirmButton()?.disabled).toBe(false);
        });

        expect(modal.isOpen()).toBe(true);
        expect(stashPendingLinkMock).not.toHaveBeenCalled();
        expect(window.location.hash).not.toBe("#modal=account");
        expect(modal.textContent).toContain("web.1234");
      });
    });
  });

  it("renders both names once loaded, and disables confirm until both have loaded", async () => {
    isLoggedInMock.mockResolvedValue(true);
    const ticket = deferred<{ ok: true; personaName: string | null }>();
    const userMe = deferred<UserMeResponse>();
    fetchSteamLinkTicketMock.mockReturnValue(ticket.promise);
    // First call is the identity gate's (see needsAccountLogin) and must
    // settle for the modal to open at all; the deferred one is onOpen's. In
    // production these are the same memoised promise (Api.ts caches
    // __userMe), so only onOpen's is ever genuinely in flight — which is the
    // state this test is about.
    getUserMeMock
      .mockReturnValueOnce(Promise.resolve(makeUserMe("web.1234")))
      .mockReturnValue(userMe.promise);

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

  // player.username is null for any player who has never claimed a username
  // — the default state (usernameStatus starts at "unclaimed") — so this is
  // the common case, not an edge case. The confirm step exists precisely
  // because a shared machine's browser might be logged into someone else's
  // OpenFront session; showing a placeholder noun instead of an identifying
  // value there guts the whole point of the screen. Follows the repo-wide
  // `username ?? publicId` convention (see ApiSchemas.ts / PlayerName.ts).
  it("falls back to the account's publicId when the username is unclaimed (null), never a placeholder noun", async () => {
    isLoggedInMock.mockResolvedValue(true);
    fetchSteamLinkTicketMock.mockResolvedValue({
      ok: true,
      personaName: "Ada",
    });
    getUserMeMock.mockResolvedValue(makeUserMe(null));

    await modal.openWithToken("tok-abc");
    await vi.waitFor(async () => {
      await modal.updateComplete;
      expect(confirmButton()?.disabled).toBe(false);
    });

    expect(modal.textContent).toContain("p1"); // publicId from makeUserMe
    expect(modal.textContent).not.toContain(
      "steam_link_modal.unknown_username",
    );
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
    expect(modal.textContent).not.toContain("common.error_generic");
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
      expect(modal.textContent).toContain("common.error_generic");
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

  // Same rule as the discard's: the header close and Escape stay live during
  // "Linking…", and a link that landed has changed the cached profile whether
  // or not the modal is still there to say so.
  it("refreshes the cached profile even if closed while linking", async () => {
    isLoggedInMock.mockResolvedValue(true);
    fetchSteamLinkTicketMock.mockResolvedValue({
      ok: true,
      personaName: "Ada",
    });
    getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));
    const redeem = deferred<{ ok: true }>();
    redeemSteamLinkMock.mockReturnValue(redeem.promise);

    await modal.openWithToken("tok-abc");
    await vi.waitFor(async () => {
      await modal.updateComplete;
      expect(confirmButton()?.disabled).toBe(false);
    });
    confirmButton()?.click();
    await modal.updateComplete;
    invalidateUserMeMock.mockClear();
    modal.close();
    redeem.resolve({ ok: true });

    await vi.waitFor(() => expect(invalidateUserMeMock).toHaveBeenCalled());
  });

  // ─── Code-entry path (Task 17) ──────────────────────────────────────────
  // The desktop gate's fallback: when the browser handoff itself fails, it
  // shows an 8-character code instead of opening a token-carrying URL. There
  // is no ticket to look up a Steam persona from for this path (see
  // SteamLink.ts's fetchSteamLinkTicket doc comment) — these tests pin that
  // the confirm step still appears, still names the *web* account (falling
  // back through publicId — see the "identifies the account" tests below —
  // never to a placeholder noun), and uses the dedicated no-persona prompt
  // rather than a real Steam name.
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
      getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));

      await modal.openForCodeEntry();
      await modal.updateComplete;

      // Opening already read /users/@me once, for the identity gate. What
      // this test is about is what SUBMITTING a malformed code costs, so
      // count from here rather than from zero.
      const callsBeforeSubmit = getUserMeMock.mock.calls.length;

      // Contains 'O', which the fixed alphabet deliberately excludes.
      typeCode("2345678O");
      codeSubmitButton()?.click();
      await modal.updateComplete;

      expect(modal.textContent).toContain("steam_link_modal.invalid_code");
      expect(getUserMeMock).toHaveBeenCalledTimes(callsBeforeSubmit);
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

    it("falls back to the account's publicId when the username is unclaimed (null), never a placeholder noun", async () => {
      isLoggedInMock.mockResolvedValue(true);
      getUserMeMock.mockResolvedValue(makeUserMe(null));

      await modal.openForCodeEntry();
      await modal.updateComplete;

      typeCode("ABCDEFGH");
      codeSubmitButton()?.click();

      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(confirmButton()?.disabled).toBe(false);
      });

      expect(modal.textContent).toContain("p1"); // publicId from makeUserMe
      expect(modal.textContent).not.toContain(
        "steam_link_modal.unknown_username",
      );
    });

    it("shows the code-path's own load-error message (not the token path's 'try again from Steam' copy) when /users/@me fails", async () => {
      isLoggedInMock.mockResolvedValue(true);
      getUserMeMock.mockResolvedValue(false);

      await modal.openForCodeEntry();
      await modal.updateComplete;

      typeCode("ABCDEFGH");
      codeSubmitButton()?.click();

      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(
          modal
            .querySelector(".steam-link-load-error-text")
            ?.textContent?.trim(),
        ).toBe("steam_link_modal.load_error_code");
      });
    });

    // Task 17's whole point was giving a code-only player a route through.
    // A refusal that strands them on a confirm screen with only Cancel (which
    // closes the modal for good — Main.ts's strip() already removed
    // #steam-link from the URL, so a refresh can't reopen it) recreates that
    // same dead end one screen later. The alphabet still has eye-confusable
    // pairs (B/8, S/5, 2/Z, G/6), so a one-character mistranscription is a
    // realistic way to land here.
    it("returns to the code-entry form, draft still prefilled, after a refused code — and a corrected code can be resubmitted without reopening the modal", async () => {
      isLoggedInMock.mockResolvedValue(true);
      getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));
      redeemSteamLinkCodeMock.mockResolvedValueOnce({
        ok: false,
        reason: "failed",
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

      // Back on the code-entry form — not stuck on a dead-end confirm
      // screen — with the same draft still there to correct.
      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(codeInput()).not.toBeNull();
      });
      expect(confirmButton()).toBeNull();
      expect(codeInput()?.value).toBe("ABCDEFGH");
      expect(modal.textContent).toContain("common.error_generic");

      // Correct one character and resubmit — proceeds as a fresh attempt,
      // not stuck showing the previous refusal.
      redeemSteamLinkCodeMock.mockResolvedValueOnce({ ok: true });
      typeCode("ABCDEFGJ");
      codeSubmitButton()?.click();

      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(confirmButton()?.disabled).toBe(false);
      });
      // The stale failure from the first attempt must not resurface on this
      // fresh ready state before Confirm has even been clicked again.
      expect(modal.textContent).not.toContain("common.error_generic");

      confirmButton()?.click();
      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(modal.textContent).toContain("steam_link_modal.success");
      });
      expect(redeemSteamLinkCodeMock).toHaveBeenLastCalledWith("ABCDEFGJ");
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
      // Exactly two: the identity gate's read when the form opened, and one
      // submit. Enter must not double-submit — three would mean it did.
      expect(getUserMeMock).toHaveBeenCalledTimes(2);
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
      expect(modal.textContent).not.toContain("common.error_generic");
    });
  });

  // ─── The discard confirmation ──────────────────────────────────────────
  //
  // `steam_has_progress` used to be a dead end: the Steam account already
  // belongs to an OpenFront account created by the first launch, the link is
  // permanent, and the only way out was a support ticket. The server may now
  // offer to discard that account, and these cover the modal's half of it.
  describe("conflict discard", () => {
    const account = {
      publicId: "p9",
      username: "Throwaway",
      createdAt: "2026-09-01T00:00:00.000Z",
      personaName: "Ada",
      gamesPlayed: 2,
      gamesPlayedCapped: false,
    };

    const discardButton = () =>
      modal.querySelector<HTMLButtonElement>("button.steam-link-discard-btn");
    const cancelButton = () =>
      modal.querySelector<HTMLButtonElement>("button.steam-link-cancel-btn");

    async function reachConfirmation(): Promise<void> {
      isLoggedInMock.mockResolvedValue(true);
      getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));
      fetchSteamLinkTicketMock.mockResolvedValue({
        ok: true,
        personaName: "Ada",
      });
      redeemSteamLinkMock.mockResolvedValue({
        ok: false,
        reason: "steam_has_progress",
        conflict: { discardable: true, account },
      });

      await modal.openWithToken("tok-abc");
      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(confirmButton()?.disabled).toBe(false);
      });
      confirmButton()?.click();
      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(discardButton()).not.toBeNull();
      });
    }

    it("offers the discard instead of the dead-end refusal", async () => {
      await reachConfirmation();

      // What is being destroyed, and what is being kept: both have to be on
      // the screen, or the player cannot tell which way round it is.
      expect(modal.textContent).toContain("Throwaway");
      expect(modal.textContent).toContain("steam_link_modal.conflict_warning");
      expect(modal.textContent).toContain("steam_link_modal.conflict_keep");
      expect(modal.textContent).not.toContain(
        "steam_link_modal.reason_steam_has_progress",
      );
    });

    it("confirming discards and reports success", async () => {
      await reachConfirmation();
      answerSteamLinkConflictMock.mockResolvedValue({ ok: true, linked: true });

      discardButton()?.click();

      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(modal.textContent).toContain("steam_link_modal.success");
      });
      expect(answerSteamLinkConflictMock).toHaveBeenCalledWith("discard");
      expect(invalidateUserMeMock).toHaveBeenCalled();
    });

    it("surfaces a refused discard with the server's reason", async () => {
      await reachConfirmation();
      answerSteamLinkConflictMock.mockResolvedValue({
        ok: false,
        reason: "discard_deferred",
      });

      discardButton()?.click();

      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(modal.textContent).toContain(
          "steam_link_modal.reason_discard_deferred",
        );
      });
    });

    // A purchase still settling on the other account is the ONE refusal the
    // server leaves the offer standing for — it clears by itself in minutes,
    // so the confirmation has to stay answerable rather than becoming a
    // second dead end.
    it("stays answerable after a deferred refusal", async () => {
      await reachConfirmation();
      answerSteamLinkConflictMock.mockResolvedValue({
        ok: false,
        reason: "discard_deferred",
      });

      discardButton()?.click();
      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(modal.textContent).toContain(
          "steam_link_modal.reason_discard_deferred",
        );
      });

      expect(discardButton()?.disabled).toBe(false);
      // Still ours to cancel, so closing must still release the desktop's
      // ticket rather than leaving the game waiting.
      answerSteamLinkConflictMock.mockClear();
      modal.close();
      await modal.updateComplete;
      expect(answerSteamLinkConflictMock).toHaveBeenCalledWith("cancel");
    });

    // The confirmation stays on screen while the delete runs: falling back to
    // the ordinary link confirm step here would show "Linking…" over an
    // account deletion, which is the wrong thing to tell someone mid-delete.
    it("keeps the confirmation on screen while deleting", async () => {
      await reachConfirmation();
      const answer = deferred<{ ok: boolean; linked: boolean }>();
      answerSteamLinkConflictMock.mockReturnValue(answer.promise);

      discardButton()?.click();
      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(discardButton()?.disabled).toBe(true);
      });

      expect(modal.textContent).toContain("steam_link_modal.conflict_deleting");
      expect(modal.textContent).not.toContain("steam_link_modal.linking");
      answer.resolve({ ok: true, linked: true });
    });

    // Two fixes in one: the paid block now survives the answer path (the
    // server re-checks at confirm time, so a purchase landing on the doomed
    // account between the offer and the click refuses HERE and deserves the
    // same specific copy the up-front refusal gets — the answer path used to
    // drop `block` and fall back to the generic dead end), and a permanent
    // refusal takes the button with it. Leaving the
    // confirmation on screen with an enabled "Delete it and link" under a
    // refusal that can only ever be refused again is a live destructive
    // control that does nothing — the one screen where that is least
    // acceptable.
    it("retires the confirmation when the refusal is permanent", async () => {
      await reachConfirmation();
      answerSteamLinkConflictMock.mockResolvedValue({
        ok: false,
        reason: "discard_blocked",
        block: "paid",
      });

      discardButton()?.click();

      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(modal.textContent).toContain(
          "steam_link_modal.reason_discard_blocked_paid",
        );
      });
      // Gone, not merely disabled.
      expect(discardButton()).toBeNull();
    });

    // The regression the previous fix introduced: clearing `conflict` on a
    // terminal refusal retired the whole screen, and on the WEBSITE path
    // (no token) renderBody then fell through to the ordinary link-confirm
    // step — "Link Steam … with account …" over an enabled button whose
    // handler finds no token and returns silently.
    it("does not fall through to the link screen on the website path", async () => {
      getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));
      await modal.openForConflict(account);
      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(discardButton()).not.toBeNull();
      });
      answerSteamLinkConflictMock.mockResolvedValue({
        ok: false,
        reason: "discard_blocked",
        block: "paid",
      });

      discardButton()?.click();

      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(modal.textContent).toContain(
          "steam_link_modal.reason_discard_blocked_paid",
        );
      });
      // The refusal keeps its own screen; the link-confirm step never appears,
      // and the destructive action is gone rather than merely disabled.
      expect(modal.textContent).not.toContain(
        "steam_link_modal.confirm_prompt",
      );
      expect(discardButton()).toBeNull();
      // What is left is a way out, and it must not post against a spent offer.
      answerSteamLinkConflictMock.mockClear();
      cancelButton()?.click();
      await modal.updateComplete;
      expect(answerSteamLinkConflictMock).not.toHaveBeenCalled();
      expect(modal.isOpen()).toBe(false);
    });

    // BaseModal re-runs onOpen() on an already-open modal without onClose(),
    // and a new #steam-link handoff opens straight on top. The previous offer's
    // destructive screen must not survive into the new flow.
    it("does not carry a stale offer into a new handoff", async () => {
      await reachConfirmation();
      redeemSteamLinkMock.mockResolvedValue({ ok: true });

      await modal.openWithToken("tok-second");
      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(confirmButton()).not.toBeNull();
      });

      expect(discardButton()).toBeNull();
      expect(modal.textContent).not.toContain(
        "steam_link_modal.conflict_warning",
      );
    });

    // The server has already deleted an account and moved a Steam id by the
    // time this resolves, and the profile is cached for the page's lifetime.
    // Closing mid-delete must not leave the page showing the pre-link account.
    it("refreshes the profile even if closed while deleting", async () => {
      await reachConfirmation();
      const answer = deferred<{ ok: boolean; linked: boolean }>();
      answerSteamLinkConflictMock.mockReturnValue(answer.promise);
      invalidateUserMeMock.mockClear();

      discardButton()?.click();
      await modal.updateComplete;
      modal.close();
      answer.resolve({ ok: true, linked: true });

      await vi.waitFor(() => expect(invalidateUserMeMock).toHaveBeenCalled());
    });

    // Cancel and close are the same "not now" to a website player; neither may
    // spend the offer there, since nothing is waiting on it.
    it("website Cancel leaves the offer alone, like website close", async () => {
      getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));
      await modal.openForConflict(account);
      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(discardButton()).not.toBeNull();
      });

      cancelButton()?.click();
      await modal.updateComplete;

      expect(answerSteamLinkConflictMock).not.toHaveBeenCalled();
      expect(modal.isOpen()).toBe(false);
    });

    // This line is how the player recognises the account about to be deleted.
    it("omits an unparseable created date rather than showing Invalid Date", async () => {
      getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));
      await modal.openForConflict({ ...account, createdAt: "not-a-date" });
      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(discardButton()).not.toBeNull();
      });

      expect(modal.textContent).not.toContain("Invalid Date");
      expect(modal.textContent).toContain("Throwaway");
    });

    const conflictCodeInput = () =>
      modal.querySelector<HTMLInputElement>("input.steam-link-code-input");

    // The code path up to its confirm step; the redeem's answer is the
    // caller's choice.
    async function reachCodeConfirm(): Promise<void> {
      isLoggedInMock.mockResolvedValue(true);
      getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));
      await modal.openForCodeEntry();
      await modal.updateComplete;
      const input = conflictCodeInput();
      expect(input).not.toBeNull();
      input!.value = "ABCDEFGH";
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      modal
        .querySelector<HTMLButtonElement>("button.steam-link-code-submit-btn")
        ?.click();
      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(confirmButton()?.disabled).toBe(false);
      });
    }

    // The code path's usual answer to a refusal is "back to the field" — but
    // the code was RIGHT here; the refusal is about the Steam account, and
    // there is nothing to retype. The confirmation replaces the field.
    it("shows the confirmation on the code path rather than returning to the field", async () => {
      await reachCodeConfirm();
      redeemSteamLinkCodeMock.mockResolvedValue({
        ok: false,
        reason: "steam_has_progress",
        conflict: { discardable: true, account },
      });

      confirmButton()?.click();

      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(discardButton()).not.toBeNull();
      });
      expect(conflictCodeInput()).toBeNull();
      expect(modal.textContent).toContain("Throwaway");
    });

    // ...whereas a conflict with NO way through is a refusal like any other on
    // the code path: back to the field, with the block named inline — the same
    // place the same refusal lands from a server that sends no offer at all.
    // Landing on the confirm step instead left "Link Account" enabled over a
    // code that could only be refused again.
    it("sends a code-path refusal with no way through back to the field, naming the block", async () => {
      await reachCodeConfirm();
      redeemSteamLinkCodeMock.mockResolvedValue({
        ok: false,
        reason: "steam_has_progress",
        conflict: { discardable: false, block: "paid" },
      });

      confirmButton()?.click();

      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(conflictCodeInput()).not.toBeNull();
      });
      expect(modal.textContent).toContain(
        "steam_link_modal.reason_discard_blocked_paid",
      );
      expect(confirmButton()).toBeNull();
      expect(discardButton()).toBeNull();
    });

    // Every terminal answer the server documents, each with a specific
    // message: the offer is spent, the button goes, and the way out posts
    // nothing.
    it.each([
      [
        "offer_unavailable",
        undefined,
        "steam_link_modal.reason_offer_unavailable",
      ],
      ["offer_invalid", undefined, "steam_link_modal.reason_offer_unavailable"],
      [
        "account_is_guest",
        undefined,
        "steam_link_modal.reason_offer_unavailable",
      ],
      [
        "steam_linked_elsewhere",
        undefined,
        "steam_link_modal.reason_steam_linked_elsewhere",
      ],
      ["discard_blocked", "banned", "steam_link_modal.reason_discard_blocked"],
      ["discard_blocked", "support", "steam_link_modal.reason_discard_blocked"],
    ])(
      "retires the confirmation on %s (block %s) with a specific message",
      async (reason, block, key) => {
        await reachConfirmation();
        answerSteamLinkConflictMock.mockResolvedValue({
          ok: false,
          reason,
          ...(block === undefined ? {} : { block }),
        });

        discardButton()?.click();

        await vi.waitFor(async () => {
          await modal.updateComplete;
          expect(modal.textContent).toContain(key);
        });
        expect(modal.textContent).not.toContain("common.error_generic");
        expect(discardButton()).toBeNull();
        answerSteamLinkConflictMock.mockClear();
        cancelButton()?.click();
        await modal.updateComplete;
        expect(answerSteamLinkConflictMock).not.toHaveBeenCalled();
        expect(modal.isOpen()).toBe(false);
      },
    );

    // The throttle runs before the handler, so a 429 never spent the offer:
    // the wait is named, the button stays, and closing still releases the
    // desktop's ticket.
    it("treats a throttled discard as still answerable", async () => {
      await reachConfirmation();
      answerSteamLinkConflictMock.mockResolvedValue({
        ok: false,
        reason: "rate_limited",
        retryAfterSeconds: 30,
      });

      discardButton()?.click();

      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(modal.textContent).toContain(
          'steam_link_modal.reason_rate_limited:{"seconds":30}',
        );
      });
      expect(modal.textContent).not.toContain("common.error_generic");
      expect(discardButton()?.disabled).toBe(false);
      answerSteamLinkConflictMock.mockClear();
      modal.close();
      await modal.updateComplete;
      expect(answerSteamLinkConflictMock).toHaveBeenCalledWith("cancel");
    });

    // A 200 is not a link. The response models the two separately (a cancel
    // is a 200 with linked: false), and "now linked" over an account that is
    // not would be the worst message to show right after an irreversible
    // delete. Spent, though: the server answered, so nothing is cancelled.
    it("does not report success when the server answered without linking", async () => {
      await reachConfirmation();
      answerSteamLinkConflictMock.mockResolvedValue({
        ok: true,
        linked: false,
      });
      invalidateUserMeMock.mockClear();

      discardButton()?.click();

      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(modal.textContent).toContain(
          "steam_link_modal.reason_discard_not_linked",
        );
      });
      expect(modal.textContent).not.toContain("steam_link_modal.success");
      expect(discardButton()).toBeNull();
      expect(invalidateUserMeMock).toHaveBeenCalled();
      answerSteamLinkConflictMock.mockClear();
      modal.close();
      await modal.updateComplete;
      expect(answerSteamLinkConflictMock).not.toHaveBeenCalled();
    });

    // The identity rule applies at every read of /users/@me, this one
    // included: a throwaway account is not a survivor worth naming. No login
    // redirect here — there is no pending link to stash and resume.
    it("shows the load error rather than naming a guest as the account kept", async () => {
      getUserMeMock.mockResolvedValue(makeUserMe("Ada", {}));

      await modal.openForConflict(account);
      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(modal.textContent).toContain("steam_link_modal.load_error_code");
      });

      expect(discardButton()).toBeNull();
      expect(stashPendingLinkMock).not.toHaveBeenCalled();
      expect(window.location.hash).not.toBe("#modal=account");
    });

    // ...but a refusal the player can still answer keeps its button.
    it("keeps the confirmation when the refusal is retryable", async () => {
      await reachConfirmation();
      answerSteamLinkConflictMock.mockResolvedValue({
        ok: false,
        reason: "discard_deferred",
      });

      discardButton()?.click();

      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(modal.textContent).toContain(
          "steam_link_modal.reason_discard_deferred",
        );
      });
      expect(discardButton()).not.toBeNull();
    });

    // Declining is an answer. The desktop is polling a link ticket the server
    // left open for this question, so telling it now is the difference
    // between an immediate refusal and a ten-minute hang.
    it("declining tells the server and closes", async () => {
      await reachConfirmation();
      answerSteamLinkConflictMock.mockResolvedValue({
        ok: true,
        linked: false,
      });

      cancelButton()?.click();
      await modal.updateComplete;

      expect(answerSteamLinkConflictMock).toHaveBeenCalledWith("cancel");
      expect(modal.isOpen()).toBe(false);
    });

    it("closing an unanswered offer declines it too", async () => {
      await reachConfirmation();
      answerSteamLinkConflictMock.mockResolvedValue({
        ok: true,
        linked: false,
      });

      modal.close();
      await modal.updateComplete;

      expect(answerSteamLinkConflictMock).toHaveBeenCalledWith("cancel");
    });

    it("does not decline after the offer has already been spent", async () => {
      await reachConfirmation();
      answerSteamLinkConflictMock.mockResolvedValue({ ok: true, linked: true });

      discardButton()?.click();
      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(modal.textContent).toContain("steam_link_modal.success");
      });
      answerSteamLinkConflictMock.mockClear();

      modal.close();
      await modal.updateComplete;

      expect(answerSteamLinkConflictMock).not.toHaveBeenCalled();
    });

    // Money makes it support's call. The player gets the specific reason,
    // which is what stops them opening a ticket to ask what the problem was.
    it("renders the paid block rather than an offer", async () => {
      isLoggedInMock.mockResolvedValue(true);
      getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));
      fetchSteamLinkTicketMock.mockResolvedValue({
        ok: true,
        personaName: "Ada",
      });
      redeemSteamLinkMock.mockResolvedValue({
        ok: false,
        reason: "steam_has_progress",
        conflict: { discardable: false, block: "paid" },
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
          "steam_link_modal.reason_discard_blocked_paid",
        );
      });
      expect(discardButton()).toBeNull();
    });

    // The website's entry point: its refusal already happened on the Steam
    // OpenID redirect, so the modal opens straight onto the confirmation.
    it("opens straight onto the confirmation for the website flow", async () => {
      getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));

      await modal.openForConflict(account);
      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(discardButton()).not.toBeNull();
      });

      expect(modal.isOpen()).toBe(true);
      // No ticket, no code: nothing was redeemed to get here.
      expect(redeemSteamLinkMock).not.toHaveBeenCalled();
      expect(fetchSteamLinkTicketMock).not.toHaveBeenCalled();
    });

    // The button is irreversible, so it must not be clickable while the line
    // above it ("You'll keep ___") is still blank. The token path already
    // sequences this way; the website path used to reach `ready` synchronously
    // and render an enabled Delete over a name that had not arrived.
    it("does not offer Delete until the kept account has a name", async () => {
      const userMe = deferred<UserMeResponse>();
      getUserMeMock.mockReturnValue(userMe.promise);

      await modal.openForConflict(account);
      await modal.updateComplete;

      expect(discardButton()?.disabled).toBe(true);
      expect(modal.textContent).not.toContain(
        "steam_link_modal.confirm_prompt",
      );

      userMe.resolve(makeUserMe("web.1234"));
      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(discardButton()?.disabled).toBe(false);
      });
    });

    // `false` is a transient failure as much as a signed-out read (Api.ts
    // returns the same value for both). A confirmation that cannot name the
    // survivor is asking the player to approve a deletion on trust.
    it("shows the load error rather than an unnamed confirmation", async () => {
      getUserMeMock.mockResolvedValue(false);

      await modal.openForConflict(account);
      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(modal.textContent).toContain("steam_link_modal.load_error_code");
      });

      // The code variant's wording, asserted above, not the token path's
      // "try again from Steam" — this player never went through Steam's
      // client to get here.
      expect(discardButton()).toBeNull();
    });

    // `failed` covers a network error and any unexpected status, so the
    // request may never have reached the server and the offer may still be
    // live. Treating it as spent would leave the desktop's ticket pending
    // until expiry; a cancel against an already-spent offer is a harmless 410.
    it("stays cancellable when the discard request never landed", async () => {
      await reachConfirmation();
      answerSteamLinkConflictMock.mockResolvedValue({
        ok: false,
        reason: "failed",
      });

      discardButton()?.click();
      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(modal.textContent).toContain("common.error_generic");
      });

      answerSteamLinkConflictMock.mockClear();
      modal.close();
      await modal.updateComplete;

      expect(answerSteamLinkConflictMock).toHaveBeenCalledWith("cancel");
    });

    // Nothing is waiting on the website path, so closing must NOT spend the
    // offer — that would cost a player who closed the dialog to think about it
    // another full trip through Steam.
    it("closing the website flow leaves the offer alone", async () => {
      getUserMeMock.mockResolvedValue(makeUserMe("web.1234"));

      await modal.openForConflict(account);
      await vi.waitFor(async () => {
        await modal.updateComplete;
        expect(discardButton()).not.toBeNull();
      });
      modal.close();
      await modal.updateComplete;

      expect(answerSteamLinkConflictMock).not.toHaveBeenCalled();
    });
  });
});
