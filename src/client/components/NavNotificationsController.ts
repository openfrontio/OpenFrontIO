import { ReactiveController, ReactiveControllerHost } from "lit";
import version from "resources/version.txt?raw";
import type { FriendEntry, UserMeResponse } from "../../core/ApiSchemas";
import { responseHasLinkedIdentity } from "../AccountIdentity";
import { getCosmeticsHash } from "../Cosmetics";
import { crazyGamesSDK } from "../CrazyGamesSDK";
import {
  fetchFriendRequests,
  FRIEND_REQUESTS_UPDATED_EVENT,
  publishFriendRequests,
} from "../FriendsApi";
import { latestUserMeResponse } from "../NavAccountButton";
import { getGamesPlayed } from "../Utils";

const HELP_SEEN_KEY = "helpSeen";
const STORE_SEEN_HASH_KEY = "storeSeenHash";
const NEWS_SEEN_VERSION_KEY = "newsSeenVersion";
const FRIEND_REQUEST_POLL_MS = 60_000;

function normalizedVersion(): string {
  const trimmed = version.trim();
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

/**
 * Shared notification state for the nav.
 *
 * One store, not one per component: desktop and mobile can both render the
 * utility cluster, but only one poller should fetch friend requests. The dots
 * are also prioritised against each other (bell > store > help), so dismissing
 * one notification must update every component before revealing the next.
 */
class NavNotificationsStore {
  private hosts = new Set<ReactiveControllerHost>();
  private loaded = false;

  private _helpSeen = false;
  private _hasNewCosmetics = false;
  private _hasNewVersion = false;
  private _friendRequests: FriendEntry[] = [];

  private friendRequestsEnabled = false;
  private friendRequestPoll: number | null = null;
  private friendRequestFetch: {
    generation: number;
    promise: Promise<void>;
  } | null = null;
  private authGeneration = 0;
  private friendRequestsRevision = 0;

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

  // Read and attach once per page load; every later subscriber reuses the
  // result and, importantly, the same friend-request interval.
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

    document.addEventListener("userMeResponse", this.handleUserMeResponse);
    document.addEventListener(
      FRIEND_REQUESTS_UPDATED_EVENT,
      this.handleFriendRequestsUpdated,
    );
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("focus", this.handleFocus);

    // Auth normally resolves before late-created mobile/desktop nav instances.
    // Seed from its cache so such an instance does not wait for an event that
    // has already fired.
    const cached = latestUserMeResponse();
    if (cached !== null) this.applyUserMeResponse(cached);
  }

  private handleUserMeResponse = (event: Event): void => {
    this.applyUserMeResponse(
      (event as CustomEvent<UserMeResponse | false>).detail,
    );
  };

  private applyUserMeResponse(response: UserMeResponse | false): void {
    const generation = ++this.authGeneration;
    this.stopFriendRequestPolling();
    this.friendRequestsEnabled = false;
    this.setFriendRequests([]);

    if (responseHasLinkedIdentity(response)) {
      this.startFriendRequestPolling(generation);
      return;
    }

    // CrazyGames owns its identity outside UserMeResponse. Once its token has
    // produced a backend session, the friends API is available even though no
    // Discord/Google/email/Steam identity appears in the response.
    if (response !== false && crazyGamesSDK.isOnCrazyGames()) {
      void crazyGamesSDK
        .getUserProfile()
        .then((profile) => {
          if (generation !== this.authGeneration || profile === null) return;
          this.startFriendRequestPolling(generation);
        })
        .catch(() => {});
    }
  }

  private startFriendRequestPolling(generation: number): void {
    if (generation !== this.authGeneration) return;
    this.friendRequestsEnabled = true;
    this.friendRequestPoll = window.setInterval(
      () => void this.refreshFriendRequests(),
      FRIEND_REQUEST_POLL_MS,
    );
    void this.refreshFriendRequests();
  }

  private stopFriendRequestPolling(): void {
    if (this.friendRequestPoll !== null) {
      window.clearInterval(this.friendRequestPoll);
      this.friendRequestPoll = null;
    }
  }

  private handleVisibilityChange = (): void => {
    if (!document.hidden) void this.refreshFriendRequests();
  };

  private handleFocus = (): void => {
    void this.refreshFriendRequests();
  };

  private handleFriendRequestsUpdated = (event: Event): void => {
    if (!this.friendRequestsEnabled) return;
    // Any published snapshot is newer than a poll already in flight. Remember
    // that publication so the older response cannot resurrect a request that
    // was just accepted, denied, or withdrawn in the Friends tab.
    this.friendRequestsRevision++;
    this.setFriendRequests(
      (event as CustomEvent<{ incoming: FriendEntry[] }>).detail.incoming,
    );
  };

  private setFriendRequests(requests: FriendEntry[]): void {
    const unchanged =
      requests.length === this._friendRequests.length &&
      requests.every((request, index) => {
        const current = this._friendRequests[index];
        return (
          current?.publicId === request.publicId &&
          current.username === request.username &&
          current.createdAt === request.createdAt
        );
      });
    if (unchanged) return;
    this._friendRequests = [...requests];
    this.notify();
  }

  async refreshFriendRequests(): Promise<void> {
    if (!this.friendRequestsEnabled || document.hidden) return;
    if (this.friendRequestFetch?.generation === this.authGeneration) {
      return this.friendRequestFetch.promise;
    }

    const generation = this.authGeneration;
    const requestsRevision = this.friendRequestsRevision;
    const request = (async () => {
      const requests = await fetchFriendRequests();
      if (
        requests === false ||
        generation !== this.authGeneration ||
        requestsRevision !== this.friendRequestsRevision ||
        !this.friendRequestsEnabled
      ) {
        return;
      }
      publishFriendRequests(requests);
    })();
    this.friendRequestFetch = { generation, promise: request };
    try {
      await request;
    } finally {
      if (this.friendRequestFetch?.promise === request) {
        this.friendRequestFetch = null;
      }
    }
  }

  currentVersion(): string {
    return normalizedVersion();
  }

  hasNewVersion(): boolean {
    return this._hasNewVersion;
  }

  friendRequests(): readonly FriendEntry[] {
    return this._friendRequests;
  }

  // Only show one nav dot at a time to prevent overwhelming users. The bell
  // represents both release and friend notifications and wins the priority.
  showBellDot(): boolean {
    return this._hasNewVersion || this._friendRequests.length > 0;
  }

  showStoreDot(): boolean {
    return this._hasNewCosmetics && !this.showBellDot();
  }

  showHelpDot(): boolean {
    return (
      getGamesPlayed() < 10 &&
      !this._helpSeen &&
      !this.showBellDot() &&
      !this.showStoreDot()
    );
  }

  markVersionSeen(): void {
    this._hasNewVersion = false;
    localStorage.setItem(NEWS_SEEN_VERSION_KEY, normalizedVersion());
    this.notify();
  }

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
    if (this.loaded) {
      document.removeEventListener("userMeResponse", this.handleUserMeResponse);
      document.removeEventListener(
        FRIEND_REQUESTS_UPDATED_EVENT,
        this.handleFriendRequestsUpdated,
      );
      document.removeEventListener(
        "visibilitychange",
        this.handleVisibilityChange,
      );
      window.removeEventListener("focus", this.handleFocus);
    }
    this.stopFriendRequestPolling();
    this.authGeneration++;
    this.hosts.clear();
    this.loaded = false;
    this._helpSeen = false;
    this._hasNewCosmetics = false;
    this._hasNewVersion = false;
    this._friendRequests = [];
    this.friendRequestsEnabled = false;
    this.friendRequestFetch = null;
    this.friendRequestsRevision = 0;
  }
}

export const navNotifications = new NavNotificationsStore();

/**
 * Host-facing view of {@link navNotifications}: keeps the component subscribed
 * for its lifetime and forwards notification state and actions.
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

  currentVersion(): string {
    return navNotifications.currentVersion();
  }

  hasNewVersion(): boolean {
    return navNotifications.hasNewVersion();
  }

  friendRequests(): readonly FriendEntry[] {
    return navNotifications.friendRequests();
  }

  showBellDot(): boolean {
    return navNotifications.showBellDot();
  }

  showStoreDot(): boolean {
    return navNotifications.showStoreDot();
  }

  showHelpDot(): boolean {
    return navNotifications.showHelpDot();
  }

  markVersionSeen(): void {
    navNotifications.markVersionSeen();
  }

  onStoreClick = (): void => navNotifications.onStoreClick();
  onHelpClick = (): void => navNotifications.onHelpClick();
}
