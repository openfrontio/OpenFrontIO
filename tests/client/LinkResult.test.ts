import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showInGameAlert } from "../../src/client/InGameModal";
import { consumeLinkResult } from "../../src/client/LinkResult";

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => undefined),
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

// `steam_has_progress` is the one outcome that asks the server a follow-up
// question before it says anything — see offerSteamConflictDiscard.
const fetchSteamLinkConflictMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/client/SteamLink", () => ({
  fetchSteamLinkConflict: fetchSteamLinkConflictMock,
}));

const alertMock = vi.mocked(showInGameAlert);

const account = {
  publicId: "p9",
  username: "Throwaway",
  createdAt: "2026-09-01T00:00:00.000Z",
  personaName: "Ada",
  gamesPlayed: 2,
  gamesPlayedCapped: false,
};

// The modal element the offer is handed to. Registered as a plain custom
// element rather than the real SteamLinkModal: this module only ever reaches
// for `openForConflict`, and importing Lit here would test the modal instead.
function installModal(): { openForConflict: ReturnType<typeof vi.fn> } {
  const openForConflict = vi.fn(async () => undefined);
  const el = document.createElement("steam-link-modal");
  Object.assign(el, { openForConflict });
  document.body.appendChild(el);
  return { openForConflict };
}

function setHash(hash: string) {
  history.replaceState(null, "", hash);
}

beforeEach(() => {
  alertMock.mockClear();
  fetchSteamLinkConflictMock.mockReset();
  fetchSteamLinkConflictMock.mockResolvedValue({ ok: true, conflict: null });
});

afterEach(() => {
  history.replaceState(null, "", "/");
  document.querySelectorAll("steam-link-modal").forEach((el) => el.remove());
});

describe("consumeLinkResult", () => {
  it.each([
    ["google", "account_modal.link_google_success"],
    ["already_linked", "account_modal.link_google_already_linked"],
    ["steam", "account_modal.link_steam_success"],
    [
      "account_already_has_steam",
      "steam_link_modal.reason_account_already_has_steam",
    ],
    [
      "steam_linked_elsewhere",
      "steam_link_modal.reason_steam_linked_elsewhere",
    ],
    ["error", "account_modal.link_google_error"],
    ["steam_error", "account_modal.link_steam_error"],
  ])("surfaces %s", (link, expectedKey) => {
    setHash(`#modal=account&link=${link}`);

    consumeLinkResult({ modal: "account", link });

    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock).toHaveBeenCalledWith(expectedKey);
  });

  // The Steam refusals reuse the strings the desktop link flow established, so
  // the same outcome reads the same whether the player reached it from the
  // game or from the website.
  it("uses the desktop flow's own wording for the Steam refusals", async () => {
    setHash("#modal=account&link=steam_has_progress");

    consumeLinkResult({ modal: "account", link: "steam_has_progress" });

    await vi.waitFor(() =>
      expect(alertMock).toHaveBeenCalledWith(
        "steam_link_modal.reason_steam_has_progress",
      ),
    );
  });

  // The dead end this feature exists to remove: the Steam account belongs to
  // an OpenFront account created by the first launch, and the server is
  // offering to discard it. The confirmation replaces the alert entirely.
  describe("steam_has_progress with a way through", () => {
    it("opens the discard confirmation instead of the dead-end alert", async () => {
      const { openForConflict } = installModal();
      fetchSteamLinkConflictMock.mockResolvedValue({
        ok: true,
        conflict: { discardable: true, account },
      });
      setHash("#modal=account&link=steam_has_progress");

      consumeLinkResult({ modal: "account", link: "steam_has_progress" });

      await vi.waitFor(() =>
        expect(openForConflict).toHaveBeenCalledWith(account),
      );
      expect(alertMock).not.toHaveBeenCalled();
    });

    // There is genuinely no way through, and saying WHICH is what keeps the
    // player from opening a ticket to ask.
    it("names the paid block rather than the generic refusal", async () => {
      installModal();
      fetchSteamLinkConflictMock.mockResolvedValue({
        ok: true,
        conflict: { discardable: false, block: "paid" },
      });
      setHash("#modal=account&link=steam_has_progress");

      consumeLinkResult({ modal: "account", link: "steam_has_progress" });

      await vi.waitFor(() =>
        expect(alertMock).toHaveBeenCalledWith(
          "steam_link_modal.reason_discard_blocked_paid",
        ),
      );
    });

    it("falls back to the refusal when the modal is missing", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      fetchSteamLinkConflictMock.mockResolvedValue({
        ok: true,
        conflict: { discardable: true, account },
      });
      setHash("#modal=account&link=steam_has_progress");

      consumeLinkResult({ modal: "account", link: "steam_has_progress" });

      await vi.waitFor(() =>
        expect(alertMock).toHaveBeenCalledWith(
          "steam_link_modal.reason_steam_has_progress",
        ),
      );
    });

    // A throttled lookup is not a refusal, and "can't be merged" would be
    // wrong for it: the player is told how long to wait instead.
    it("names the wait when the lookup is throttled", async () => {
      installModal();
      fetchSteamLinkConflictMock.mockResolvedValue({
        ok: false,
        reason: "rate_limited",
        retryAfterSeconds: 7,
      });
      setHash("#modal=account&link=steam_has_progress");

      consumeLinkResult({ modal: "account", link: "steam_has_progress" });

      await vi.waitFor(() =>
        expect(alertMock).toHaveBeenCalledWith(
          "steam_link_modal.reason_rate_limited",
        ),
      );
    });

    it("falls back to the refusal when the lookup fails", async () => {
      const { openForConflict } = installModal();
      fetchSteamLinkConflictMock.mockResolvedValue({
        ok: false,
        reason: "failed",
      });
      setHash("#modal=account&link=steam_has_progress");

      consumeLinkResult({ modal: "account", link: "steam_has_progress" });

      await vi.waitFor(() =>
        expect(alertMock).toHaveBeenCalledWith(
          "steam_link_modal.reason_steam_has_progress",
        ),
      );
      expect(openForConflict).not.toHaveBeenCalled();
    });

    // Still one-shot: the follow-up question must not keep the param alive.
    it("still strips the param before asking", () => {
      fetchSteamLinkConflictMock.mockResolvedValue({
        ok: true,
        conflict: null,
      });
      setHash("#modal=account&link=steam_has_progress");

      consumeLinkResult({ modal: "account", link: "steam_has_progress" });

      expect(window.location.hash).toBe("#modal=account");
    });
  });

  // The handler cannot tell which provider a returning redirect came from, so
  // the generic failure has to be two values. Sharing one would tell a player
  // whose Steam link failed that their GOOGLE account could not be linked.
  it("reports a Steam failure as Steam, not as Google", () => {
    setHash("#modal=account&link=steam_error");

    consumeLinkResult({ modal: "account", link: "steam_error" });

    expect(alertMock).toHaveBeenCalledWith("account_modal.link_steam_error");
    expect(alertMock).not.toHaveBeenCalledWith(
      "account_modal.link_google_error",
    );
  });

  it("says nothing when the user cancelled at the provider", () => {
    setHash("#modal=account&link=cancel");

    consumeLinkResult({ modal: "account", link: "cancel" });

    expect(alertMock).not.toHaveBeenCalled();
  });

  // `link` is read straight off the URL hash, so it is attacker-chosen. A
  // plain object lookup inherits from Object.prototype, so these names resolve
  // to inherited members rather than undefined and would be shown to the user.
  it.each([
    "toString",
    "constructor",
    "__proto__",
    "valueOf",
    "hasOwnProperty",
  ])("says nothing for the inherited property %s", (link) => {
    setHash(`#modal=account&link=${link}`);

    consumeLinkResult({ modal: "account", link });

    expect(alertMock).not.toHaveBeenCalled();
  });

  it("says nothing for an unrecognised result", () => {
    setHash("#modal=account&link=something-new");

    consumeLinkResult({ modal: "account", link: "something-new" });

    expect(alertMock).not.toHaveBeenCalled();
  });

  it("says nothing when there is no link arg", () => {
    consumeLinkResult({ modal: "account" });

    expect(alertMock).not.toHaveBeenCalled();
  });

  // One-shot: a refresh or a re-open must not replay it.
  it("strips the param but leaves the rest of the hash", () => {
    setHash("#modal=account&link=steam");

    consumeLinkResult({ modal: "account", link: "steam" });

    expect(window.location.hash).toBe("#modal=account");
  });

  it("clears the hash entirely when link was the only param", () => {
    setHash("#link=steam");

    consumeLinkResult({ link: "steam" });

    expect(window.location.hash).toBe("");
  });
});
