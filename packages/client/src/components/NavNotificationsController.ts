import { ReactiveController, ReactiveControllerHost } from "lit";
import version from "resources/version.txt?raw";
import { getCosmeticsHash } from "../Cosmetics";
import { getGamesPlayed } from "../Utils";

const HELP_SEEN_KEY = "helpSeen";
const STORE_SEEN_HASH_KEY = "storeSeenHash";
const NEWS_SEEN_VERSION_KEY = "newsSeenVersion";

export class NavNotificationsController implements ReactiveController {
  private host: ReactiveControllerHost;

  private _helpSeen = localStorage.getItem(HELP_SEEN_KEY) === "true";
  private _hasNewCosmetics = false;
  private _hasNewVersion = false;

  private get normalizedVersion(): string {
    const trimmed = version.trim();
    return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
  }

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  hostConnected(): void {
    // Check if cosmetics have changed
    getCosmeticsHash()
      .then((hash: string | null) => {
        const seenHash = localStorage.getItem(STORE_SEEN_HASH_KEY);
        this._hasNewCosmetics = hash !== null && hash !== seenHash;
        this.host.requestUpdate();
      })
      .catch(() => {});

    // Check if version has changed
    const currentVersion = this.normalizedVersion;
    const seenVersion = localStorage.getItem(NEWS_SEEN_VERSION_KEY);
    this._hasNewVersion =
      seenVersion !== null && seenVersion !== currentVersion;
    if (seenVersion === null) {
      localStorage.setItem(NEWS_SEEN_VERSION_KEY, currentVersion);
    }
  }

  hostDisconnected(): void {}

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
    localStorage.setItem(NEWS_SEEN_VERSION_KEY, this.normalizedVersion);
    this.host.requestUpdate();
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
    this.host.requestUpdate();
  };

  onHelpClick = (): void => {
    localStorage.setItem(HELP_SEEN_KEY, "true");
    this._helpSeen = true;
    this.host.requestUpdate();
  };
}
