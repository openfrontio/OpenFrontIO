import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showInGameAlert } from "../../src/client/InGameModal";
import { consumeLinkResult } from "../../src/client/LinkResult";

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => undefined),
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

const alertMock = vi.mocked(showInGameAlert);

function setHash(hash: string) {
  history.replaceState(null, "", hash);
}

beforeEach(() => {
  alertMock.mockClear();
});

afterEach(() => {
  history.replaceState(null, "", "/");
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
    ["steam_has_progress", "steam_link_modal.reason_steam_has_progress"],
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
  it("uses the desktop flow's own wording for the Steam refusals", () => {
    setHash("#modal=account&link=steam_has_progress");

    consumeLinkResult({ modal: "account", link: "steam_has_progress" });

    expect(alertMock).toHaveBeenCalledWith(
      "steam_link_modal.reason_steam_has_progress",
    );
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
