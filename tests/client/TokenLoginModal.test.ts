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

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

  it.each([
    { status: "failed", code: "expired" },
    { status: "success", email: "old@example.com" },
  ])("ignores a $status response after close", async (result) => {
    const pending = deferred();
    tempTokenLoginMock.mockReturnValue(pending.promise);

    modal.openWithToken("old-token");
    modal.close();
    pending.resolve(result);
    await vi.advanceTimersByTimeAsync(0);

    expect(modal.isOpen()).toBe(false);
    expect(showInGameAlertMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { status: "failed", code: "invalid" },
    { status: "success", email: "old@example.com" },
  ])(
    "keeps a reopened request active after an old $status",
    async (oldResult) => {
      const oldRequest = deferred();
      const newRequest = deferred();
      tempTokenLoginMock
        .mockReturnValueOnce(oldRequest.promise)
        .mockReturnValueOnce(newRequest.promise);

      modal.openWithToken("old-token");
      modal.close();
      modal.openWithToken("new-token");
      expect(tempTokenLoginMock).toHaveBeenCalledTimes(2);

      oldRequest.resolve(oldResult);
      await vi.advanceTimersByTimeAsync(3000);
      expect(modal.isOpen()).toBe(true);
      expect(tempTokenLoginMock).toHaveBeenCalledTimes(2);
      expect(showInGameAlertMock).not.toHaveBeenCalled();
      await modal.updateComplete;
      expect(modal.textContent).not.toContain("token_login_modal.success");

      newRequest.resolve({ status: "failed", code: "expired" });
      await vi.advanceTimersByTimeAsync(0);
      expect(showInGameAlertMock).toHaveBeenCalledWith(
        "error_modal.login_token_expired",
      );
    },
  );

  it("starts a fresh request when opened again while already open", async () => {
    const oldRequest = deferred();
    const newRequest = deferred();
    tempTokenLoginMock
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);

    modal.openWithToken("token");
    modal.open();
    expect(tempTokenLoginMock).toHaveBeenCalledTimes(2);

    oldRequest.resolve({ status: "retry" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(tempTokenLoginMock).toHaveBeenCalledTimes(2);

    newRequest.resolve({ status: "failed", code: "invalid" });
    await vi.advanceTimersByTimeAsync(0);
    expect(showInGameAlertMock).toHaveBeenCalledWith(
      "error_modal.login_token_invalid",
    );
  });

  it.each([true, false])(
    "cancels a scheduled reload when reopened after success (close first: %s)",
    async (closeFirst) => {
      const nextRequest = deferred();
      tempTokenLoginMock
        .mockResolvedValueOnce({ status: "success", email: "old@example.com" })
        .mockReturnValueOnce(nextRequest.promise);

      modal.openWithToken("old-token");
      await vi.advanceTimersByTimeAsync(0);
      await modal.updateComplete;
      expect(modal.textContent).toContain("token_login_modal.success");

      if (closeFirst) modal.close();
      modal.openWithToken("new-token");
      await vi.advanceTimersByTimeAsync(1000);

      expect(modal.isOpen()).toBe(true);
      expect(tempTokenLoginMock).toHaveBeenCalledTimes(2);
      expect(showInGameAlertMock).not.toHaveBeenCalled();
      await modal.updateComplete;
      expect(modal.textContent).not.toContain("token_login_modal.success");
    },
  );

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

  it("closes after the success delay when the opening is still current", async () => {
    tempTokenLoginMock.mockResolvedValue({
      status: "success",
      email: "a@b.c",
    });
    const closeSpy = vi.spyOn(modal, "close");

    modal.openWithToken("good-token");
    await vi.advanceTimersByTimeAsync(1000);

    expect(closeSpy).toHaveBeenCalledOnce();
    expect(modal.isOpen()).toBe(false);
  });
});
