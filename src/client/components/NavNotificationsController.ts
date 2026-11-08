import type { FriendEntry, UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { LobbyInvite } from "@openfront/shared/LobbyInviteSchemas";
import { ReactiveController, ReactiveControllerHost } from "lit";
import version from "resources/version.txt?raw";
import { responseHasLinkedIdentity } from "../AccountIdentity";
import { getCosmeticsHash } from "../Cosmetics";
import { crazyGamesSDK } from "../CrazyGamesSDK";
import {
  fetchFriendRequests,
  FRIEND_REQUESTS_UPDATED_EVENT,
  type FriendRequestsSnapshot,
  nextFriendRequestsSeq,
  publishFriendRequests,
} from "../FriendsApi";
import {
  dismissLobbyInvite as dismissLobbyInviteApi,
  fetchLobbyInvites,
} from "../LobbyInviteApi";
import { latestUserMeResponse } from "../NavAccountButton";
import { getGamesPlayed } from "../Utils";

const HELP_SEEN_KEY = "helpSeen";
const STORE_SEEN_HASH_KEY = "storeSeenHash";
const NEWS_SEEN_VERSION_KEY = "newsSeenVersion";
const FRIEND_REQUEST_POLL_MS = 60_000;
const LOBBY_INVITE_POLL_MS = 15_000;

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
  private _lobbyInvites: LobbyInvite[] = [];

  private currentPublicId: string | null = null;
  private lobbyInvitePoll: number | null = null;
  private lobbyInviteTicker: number | null = null;
  private nextLobbyInviteSeq = 0;
  private appliedLobbyInviteSeq = 0;
  private lobbyInviteServerOffsetMs = 0;
  // Tracks locally dismissed invite IDs -> createdAt timestamp so stale polls or failed dismiss calls do not resurrect them.
  private dismissedInviteCreatedAt = new Map<string, number>();

  private friendRequestsEnabled = false;
  private friendRequestPollingPaused = false;
  private friendRequestPollingGeneration = 0;
  private friendRequestPoll: number | null = null;
  private friendRequestFetch: {
    authGeneration: number;
    pollingGeneration: number;
    promise: Promise<void>;
  } | null = null;
  private authGeneration = 0;
  // Seq of the snapshot on the bell; see nextFriendRequestsSeq.
  private friendRequestsSeq = 0;

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
    this.friendRequestPollingPaused =
      document.body.classList.contains("in-game");

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
    document.addEventListener("game-starting", this.handleGameStarting);
    document.addEventListener("menu-restored", this.handleMenuRestored);
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
    this.stopLobbyInvitePolling();
    this.friendRequestsEnabled = false;
    this.setFriendRequests([]);
    this.setLobbyInvites([]);

    if (response !== false && response.player?.publicId) {
      this.currentPublicId = response.player.publicId;
      this.startLobbyInvitePolling();
    } else {
      this.currentPublicId = null;
    }

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
    if (this.friendRequestPollingPaused) return;
    this.beginFriendRequestPolling();
  }

  private beginFriendRequestPolling(): void {
    if (this.friendRequestPoll !== null) return;
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

  private startLobbyInvitePolling(): void {
    if (!this.currentPublicId || this.friendRequestPollingPaused) return;
    this.beginLobbyInvitePolling();
  }

  private beginLobbyInvitePolling(): void {
    this.lobbyInvitePoll ??= window.setInterval(
      () => void this.refreshLobbyInvites(),
      LOBBY_INVITE_POLL_MS,
    );
    this.lobbyInviteTicker ??= window.setInterval(
      () => this.pruneLobbyInvitesTick(),
      1000,
    );
    void this.refreshLobbyInvites();
  }

  private stopLobbyInvitePolling(): void {
    this.appliedLobbyInviteSeq = this.nextLobbyInviteSeq;
    if (this.lobbyInvitePoll !== null) {
      window.clearInterval(this.lobbyInvitePoll);
      this.lobbyInvitePoll = null;
    }
    if (this.lobbyInviteTicker !== null) {
      window.clearInterval(this.lobbyInviteTicker);
      this.lobbyInviteTicker = null;
    }
  }

  private serverNow(): number {
    return Date.now() + this.lobbyInviteServerOffsetMs;
  }

  /**
   * Computes the remaining seconds before `invite` expires using server-adjusted time.
   */
  inviteRemainingSeconds(invite: Pick<LobbyInvite, "expiresAt">): number {
    return Math.max(1, Math.ceil((invite.expiresAt - this.serverNow()) / 1000));
  }

  private pruneLobbyInvitesTick(): void {
    const now = this.serverNow();
    const active = this._lobbyInvites.filter((inv) => inv.expiresAt > now);
    if (active.length !== this._lobbyInvites.length) {
      this._lobbyInvites = active;
      this.notify();
    } else if (active.length > 0) {
      this.notify();
    }
  }

  private setLobbyInvites(invites: LobbyInvite[]): void {
    this._lobbyInvites = invites;
    this.notify();
  }

  async refreshLobbyInvites(): Promise<void> {
    if (
      !this.currentPublicId ||
      this.friendRequestPollingPaused ||
      document.hidden
    ) {
      return;
    }
    const authGeneration = this.authGeneration;
    const pollingGeneration = this.friendRequestPollingGeneration;
    const refreshSeq = ++this.nextLobbyInviteSeq;
    const publicId = this.currentPublicId;
    const result = await fetchLobbyInvites(publicId);
    if (
      authGeneration !== this.authGeneration ||
      pollingGeneration !== this.friendRequestPollingGeneration ||
      this.currentPublicId !== publicId ||
      this.friendRequestPollingPaused
    ) {
      return;
    }
    if (result === false) {
      this.pruneLobbyInvitesTick();
      return;
    }
    if (refreshSeq <= this.appliedLobbyInviteSeq) {
      return;
    }
    this.appliedLobbyInviteSeq = refreshSeq;
    if (
      typeof result.serverTime === "number" &&
      Number.isFinite(result.serverTime)
    ) {
      this.lobbyInviteServerOffsetMs = result.serverTime - Date.now();
    }
    const now = this.serverNow();
    this._lobbyInvites = result.invites.filter((inv) => {
      if (inv.expiresAt <= now) return false;
      const dismissedCreatedAt = this.dismissedInviteCreatedAt.get(inv.id);
      if (dismissedCreatedAt !== undefined) {
        if (inv.createdAt <= dismissedCreatedAt) {
          return false;
        }
        this.dismissedInviteCreatedAt.delete(inv.id);
      }
      return true;
    });
    this.notify();
  }

  dismissLobbyInvite(inviteId: string): void {
    const existing = this._lobbyInvites.find((i) => i.id === inviteId);
    this.dismissedInviteCreatedAt.set(
      inviteId,
      existing?.createdAt ?? this.serverNow(),
    );
    this._lobbyInvites = this._lobbyInvites.filter((i) => i.id !== inviteId);
    this.notify();
    if (this.currentPublicId) {
      const publicId = this.currentPublicId;
      void dismissLobbyInviteApi(publicId, inviteId).then((ok) => {
        if (!ok) {
          console.warn(
            "Failed to dismiss lobby invite on server; keeping local dismissal tombstone",
            inviteId,
          );
        }
      });
    }
  }

  private handleGameStarting = (): void => {
    if (this.friendRequestPollingPaused) return;
    this.friendRequestPollingPaused = true;
    this.stopFriendRequestPolling();
    this.stopLobbyInvitePolling();

    // Let a restored menu start a fresh request immediately even if a request
    // from before the match is still in flight. Its generation check below
    // prevents that older response from publishing after the menu returns.
    this.friendRequestPollingGeneration++;
    this.friendRequestFetch = null;
  };

  private handleMenuRestored = (): void => {
    if (!this.friendRequestPollingPaused) return;
    this.friendRequestPollingPaused = false;
    if (this.friendRequestsEnabled) this.beginFriendRequestPolling();
    if (this.currentPublicId) this.beginLobbyInvitePolling();
  };

  private handleVisibilityChange = (): void => {
    if (!document.hidden) {
      void this.refreshFriendRequests();
      void this.refreshLobbyInvites();
    }
  };

  private handleFocus = (): void => {
    void this.refreshFriendRequests();
    void this.refreshLobbyInvites();
  };

  private handleFriendRequestsUpdated = (event: Event): void => {
    if (!this.friendRequestsEnabled) return;
    const snapshot = (event as CustomEvent<FriendRequestsSnapshot>).detail;
    // Keep the highest seq: a poll that started before the Friends tab's edit
    // or refetch must not resurrect a request it has since resolved, however
    // late its response arrives.
    if (snapshot.seq <= this.friendRequestsSeq) return;
    this.friendRequestsSeq = snapshot.seq;
    this.setFriendRequests(snapshot.incoming);
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
    if (
      !this.friendRequestsEnabled ||
      this.friendRequestPollingPaused ||
      document.hidden
    ) {
      return;
    }
    if (
      this.friendRequestFetch?.authGeneration === this.authGeneration &&
      this.friendRequestFetch.pollingGeneration ===
        this.friendRequestPollingGeneration
    ) {
      return this.friendRequestFetch.promise;
    }

    const authGeneration = this.authGeneration;
    const pollingGeneration = this.friendRequestPollingGeneration;
    const seq = nextFriendRequestsSeq();
    const request = (async () => {
      const requests = await fetchFriendRequests();
      if (
        requests === false ||
        authGeneration !== this.authGeneration ||
        pollingGeneration !== this.friendRequestPollingGeneration ||
        !this.friendRequestsEnabled ||
        this.friendRequestPollingPaused
      ) {
        return;
      }
      publishFriendRequests(requests, seq);
    })();
    this.friendRequestFetch = {
      authGeneration,
      pollingGeneration,
      promise: request,
    };
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

  lobbyInvites(): readonly LobbyInvite[] {
    return this._lobbyInvites;
  }

  // Only show one nav dot at a time to prevent overwhelming users. The bell
  // represents release, friend, and lobby invite notifications and wins the priority.
  showBellDot(): boolean {
    return (
      this._hasNewVersion ||
      this._friendRequests.length > 0 ||
      this._lobbyInvites.length > 0
    );
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
      document.removeEventListener("game-starting", this.handleGameStarting);
      document.removeEventListener("menu-restored", this.handleMenuRestored);
      document.removeEventListener(
        "visibilitychange",
        this.handleVisibilityChange,
      );
      window.removeEventListener("focus", this.handleFocus);
    }
    this.stopFriendRequestPolling();
    this.stopLobbyInvitePolling();
    this.authGeneration++;
    this.hosts.clear();
    this.loaded = false;
    this._helpSeen = false;
    this._hasNewCosmetics = false;
    this._hasNewVersion = false;
    this._friendRequests = [];
    this._lobbyInvites = [];
    this.nextLobbyInviteSeq = 0;
    this.appliedLobbyInviteSeq = 0;
    this.lobbyInviteServerOffsetMs = 0;
    this.dismissedInviteCreatedAt.clear();
    this.currentPublicId = null;
    this.friendRequestsEnabled = false;
    this.friendRequestPollingPaused = false;
    this.friendRequestPollingGeneration++;
    this.friendRequestFetch = null;
    this.friendRequestsSeq = 0;
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

  lobbyInvites(): readonly LobbyInvite[] {
    return navNotifications.lobbyInvites();
  }

  inviteRemainingSeconds(invite: Pick<LobbyInvite, "expiresAt">): number {
    return navNotifications.inviteRemainingSeconds(invite);
  }

  dismissLobbyInvite(inviteId: string): void {
    navNotifications.dismissLobbyInvite(inviteId);
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
