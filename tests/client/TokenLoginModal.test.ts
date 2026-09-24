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

  it.each([
    ["expired", "error_modal.login_token_expired"],
    ["invalid", "error_modal.login_token_invalid"],
    ["consumed", "error_modal.login_token_consumed"],
  ])(
    "shows the %s message immediately and stops retrying",
    async (code, message) => {
      tempTokenLoginMock.mockResolvedValue({ status: "failed", code });

      modal.openWithToken("bad-token");
      expect(tempTokenLoginMock).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(0);

      expect(modal.isOpen()).toBe(false);
      expect(showInGameAlertMock).toHaveBeenCalledWith(message);

      await vi.advanceTimersByTimeAsync(15000);
      expect(tempTokenLoginMock).toHaveBeenCalledOnce();
    },
  );

  it("keeps polling on a transient (retry) result", async () => {
    tempTokenLoginMock.mockResolvedValue({ status: "retry" });

    modal.openWithToken("tok");
    expect(tempTokenLoginMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);

    expect(tempTokenLoginMock).toHaveBeenCalledTimes(3);
    expect(showInGameAlertMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(6000);
    expect(tempTokenLoginMock).toHaveBeenCalledTimes(4);
    expect(showInGameAlertMock).toHaveBeenCalledWith(
      "error_modal.login_failed",
    );
  });

  it("cancels retries when the modal closes", async () => {
    tempTokenLoginMock.mockResolvedValue({ status: "retry" });

    modal.openWithToken("tok");
    expect(tempTokenLoginMock).toHaveBeenCalledOnce();
    modal.close();

    await vi.advanceTimersByTimeAsync(15000);
    expect(tempTokenLoginMock).toHaveBeenCalledOnce();
    expect(showInGameAlertMock).not.toHaveBeenCalled();
  });

  it("still logs in successfully on a success result", async () => {
    tempTokenLoginMock.mockResolvedValue({
      status: "success",
      email: "a@b.c",
    });

    modal.openWithToken("good-token");
    expect(tempTokenLoginMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);

    expect(tempTokenLoginMock).toHaveBeenCalledTimes(1);
    expect(showInGameAlertMock).not.toHaveBeenCalled();
    expect(modal.isOpen()).toBe(true);
    await modal.updateComplete;
    expect(modal.textContent).toContain("token_login_modal.success");
  });
});
