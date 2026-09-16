import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDesktopSessionState } from "../src/client/Auth";
import { subscribeDesktopSessionRecovery } from "../src/client/DesktopSessionRecovery";
import type { SessionFailureKind } from "../src/client/DesktopShell";
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

  // Only the AUTOMATIC triggers are desktop-only. The manual Retry listener
  // has to be registered on every boot: the status bar dispatches
  // `desktop-session-retry` and nothing else listens for it, so gating it
  // here would leave the event with no handler at all on the web -- which
  // silently breaks tests/client/MainInitialize.test.ts, a web boot that
  // dispatches exactly this event and waits for the sign-in it should drive.
  it("ignores the connectivity triggers on the web", () => {
    window.openfrontDesktop = undefined;
    unsubscribe = subscribeDesktopSessionRecovery(signIn);
    window.dispatchEvent(new Event("online"));
    reachability(true);
    expect(signIn).not.toHaveBeenCalled();
    expect(retryServerList).not.toHaveBeenCalled();
  });

  it("still honours the manual Retry on the web", () => {
    window.openfrontDesktop = undefined;
    unsubscribe = subscribeDesktopSessionRecovery(signIn);
    document.dispatchEvent(new CustomEvent("desktop-session-retry"));
    expect(signIn).toHaveBeenCalledOnce();
  });

  // The automatic triggers fire on a connectivity change, so they should only
  // re-attempt failures a connectivity change can fix. A wedged Steam session
  // needs a Steam restart, an absent Steam client needs Steam started, and a
  // refused ticket will be refused identically -- retrying any of them costs a
  // ticket mint plus a round trip to fail the same way.
  it.each(["steam-wedged", "steam-unavailable", "steam-ticket-rejected"])(
    "does not auto-retry %s, which reconnecting cannot fix",
    (reason) => {
      vi.mocked(getDesktopSessionState).mockReturnValue({
        status: "signed-out",
        reason: reason as SessionFailureKind,
      });
      unsubscribe = subscribeDesktopSessionRecovery(signIn);
      window.dispatchEvent(new Event("online"));
      reachability(false);
      reachability(true);
      expect(signIn).not.toHaveBeenCalled();
    },
  );

  // ...but the player asking explicitly always retries, whatever the reason.
  // They may know something we don't, such as having just restarted Steam.
  it("honours the manual Retry even for a reason auto-retry skips", () => {
    vi.mocked(getDesktopSessionState).mockReturnValue({
      status: "signed-out",
      reason: "steam-wedged",
    });
    unsubscribe = subscribeDesktopSessionRecovery(signIn);
    document.dispatchEvent(new CustomEvent("desktop-session-retry"));
    expect(signIn).toHaveBeenCalledOnce();
  });

  // needs-account is deliberately IN the auto-retry set, for the one case
  // that survives: a player can finish linking on the website while the game
  // is open, after which an account exists and a retry signs them in. (It was
  // also transient back when the shell reported an unreachable status
  // endpoint as needs-account; openfront-desktop#91 fixed that.)
  it("auto-retries needs-account when reachability recovers", () => {
    vi.mocked(getDesktopSessionState).mockReturnValue({
      status: "signed-out",
      reason: "needs-account",
    });
    unsubscribe = subscribeDesktopSessionRecovery(signIn);
    reachability(false);
    reachability(true);
    expect(signIn).toHaveBeenCalledOnce();
  });
});
