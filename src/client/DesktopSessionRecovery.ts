import { getDesktopSessionState } from "./Auth";
import { isDesktopShell, type SessionFailureKind } from "./DesktopShell";
import {
  backendReachable,
  retryServerList,
  type BackendReachabilityDetail,
} from "./ServerList";

/**
 * Signed-out reasons an automatic retry can plausibly resolve.
 *
 * The manual Retry button always retries, whatever the reason — the player
 * asked, and they may know something we don't (they just restarted Steam).
 * The automatic triggers are different: they fire on a connectivity change,
 * so they should only re-attempt failures a connectivity change can fix.
 * Everything else costs a Steam ticket mint plus a round trip to fail in
 * exactly the same way.
 *
 * Deliberately absent, because no amount of reconnecting changes them:
 *
 * - `steam-unavailable` — Steam is not running. Coming back online does not
 *   start it.
 * - `steam-wedged` — the ticket call timed out. Only a Steam restart has ever
 *   cleared this (see retrySteamSignIn's note); a silent retry buys nothing
 *   and delays the message telling the player what to do.
 * - `steam-ticket-rejected` — a completed 401. Steam looked at the ticket and
 *   said no; the next ticket is refused identically.
 *
 * `needs-account` IS included, deliberately, though it is now the weakest
 * member of this set. It used to be here mainly because the shell reported an
 * unreachable status endpoint as `needs-account`, which made it genuinely
 * transient; openfront-desktop#91 and #5465 fixed that, so an API outage now
 * arrives as `network` and this reason means what it says.
 *
 * What keeps it here is the remaining case: a player can complete linking on
 * the website while the game is open, after which an account exists and a
 * retry signs them in. Reconnecting is a weak proxy for "they finished
 * linking in a browser", so this is one cheap, single-flighted attempt on a
 * chance — not a reason a connectivity change reliably fixes. Drop it if that
 * ever looks like wasted work.
 */
const AUTO_RETRY_REASONS: ReadonlySet<SessionFailureKind> = new Set([
  "network",
  "steam-backend",
  "steam-error",
  "needs-account",
]);

/** Whether an automatic (connectivity-driven) retry is worth attempting. */
function worthAutoRetrying(): boolean {
  const state = getDesktopSessionState();
  if (state.status !== "signed-out") return false;
  // A signed-out state with no reason at all is the generic failure; retrying
  // it on reconnect is the behaviour this module exists to add.
  return state.reason === undefined || AUTO_RETRY_REASONS.has(state.reason);
}

/**
 * Wires up desktop session recovery and returns an unsubscribe function.
 *
 * Main owns sign-in and the profile refresh. Keeping the network and button
 * triggers together means recovering one multiplayer gate also recovers the
 * other: a session that comes back is useless if the server list is still
 * cached as unreachable, and vice versa.
 *
 * The manual `desktop-session-retry` listener is registered on EVERY boot,
 * desktop or web. The status bar dispatches that event and nothing else
 * listens for it, so gating it behind `isDesktopShell()` would leave the
 * event with no handler at all on a web boot.
 *
 * Only the automatic triggers — `online` and `backend-reachability` — are
 * desktop-only, because only the desktop shell has a Steam session to
 * recover.
 *
 * @param signIn Re-runs Steam sign-in and refreshes the profile.
 * @returns A cleanup function that removes every listener registered here.
 */
export function subscribeDesktopSessionRecovery(
  signIn: () => Promise<void>,
): () => void {
  let reachable = backendReachable();
  let retrying = false;
  const retry = async (checkServers: boolean) => {
    if (retrying) return;
    retrying = true;
    try {
      await Promise.all([
        signIn(),
        checkServers ? retryServerList() : Promise.resolve(),
      ]);
    } catch (err) {
      console.error("Desktop session recovery failed", err);
    } finally {
      retrying = false;
    }
  };
  // The player asked, so this retries regardless of reason.
  const onRetry = () => void retry(true);
  document.addEventListener("desktop-session-retry", onRetry);

  if (!isDesktopShell()) {
    return () => {
      document.removeEventListener("desktop-session-retry", onRetry);
    };
  }

  const onOnline = () => {
    if (worthAutoRetrying()) void retry(true);
  };
  const onReachability = (event: Event) => {
    const next = (event as CustomEvent<BackendReachabilityDetail>).detail;
    // Only a false -> true transition is a recovery. `backendReachable()` is
    // null before the first attempt settles, and null -> true is a first
    // answer rather than a recovery, so it must not trigger a retry.
    const recovered = reachable === false && next.reachable;
    reachable = next.reachable;
    if (recovered && worthAutoRetrying()) void retry(false);
  };
  document.addEventListener("backend-reachability", onReachability);
  window.addEventListener("online", onOnline);
  return () => {
    document.removeEventListener("desktop-session-retry", onRetry);
    document.removeEventListener("backend-reachability", onReachability);
    window.removeEventListener("online", onOnline);
  };
}
