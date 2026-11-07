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
import { sendLobbyInvite } from "../LobbyInviteApi";
import { lastUserMeResponse } from "../UserMeBroadcast";
import { translateText } from "../Utils";
import { BaseModal, ModalConfig } from "./BaseModal";
import { modalHeader } from "./ui/ModalHeader";
import { usernameText } from "./ui/UsernameText";

export interface InviteLobbyModalOpenArgs {
  lobbyId: string;
  gameMode?: string;
  map?: string;
  clients?: ClientInfo[];
}

interface ClanGroup {
  tag: string;
  name: string;
  members: ClanMember[];
}

@customElement("invite-lobby-modal")
export class InviteLobbyModal extends BaseModal {
  @state() private lobbyId = "";
  @state() private gameMode?: string;
  @state() private map?: string;
  @state() private clients: ClientInfo[] = [];

  @state() private searchQuery = "";
  @state() private loading = false;
  @state() private friends: FriendEntry[] = [];
  @state() private clanGroups: ClanGroup[] = [];
  @state() private invitedIds = new Set<string>();

  protected modalConfig(): ModalConfig {
    return {
      title: translateText("invite_modal.title"),
      maxWidth: "max-w-md",
    };
  }

  open(args?: Record<string, unknown>): void {
    const inviteArgs = args as unknown as InviteLobbyModalOpenArgs | undefined;
    if (inviteArgs?.lobbyId) {
      this.lobbyId = inviteArgs.lobbyId;
      this.gameMode = inviteArgs.gameMode;
      this.map = inviteArgs.map;
      this.clients = inviteArgs.clients ?? [];
    }
    this.searchQuery = "";
    super.open();
    void this.loadRoster();
  }

  private async loadRoster(): Promise<void> {
    this.loading = true;
    try {
      let userMe: UserMeResponse | false | null =
        lastUserMeResponse()?.response ?? null;
      userMe ??= await getUserMe();
      if (!userMe) {
        this.friends = [];
        this.clanGroups = [];
        return;
      }
      const myPublicId = userMe.player.publicId;

      // 1. Fetch friends
      const friendsRes = await fetchFriends(1, 100);
      if (friendsRes !== false) {
        this.friends = friendsRes.results.filter(
          (f) => f.publicId !== myPublicId,
        );
      } else {
        this.friends = [];
      }

      // 2. Fetch clan members
      const clans = userMe ? (userMe.player.clans ?? []) : [];
      const groups: ClanGroup[] = [];

      for (const clan of clans) {
        const membersRes = await fetchClanMembers(clan.tag, 1, 100);
        if (membersRes !== false) {
          const members = membersRes.results.filter(
            (m) => m.publicId !== myPublicId,
          );
          groups.push({
            tag: clan.tag,
            name: clan.name,
            members,
          });
        }
      }
      this.clanGroups = groups;
    } finally {
      this.loading = false;
    }
  }

  private async handleInvite(targetPublicId: string): Promise<void> {
    if (!this.lobbyId || this.invitedIds.has(targetPublicId)) return;

    let userMe: UserMeResponse | false | null =
      lastUserMeResponse()?.response ?? null;
    userMe ??= await getUserMe();
    const senderPublicId = userMe ? userMe.player.publicId : "";
    const senderUsername = userMe ? (userMe.player.username ?? null) : null;

    this.invitedIds.add(targetPublicId);
    this.requestUpdate();

    // 30-second TTL countdown for invite button state
    setTimeout(() => {
      this.invitedIds.delete(targetPublicId);
      this.requestUpdate();
    }, 30_000);

    await sendLobbyInvite({
      targetPublicId,
      lobbyId: this.lobbyId,
      senderPublicId,
      senderUsername,
      gameMode: this.gameMode,
      map: this.map,
    });
  }

  private isClientInLobby(username?: string | null): boolean {
    if (!username) return false;
    const lower = username.toLowerCase();
    return this.clients.some(
      (c) => c.username && c.username.toLowerCase() === lower,
    );
  }

  private renderPlayerRow(
    publicId: string,
    username?: string | null,
  ): TemplateResult {
    const inLobby = this.isClientInLobby(username);
    const invited = this.invitedIds.has(publicId);

    return html`
      <div
        class="flex items-center justify-between py-2 px-3 hover:bg-white/5 rounded-lg transition-colors"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <div
            class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/70 shrink-0"
          >
            ${(username ?? publicId).charAt(0).toUpperCase()}
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
                    @click=${() => void this.handleInvite(publicId)}
                    class="text-xs font-bold uppercase tracking-wider px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors cursor-pointer"
                  >
                    ${translateText("invite_modal.invite")}
                  </button>`
          }
        </div>
      </div>
    `;
  }

  protected renderContent(): TemplateResult {
    const query = this.searchQuery.trim();

    const filteredFriends = this.friends.filter(
      (f) =>
        fuzzyMatch(query, f.username ?? "") ||
        fuzzyMatch(query, f.publicId) ||
        fuzzyMatch(query, "friends"),
    );

    const filteredClans = this.clanGroups
      .map((group) => {
        const matchesTag = fuzzyMatch(query, group.tag);
        const matchesName = fuzzyMatch(query, group.name);
        const members = group.members.filter(
          (m) =>
            matchesTag ||
            matchesName ||
            fuzzyMatch(query, m.username ?? "") ||
            fuzzyMatch(query, m.publicId),
        );
        return { ...group, members };
      })
      .filter((group) => group.members.length > 0);

    const hasAny = filteredFriends.length > 0 || filteredClans.length > 0;
    const canSteamInvite = desktopPresence.isAvailable();

    return html`
      <div class="flex flex-col gap-4 p-4 text-white">
        ${modalHeader({
          title: translateText("invite_modal.title"),
          onBack: () => this.close(),
          ariaLabel: translateText("common.close"),
        })}
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
                            Clan [${group.tag}] (${group.members.length})
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
