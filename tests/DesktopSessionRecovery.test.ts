import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDesktopSessionState } from "../src/client/Auth";
import { subscribeDesktopSessionRecovery } from "../src/client/DesktopSessionRecovery";
import { backendReachable, retryServerList } from "../src/client/ServerList";

vi.mock("../src/client/Auth", () => ({ getDesktopSessionState: vi.fn() }));
vi.mock("../src/client/ServerList", () => ({
  backendReachable: vi.fn(),
  retryServerList: vi.fn(),
}));

let unsubscribe: () => void;
const signIn = vi.fn<() => Promise<void>>();

function reachability(reachable: boolean) {
  document.dispatchEvent(
    new CustomEvent("backend-reachability", {
      detail: { reachable, confirmed: !reachable },
    }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  window.openfrontDesktop = {};
  vi.mocked(getDesktopSessionState).mockReturnValue({
    status: "signed-out",
    reason: "network",
  });
  vi.mocked(backendReachable).mockReturnValue(false);
  vi.mocked(retryServerList).mockResolvedValue("fallback");
  signIn.mockResolvedValue();
});

afterEach(() => {
  unsubscribe?.();
  window.openfrontDesktop = undefined;
});

describe("desktop session recovery", () => {
  it("retries both Steam sign-in and server discovery from the session Retry", async () => {
    unsubscribe = subscribeDesktopSessionRecovery(signIn);
    document.dispatchEvent(new CustomEvent("desktop-session-retry"));
    await vi.waitFor(() => expect(signIn).toHaveBeenCalledOnce());
    expect(retryServerList).toHaveBeenCalledOnce();
  });

  it("signs back in when the server Retry or heartbeat confirms recovery", () => {
    unsubscribe = subscribeDesktopSessionRecovery(signIn);
    reachability(true);
    expect(signIn).toHaveBeenCalledOnce();
    expect(retryServerList).not.toHaveBeenCalled();
  });

  it("retries on the browser online event without waiting for the heartbeat", () => {
    unsubscribe = subscribeDesktopSessionRecovery(signIn);
    window.dispatchEvent(new Event("online"));
    expect(signIn).toHaveBeenCalledOnce();
    expect(retryServerList).toHaveBeenCalledOnce();
  });

  it("shares one recovery across simultaneous clicks and network events", async () => {
    let finish!: () => void;
    signIn.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    unsubscribe = subscribeDesktopSessionRecovery(signIn);
    document.dispatchEvent(new CustomEvent("desktop-session-retry"));
    window.dispatchEvent(new Event("online"));
    reachability(true);
    document.dispatchEvent(new CustomEvent("desktop-session-retry"));
    expect(signIn).toHaveBeenCalledOnce();
    expect(retryServerList).toHaveBeenCalledOnce();
    finish();
    await vi.waitFor(() =>
      expect(signIn.mock.results[0].value).resolves.toBeUndefined(),
    );
    document.dispatchEvent(new CustomEvent("desktop-session-retry"));
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it("does not replace a healthy session when the network returns", () => {
    vi.mocked(getDesktopSessionState).mockReturnValue({ status: "signed-in" });
    unsubscribe = subscribeDesktopSessionRecovery(signIn);
    window.dispatchEvent(new Event("online"));
    reachability(true);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("does not retry on repeated failures or the first healthy startup probe", () => {
    vi.mocked(backendReachable).mockReturnValue(null);
    unsubscribe = subscribeDesktopSessionRecovery(signIn);
    reachability(true);
    reachability(false);
    reachability(false);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("does not use Steam recovery on the web", () => {
    window.openfrontDesktop = undefined;
    unsubscribe = subscribeDesktopSessionRecovery(signIn);
    window.dispatchEvent(new Event("online"));
    reachability(true);
    document.dispatchEvent(new CustomEvent("desktop-session-retry"));
    expect(signIn).not.toHaveBeenCalled();
    expect(retryServerList).not.toHaveBeenCalled();
  });
});
