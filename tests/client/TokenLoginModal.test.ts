import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tempTokenLoginMock, showInGameAlertMock } = vi.hoisted(() => ({
  tempTokenLoginMock: vi.fn(),
  showInGameAlertMock: vi.fn(async () => true),
}));

vi.mock("../../src/client/Auth", () => ({
  tempTokenLogin: tempTokenLoginMock,
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: showInGameAlertMock,
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));

import { TokenLoginModal } from "../../src/client/TokenLoginModal";

describe("TokenLoginModal — retry loop", () => {
  let modal: TokenLoginModal;

  beforeEach(async () => {
    vi.useFakeTimers();
    tempTokenLoginMock.mockReset();
    showInGameAlertMock.mockClear();
    if (!customElements.get("token-login")) {
      customElements.define("token-login", TokenLoginModal);
    }
    modal = document.createElement("token-login") as TokenLoginModal;
    document.body.appendChild(modal);
    await modal.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(modal);
    vi.useRealTimers();
  });

  // The bug: a 400 (invalid/expired/consumed — all final) used to be treated
  // like a transient failure, so the modal kept polling every 3s until
  // attemptCount > 3 — 4 wasted requests and ~12s of spinner for a link that
  // was never going to succeed.
  it("stops polling after a single failed 400 instead of retrying up to 4 times", async () => {
    tempTokenLoginMock.mockResolvedValue({ status: "failed", code: "invalid" });

    modal.openWithToken("bad-token");
    await vi.advanceTimersByTimeAsync(3000);

    expect(tempTokenLoginMock).toHaveBeenCalledTimes(1);
    expect(modal.isOpen()).toBe(false);
    expect(showInGameAlertMock).toHaveBeenCalledWith(
      "error_modal.login_failed",
    );

    // Advancing well past what would have been the 4-attempt window must not
    // trigger any further calls — the interval was cleared.
    await vi.advanceTimersByTimeAsync(15000);
    expect(tempTokenLoginMock).toHaveBeenCalledTimes(1);
  });

  it("shows the consumed-specific message when the token was already used", async () => {
    tempTokenLoginMock.mockResolvedValue({
      status: "failed",
      code: "consumed",
    });

    modal.openWithToken("used-token");
    await vi.advanceTimersByTimeAsync(3000);

    expect(showInGameAlertMock).toHaveBeenCalledWith(
      "error_modal.login_token_consumed",
    );
  });

  it("keeps polling on a transient (retry) result", async () => {
    tempTokenLoginMock.mockResolvedValue({ status: "retry" });

    modal.openWithToken("tok");
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);

    expect(tempTokenLoginMock).toHaveBeenCalledTimes(2);
    expect(showInGameAlertMock).not.toHaveBeenCalled();
  });

  it("still logs in successfully on a success result", async () => {
    tempTokenLoginMock.mockResolvedValue({
      status: "success",
      email: "a@b.c",
    });

    modal.openWithToken("good-token");
    await vi.advanceTimersByTimeAsync(3000);

    expect(tempTokenLoginMock).toHaveBeenCalledTimes(1);
    expect(showInGameAlertMock).not.toHaveBeenCalled();
  });
});
