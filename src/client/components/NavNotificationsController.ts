import { ReactiveController, ReactiveControllerHost } from "lit";
import version from "resources/version.txt?raw";
import { getCosmeticsHash } from "../Cosmetics";
import { getGamesPlayed } from "../Utils";

const HELP_SEEN_KEY = "helpSeen";
const STORE_SEEN_HASH_KEY = "storeSeenHash";
const NEWS_SEEN_VERSION_KEY = "newsSeenVersion";

function normalizedVersion(): string {
  const trimmed = version.trim();
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

/**
 * Shared dot state for the nav.
 *
 * One store, not one per component: the dots are prioritised against each
 * other (news > store > help), and the affordances now live in different
 * components — the bell and "?" in <nav-utility-icons>, the store in the nav
 * bars. With per-component state, dismissing the bell left the other
 * components' copy of `hasNewVersion` set, so the store dot stayed suppressed
 * until a reload.
 */
class NavNotificationsStore {
  private hosts = new Set<ReactiveControllerHost>();
  private loaded = false;

  private _helpSeen = false;
  private _hasNewCosmetics = false;
  private _hasNewVersion = false;

  subscribe(host: ReactiveControllerHost): void {
    this.hosts.add(host);
    this.load();
  }

  unsubscribe(host: ReactiveControllerHost): void {
    this.hosts.delete(host);
  }

  private notify(): void {
    for (const host of this.hosts) host.requestUpdate();
  }

  // Read once per page load; every later subscriber reuses the result.
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;

    this._helpSeen = localStorage.getItem(HELP_SEEN_KEY) === "true";

    getCosmeticsHash()
      .then((hash: string | null) => {
        const seenHash = localStorage.getItem(STORE_SEEN_HASH_KEY);
        this._hasNewCosmetics = hash !== null && hash !== seenHash;
        this.notify();
      })
      .catch(() => {});

    const currentVersion = normalizedVersion();
    const seenVersion = localStorage.getItem(NEWS_SEEN_VERSION_KEY);
    this._hasNewVersion =
      seenVersion !== null && seenVersion !== currentVersion;
    if (seenVersion === null) {
      localStorage.setItem(NEWS_SEEN_VERSION_KEY, currentVersion);
    }
  }

  // Only show one dot at a time to prevent
  // overwhelming users. Priority: News > Store > Help.
  showNewsDot(): boolean {
    return this._hasNewVersion;
  }

  showStoreDot(): boolean {
    return this._hasNewCosmetics && !this.showNewsDot();
  }

  showHelpDot(): boolean {
    return (
      getGamesPlayed() < 10 &&
      !this._helpSeen &&
      !this.showNewsDot() &&
      !this.showStoreDot()
    );
  }

  onNewsClick = (): void => {
    this._hasNewVersion = false;
    localStorage.setItem(NEWS_SEEN_VERSION_KEY, normalizedVersion());
    this.notify();
  };

  onStoreClick = (): void => {
    this._hasNewCosmetics = false;
    getCosmeticsHash()
      .then((hash: string | null) => {
        if (hash !== null) {
          localStorage.setItem(STORE_SEEN_HASH_KEY, hash);
        }
      })
      .catch(() => {});
    this.notify();
  };

  onHelpClick = (): void => {
    localStorage.setItem(HELP_SEEN_KEY, "true");
    this._helpSeen = true;
    this.notify();
  };

  /** Test seam: drop all state so a fresh load re-reads localStorage. */
  reset(): void {
    this.hosts.clear();
    this.loaded = false;
    this._helpSeen = false;
    this._hasNewCosmetics = false;
    this._hasNewVersion = false;
  }
}

export const navNotifications = new NavNotificationsStore();

/**
 * Host-facing view of {@link navNotifications}: keeps the component subscribed
 * for its lifetime and forwards the dot queries and click handlers.
 */
export class NavNotificationsController implements ReactiveController {
  private host: ReactiveControllerHost;

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  hostConnected(): void {
    navNotifications.subscribe(this.host);
  }

  hostDisconnected(): void {
    navNotifications.unsubscribe(this.host);
  }

  showNewsDot(): boolean {
    return navNotifications.showNewsDot();
  }

  showStoreDot(): boolean {
    return navNotifications.showStoreDot();
  }

  showHelpDot(): boolean {
    return navNotifications.showHelpDot();
  }

  onNewsClick = (): void => navNotifications.onNewsClick();
  onStoreClick = (): void => navNotifications.onStoreClick();
  onHelpClick = (): void => navNotifications.onHelpClick();
}
