import { getDesktopSessionState } from "./Auth";
import { isDesktopShell } from "./DesktopShell";
import {
  backendReachable,
  retryServerList,
  type BackendReachabilityDetail,
} from "./ServerList";

// Main owns sign-in and the profile refresh. Keep the network and button
// triggers together so recovering one multiplayer gate also recovers the other.
export function subscribeDesktopSessionRecovery(
  signIn: () => Promise<void>,
): () => void {
  if (!isDesktopShell()) return () => {};
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
  const onRetry = () => void retry(true);
  const onOnline = () => {
    if (getDesktopSessionState().status === "signed-out") onRetry();
  };
  const onReachability = (event: Event) => {
    const next = (event as CustomEvent<BackendReachabilityDetail>).detail;
    const recovered = reachable === false && next.reachable;
    reachable = next.reachable;
    if (recovered && getDesktopSessionState().status === "signed-out") {
      void retry(false);
    }
  };
  document.addEventListener("desktop-session-retry", onRetry);
  document.addEventListener("backend-reachability", onReachability);
  window.addEventListener("online", onOnline);
  return () => {
    document.removeEventListener("desktop-session-retry", onRetry);
    document.removeEventListener("backend-reachability", onReachability);
    window.removeEventListener("online", onOnline);
  };
}
