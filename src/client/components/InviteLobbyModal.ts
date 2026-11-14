import type { FriendEntry, UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { ClanMember } from "@openfront/shared/ClanApiSchemas";
import type { ClientInfo } from "@openfront/shared/WireSchemas";
import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getUserMe } from "../Api";
import { fetchClanMembers } from "../ClanApi";
import { desktopPresence } from "../DesktopPresence";
import { fetchFriends } from "../FriendsApi";
import { fuzzyMatch } from "../FuzzySearch";
import { fetchLobbyMemberPublicIds, sendLobbyInvite } from "../LobbyInviteApi";
import { lastUserMeResponse } from "../UserMeBroadcast";
import { translateText } from "../Utils";
import { BaseModal, ModalConfig } from "./BaseModal";
import { modalHeader } from "./ui/ModalHeader";
import { usernameText } from "./ui/UsernameText";

export type InviteLobbyClient = ClientInfo & {
  publicId?: string | null;
};

export interface InviteLobbyModalOpenArgs {
  lobbyId: string;
  gameMode?: string;
  map?: string;
  clients?: InviteLobbyClient[];
  memberPublicIds?: Iterable<string>;
}

interface ClanGroup {
  tag: string;
  name: string;
  members: ClanMember[];
}

/**
 * Modal for inviting OpenFront friends and clan members into a private lobby.
 */
@customElement("invite-lobby-modal")
export class InviteLobbyModal extends BaseModal {
  @state() private lobbyId = "";
  @state() private gameMode?: string;
  @state() private map?: string;
  @state() private clients: InviteLobbyClient[] = [];
  @state() private memberPublicIds = new Set<string>();

  @state() private searchQuery = "";
  @state() private loading = false;
  @state() private friends: FriendEntry[] = [];
  @state() private clanGroups: ClanGroup[] = [];
  @state() private invitedKeys = new Set<string>();
  @state() private pendingKeys = new Set<string>();
  private nextMemberRefreshSeq = 0;
  private appliedMemberRefreshSeq = 0;
  private lastRefreshedRosterKey = "";
  private inFlightRosterKey: string | null = null;
  private inFlightRosterSeq = 0;
  private inFlightRosterStartedAt = 0;
  private memberRefreshAbortController: AbortController | null = null;
  private rosterLoadSeq = 0;

  /**
   * Returns configuration for the underlying `<o-modal>` container.
   */
  protected modalConfig(): ModalConfig {
    return {
      maxWidth: "480px",
    };
  }

  /**
   * Renders the modal header with title and close button.
   */
  protected renderHeaderSlot(): TemplateResult {
    return modalHeader({
      title: translateText("invite_modal.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.close"),
    });
  }

  /**
   * Initializes modal state from `args` and starts loading the friends and clan roster.
   */
  protected onOpen(args?: Record<string, unknown>): void {
    const inviteArgs = args as unknown as InviteLobbyModalOpenArgs | undefined;
    if (inviteArgs?.lobbyId) {
      this.lobbyId = inviteArgs.lobbyId;
      this.gameMode = inviteArgs.gameMode;
      this.map = inviteArgs.map;
      this.clients = inviteArgs.clients ?? [];
      this.memberPublicIds = new Set(inviteArgs.memberPublicIds ?? []);
    }
    this.appliedMemberRefreshSeq = ++this.nextMemberRefreshSeq;
    this.lastRefreshedRosterKey = "";
    this.searchQuery = "";
    void this.refreshLobbyMembers();
    void this.loadRoster();
  }

  /**
   * Resets active lobby references and member state when the modal closes.
   */
  protected onClose(): void {
    this.lobbyId = "";
    this.gameMode = undefined;
    this.map = undefined;
    this.clients = [];
    this.memberPublicIds.clear();
    this.lastRefreshedRosterKey = "";
    this.inFlightRosterKey = null;
    this.inFlightRosterSeq = 0;
    this.inFlightRosterStartedAt = 0;
    this.memberRefreshAbortController?.abort();
    this.memberRefreshAbortController = null;
    this.rosterLoadSeq++;
    this.loading = false;
    this.searchQuery = "";
    this.appliedMemberRefreshSeq = ++this.nextMemberRefreshSeq;
  }

  /**
   * Updates the modal's active lobby client roster when lobby membership changes.
   */
  public updateClients(
    clients: InviteLobbyClient[],
    lobbyId?: string,
    memberPublicIds?: Iterable<string>,
  ): void {
    if (!this.isOpen()) {
      return;
    }
    if (lobbyId !== undefined && this.lobbyId && lobbyId !== this.lobbyId) {
      return;
    }
    const nextRosterKey = clients
      .map((c) => `${c.clientID}:${c.username ?? ""}:${c.publicId ?? ""}`)
      .sort()
      .join("|");
    const rosterChanged = this.lastRefreshedRosterKey !== nextRosterKey;

    this.clients = [...clients];
    if (memberPublicIds !== undefined) {
      this.appliedMemberRefreshSeq = ++this.nextMemberRefreshSeq;
      this.lastRefreshedRosterKey = nextRosterKey;
      this.memberPublicIds = new Set(memberPublicIds);
      return;
    }
    if (this.clients.length === 0) {
      this.appliedMemberRefreshSeq = ++this.nextMemberRefreshSeq;
      this.lastRefreshedRosterKey = nextRosterKey;
      this.inFlightRosterKey = null;
      this.inFlightRosterSeq = 0;
      this.inFlightRosterStartedAt = 0;
      this.memberPublicIds = new Set();
      return;
    }
    const inFlightStalled =
      this.inFlightRosterKey === nextRosterKey &&
      this.inFlightRosterStartedAt > 0 &&
      Date.now() - this.inFlightRosterStartedAt > 5000;
    if (
      rosterChanged &&
      (this.inFlightRosterKey !== nextRosterKey || inFlightStalled)
    ) {
      void this.refreshLobbyMembers(nextRosterKey);
    }
  }

  /**
   * Fetches the server-validated member `publicId`s for the active lobby.
   */
  private async refreshLobbyMembers(rosterKey?: string): Promise<void> {
    const lobbyId = this.lobbyId;
    if (!lobbyId) return;
    this.memberRefreshAbortController?.abort();
    const abortController = new AbortController();
    this.memberRefreshAbortController = abortController;
    const seq = ++this.nextMemberRefreshSeq;
    if (rosterKey !== undefined) {
      this.inFlightRosterKey = rosterKey;
      this.inFlightRosterSeq = seq;
      this.inFlightRosterStartedAt = Date.now();
    }
    try {
      const memberIds = await fetchLobbyMemberPublicIds(
        lobbyId,
        abortController.signal,
      );
      if (
        abortController.signal.aborted ||
        memberIds === false ||
        seq <= this.appliedMemberRefreshSeq ||
        this.lobbyId !== lobbyId
      ) {
        return;
      }
      this.appliedMemberRefreshSeq = seq;
      if (rosterKey !== undefined) {
        this.lastRefreshedRosterKey = rosterKey;
      }
      this.memberPublicIds = new Set(memberIds);
    } finally {
      if (this.memberRefreshAbortController === abortController) {
        this.memberRefreshAbortController = null;
      }
      if (this.inFlightRosterSeq === seq) {
        this.inFlightRosterKey = null;
        this.inFlightRosterSeq = 0;
        this.inFlightRosterStartedAt = 0;
      }
    }
  }

  /**
   * Builds the composite cooldown key for a lobby ID and target player ID.
   */
  private inviteKey(targetPublicId: string, lobbyId = this.lobbyId): string {
    return `${lobbyId}:${targetPublicId}`;
  }

  /**
   * Opens the inner `<o-modal>` if `open()` was called before first render.
   */
  protected firstUpdated(): void {
    super.firstUpdated();
    if (this.isModalOpen && !this.inline) {
      this.modalEl?.open();
    }
  }

  /**
   * Loads all pages of friends and clan members for the authenticated player.
   */
  private async loadRoster(): Promise<void> {
    const loadSeq = ++this.rosterLoadSeq;
    this.loading = true;
    try {
      let userMe: UserMeResponse | false | null =
        lastUserMeResponse()?.response ?? null;
      userMe ??= await getUserMe();
      if (loadSeq !== this.rosterLoadSeq) return;
      if (!userMe) {
        this.friends = [];
        this.clanGroups = [];
        return;
      }
      const myPublicId = userMe.player.publicId;

      const FRIENDS_PAGE_LIMIT = 20;
      const CLAN_MEMBERS_LIMIT = 50;

      // 1. Fetch all pages of friends (limit=20 matches FriendsList.ts; API rejects >50 with 400)
      const accumulatedFriends: FriendEntry[] = [];
      let loadedFriendsCount = 0;
      for (let page = 1; ; page++) {
        const friendsRes = await fetchFriends(page, FRIENDS_PAGE_LIMIT);
        if (loadSeq !== this.rosterLoadSeq) return;
        if (friendsRes === false) break;
        loadedFriendsCount += friendsRes.results.length;
        accumulatedFriends.push(
          ...friendsRes.results.filter((f) => f.publicId !== myPublicId),
        );
        if (
          friendsRes.results.length < FRIENDS_PAGE_LIMIT ||
          loadedFriendsCount >= friendsRes.total
        ) {
          break;
        }
      }
      if (loadSeq !== this.rosterLoadSeq) return;
      this.friends = accumulatedFriends;

      // 2. Fetch all pages of clan members (limit=50 matches ClanShared.ts perPageOptions max)
      const clans = userMe.player.clans ?? [];
      const clanResults = await Promise.all(
        clans.map(async (clan) => {
          const accumulatedMembers: ClanMember[] = [];
          let loadedMembersCount = 0;
          for (let page = 1; ; page++) {
            const membersRes = await fetchClanMembers(
              clan.tag,
              page,
              CLAN_MEMBERS_LIMIT,
            );
            if (loadSeq !== this.rosterLoadSeq) return null;
            if (membersRes === false) {
              return page === 1
                ? null
                : {
                    tag: clan.tag,
                    name: clan.name,
                    members: accumulatedMembers,
                  };
            }
            loadedMembersCount += membersRes.results.length;
            accumulatedMembers.push(
              ...membersRes.results.filter((m) => m.publicId !== myPublicId),
            );
            if (
              membersRes.results.length < CLAN_MEMBERS_LIMIT ||
              loadedMembersCount >= membersRes.total
            ) {
              break;
            }
          }
          return {
            tag: clan.tag,
            name: clan.name,
            members: accumulatedMembers,
          };
        }),
      );
      if (loadSeq !== this.rosterLoadSeq) return;
      this.clanGroups = clanResults.filter((g): g is ClanGroup => g !== null);
    } finally {
      if (loadSeq === this.rosterLoadSeq) {
        this.loading = false;
      }
    }
  }

  /**
   * Sends a lobby invitation to `targetPublicId`, handling errors and the 30-second cooldown.
   */
  private async handleInvite(targetPublicId: string): Promise<void> {
    const lobbyId = this.lobbyId;
    if (!lobbyId) return;
    const key = this.inviteKey(targetPublicId, lobbyId);
    if (this.invitedKeys.has(key) || this.pendingKeys.has(key)) return;

    this.pendingKeys.add(key);
    this.requestUpdate();

    let userMe: UserMeResponse | false | null =
      lastUserMeResponse()?.response ?? null;
    userMe ??= await getUserMe();
    const senderPublicId = userMe ? userMe.player.publicId : undefined;
    const senderUsername = userMe
      ? (userMe.player.username ?? null)
      : undefined;

    let ok = false;
    let retryAfterSeconds: number | undefined;
    let retryAfterMs: number | undefined;
    try {
      const res = await sendLobbyInvite({
        targetPublicId,
        lobbyId,
        ...(senderPublicId ? { senderPublicId } : {}),
        ...(senderUsername !== undefined ? { senderUsername } : {}),
        gameMode: this.gameMode,
        map: this.map,
      });
      ok = typeof res === "object" && res !== null ? res.ok : Boolean(res);
      if (typeof res === "object" && res !== null) {
        retryAfterSeconds = res.retryAfterSeconds;
        retryAfterMs = res.retryAfterMs;
      }
    } finally {
      this.pendingKeys.delete(key);
    }

    if (!ok) {
      if (retryAfterSeconds !== undefined && retryAfterSeconds > 0) {
        const cooldownMs = retryAfterMs ?? retryAfterSeconds * 1000;
        this.invitedKeys.add(key);
        setTimeout(() => {
          this.invitedKeys.delete(key);
          this.requestUpdate();
        }, cooldownMs);

        const message = translateText("invite_modal.cooldown", {
          seconds: String(retryAfterSeconds),
        });

        window.dispatchEvent(
          new CustomEvent("show-message", {
            detail: {
              message,
              duration: 3000,
              color: "yellow",
            },
          }),
        );
      } else {
        window.dispatchEvent(
          new CustomEvent("show-message", {
            detail: {
              message: translateText("invite_modal.invite_failed"),
              duration: 3000,
              color: "red",
            },
          }),
        );
      }
      this.requestUpdate();
      return;
    }

    this.invitedKeys.add(key);
    this.requestUpdate();

    // 30-second TTL countdown for invite button state keyed by lobbyId + targetPublicId
    setTimeout(() => {
      this.invitedKeys.delete(key);
      this.requestUpdate();
    }, 30_000);
  }

  /**
   * Checks whether a player with `publicId` is already in the current lobby using server-validated member IDs or client `publicId` identity.
   */
  private isClientInLobby(publicId?: string | null): boolean {
    if (!publicId) return false;
    if (this.memberPublicIds.has(publicId)) {
      return true;
    }
    return this.clients.some(
      (c) => typeof c.publicId === "string" && c.publicId === publicId,
    );
  }

  /**
   * Renders a single friend or clan member row with status badge or Invite button.
   */
  private renderPlayerRow(
    publicId: string,
    username?: string | null,
  ): TemplateResult {
    const inLobby = this.isClientInLobby(publicId);
    const key = this.inviteKey(publicId);
    const invited = this.invitedKeys.has(key);
    const pending = this.pendingKeys.has(key);

    return html`
      <div
        class="flex items-center justify-between py-2 px-3 hover:bg-white/5 rounded-lg transition-colors"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <div
            class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/70 shrink-0"
          >
            ${[...(username ?? publicId)][0]?.toUpperCase() ?? ""}
          </div>
          <span class="truncate text-sm font-medium text-white">
            ${
              username
                ? usernameText(username, "text-white font-medium")
                : publicId
            }
          </span>
        </div>
        <div>
          ${
            inLobby
              ? html`<span
                  class="text-xs font-semibold px-2.5 py-1 rounded-md bg-white/10 text-white/50"
                >
                  ${translateText("invite_modal.in_lobby")}
                </span>`
              : invited
                ? html`<span
                    class="text-xs font-semibold px-2.5 py-1 rounded-md bg-green-500/20 text-green-300"
                  >
                    ${translateText("invite_modal.invited")}
                  </span>`
                : html`<button
                    type="button"
                    ?disabled=${pending}
                    @click=${() => void this.handleInvite(publicId)}
                    class="text-xs font-bold uppercase tracking-wider px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md transition-colors cursor-pointer"
                  >
                    ${translateText("invite_modal.invite")}
                  </button>`
          }
        </div>
      </div>
    `;
  }

  /**
   * Renders the modal body with optional Steam invite button, search input, and grouped player lists.
   */
  protected renderBody(): TemplateResult {
    const query = this.searchQuery.trim();
    const lowerQuery = query.toLowerCase();
    const matchesGroup = (value: string) =>
      lowerQuery.length > 0 && value.toLowerCase().includes(lowerQuery);

    const matchesPublicId = (publicId: string) =>
      lowerQuery.length === 0 || publicId.toLowerCase().includes(lowerQuery);

    const filteredFriends = this.friends.filter(
      (f) => fuzzyMatch(query, f.username ?? "") || matchesPublicId(f.publicId),
    );

    const filteredClans = this.clanGroups
      .map((group) => {
        const matchesTag = matchesGroup(group.tag);
        const matchesName = matchesGroup(group.name);
        const members = group.members.filter(
          (m) =>
            matchesTag ||
            matchesName ||
            fuzzyMatch(query, m.username ?? "") ||
            matchesPublicId(m.publicId),
        );
        return { ...group, members };
      })
      .filter((group) => group.members.length > 0);

    const hasAny = filteredFriends.length > 0 || filteredClans.length > 0;
    const canSteamInvite = desktopPresence.isAvailable();

    return html`
      <div class="flex flex-col gap-4 p-4 text-white">
        ${
          canSteamInvite
            ? html`
                <button
                  type="button"
                  @click=${() => void desktopPresence.openInviteDialog()}
                  class="w-full flex items-center justify-center gap-2 py-2 px-3 bg-white/10 hover:bg-white/15 rounded-lg text-sm font-semibold text-white transition-colors cursor-pointer"
                >
                  <svg
                    class="w-4 h-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM16 7a1 1 0 00-2 0v2h-2a1 1 0 000 2h2v2a1 1 0 002 0v-2h2a1 1 0 000-2h-2V7z"
                    ></path>
                  </svg>
                  ${translateText("invite_modal.steam_invite")}
                </button>
              `
            : ""
        }

        <!-- Fuzzy Search Bar -->
        <div class="relative">
          <input
            type="text"
            .value=${this.searchQuery}
            @input=${(e: InputEvent) => {
              this.searchQuery = (e.target as HTMLInputElement).value;
            }}
            placeholder=${translateText("invite_modal.search_placeholder")}
            class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-blue-500 transition-colors"
          />
          ${
            this.searchQuery
              ? html`
                  <button
                    type="button"
                    @click=${() => {
                      this.searchQuery = "";
                    }}
                    class="absolute right-2.5 top-2.5 text-white/40 hover:text-white"
                    aria-label=${translateText("common.dismiss")}
                  >
                    ✕
                  </button>
                `
              : ""
          }
        </div>

        <!-- Grouped List -->
        <div class="max-h-[60vh] overflow-y-auto flex flex-col gap-4">
          ${
            this.loading
              ? html`<div class="text-center py-6 text-sm text-white/50">
                  ${translateText("common.loading")}
                </div>`
              : !hasAny
                ? html`<div class="text-center py-6 text-sm text-white/50">
                    ${translateText("invite_modal.empty")}
                  </div>`
                : html`
                    <!-- Friends Group -->
                    ${
                      filteredFriends.length > 0
                        ? html`
                            <div>
                              <div
                                class="text-xs font-bold uppercase tracking-wider text-white/40 px-3 py-1"
                              >
                                ${translateText("invite_modal.friends")}
                                (${filteredFriends.length})
                              </div>
                              <div class="flex flex-col">
                                ${filteredFriends.map((friend) =>
                                  this.renderPlayerRow(
                                    friend.publicId,
                                    friend.username,
                                  ),
                                )}
                              </div>
                            </div>
                          `
                        : ""
                    }

                    <!-- Clan Groups -->
                    ${filteredClans.map(
                      (group) => html`
                        <div>
                          <div
                            class="text-xs font-bold uppercase tracking-wider text-white/40 px-3 py-1"
                          >
                            ${translateText("invite_modal.clan_group", {
                              tag: group.tag,
                              count: group.members.length,
                            })}
                          </div>
                          <div class="flex flex-col">
                            ${group.members.map((member) =>
                              this.renderPlayerRow(
                                member.publicId,
                                member.username,
                              ),
                            )}
                          </div>
                        </div>
                      `,
                    )}
                  `
          }
        </div>
      </div>
    `;
  }
}
