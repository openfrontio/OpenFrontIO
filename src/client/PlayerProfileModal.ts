import {
  isVerifiedUsername,
  type PlayerProfile,
  type PlayerStatsTree,
  type PublicProgress,
} from "@openfront/shared/ApiSchemas";
import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import { fetchPublicPlayerProfile, getUserMe } from "./Api";
import "./ClanModal";
import "./components/baseComponents/stats/PlayerGameHistoryView";
import type { PlayerGameHistoryCache } from "./components/baseComponents/stats/PlayerGameHistoryView";
import "./components/baseComponents/stats/PlayerStatsTree";
import { BaseModal } from "./components/BaseModal";
import "./components/clan/ClanCard";
import "./components/PlayerName";
import "./components/ProfileCard";
import { modalHeader } from "./components/ui/ModalHeader";
import { usernameText } from "./components/ui/UsernameText";
import { verifiedBadge } from "./components/ui/VerifiedBadge";
import "./GameStatsModal";
import "./LeaderboardModal";
import { fetchPublicPlayerProgress } from "./ProgressionApi";
import { playerProfileUrl } from "./utilities/PlayerProfileUrl";
import { currentPagePath, translateText } from "./Utils";

export { playerProfileUrl };

/** Where a profile was opened from, i.e. where its Back button leads. */
export type ProfileOrigin = "clan" | "leaderboard" | "account";

@customElement("player-profile-modal")
export class PlayerProfileModal extends BaseModal {
  protected routerName = "profile";

  @state() private publicId: string | null = null;
  @state() private username: string | null = null;
  @state() private statsTree: PlayerStatsTree | null = null;
  @state() private clans: NonNullable<PlayerProfile["clans"]> = [];
  // Level / XP, when progression is on and the player has any.
  @state() private progress: PublicProgress | null = null;
  @state() private loading = false;
  private openedFrom: ProfileOrigin | null = null;
  // Mirrors the account modal's Games tab: keep the accumulated history list +
  // cursor across tab switches (and the game-stats detour) so re-entering Games
  // restores the scroll position the viewer had built up.
  private gameHistoryCache: PlayerGameHistoryCache | null = null;
  private gamesScrollTop = 0;
  private restoreGamesScrollAfterOpen = false;
  // Bumped on every profile load so a superseded in-flight response is dropped.
  private loadGeneration = 0;
  // Counts fresh openings, to key the profile card's once-per-open flourish.
  private openCount = 0;

  protected modalConfig() {
    return {
      maxWidth: "960px",
      tabs: [
        { key: "stats", label: translateText("account_modal.tab_stats") },
        { key: "games", label: translateText("account_modal.tab_games") },
        { key: "clans", label: translateText("account_modal.tab_clans") },
      ],
    };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("player_profile.title"),
      // The account username takes over the title when set — not uppercased
      // like the default title, since name casing is meaningful — and the
      // right chip then always shows the publicId.
      titleContent: this.username
        ? html`<span
            class="text-white text-xl lg:text-2xl font-bold tracking-wide break-words hyphens-auto min-w-0 inline-flex items-center gap-2"
          >
            ${usernameText(this.username)}
            ${isVerifiedUsername(this.username)
              ? verifiedBadge("w-5 h-5")
              : nothing}
          </span>`
        : undefined,
      onBack: () => this.back(),
      ariaLabel: translateText("common.back"),
      rightContent: this.publicId
        ? html`
            <player-name
              class="shrink-0"
              .publicId=${this.publicId}
              .copyText=${playerProfileUrl(this.publicId)}
            ></player-name>
          `
        : undefined,
    });
  }

  protected renderBody(tab: string) {
    return html`
      <div class="custom-scrollbar mr-1">
        <div class="p-6">${this.renderTab(tab)}</div>
      </div>
    `;
  }

  private renderTab(tab: string) {
    switch (tab) {
      case "games":
        return this.renderGames();
      case "clans":
        return this.renderClans();
      default:
        return this.renderProfile();
    }
  }

  // Clans ride along on the profile response — no extra fetch.
  private renderClans() {
    if (this.loading) {
      return this.renderLoadingSpinner(translateText("player_profile.loading"));
    }
    // A failed load leaves clans empty, which would read as "in no clans".
    if (!this.profileLoaded()) {
      return this.renderNotFound();
    }
    if (this.clans.length === 0) {
      return html`
        <div class="flex flex-col items-center justify-center p-12 text-center">
          <span class="text-4xl mb-4">🛡️</span>
          <p class="text-white/40 text-sm">
            ${translateText("player_profile.no_clans")}
          </p>
        </div>
      `;
    }
    return html`
      <div class="space-y-3">
        ${this.clans.map(
          (clan) => html`
            <clan-card
              .clan=${{
                tag: clan.tag,
                name: clan.name,
                description: "",
                isOpen: false,
                memberCount: clan.memberCount,
                softBalance: clan.softBalance,
                hardBalance: clan.hardBalance,
              }}
              .clanRole=${clan.role}
              @clan-select=${(e: CustomEvent<{ tag: string }>) =>
                this.openClan(e.detail.tag)}
            ></clan-card>
          `,
        )}
      </div>
    `;
  }

  // Hand off to the clan modal, telling it which profile to come back to and
  // where that profile's own Back button leads. The origin travels with the
  // handoff rather than being parked here: the clan modal can route on to
  // another player's profile, which reuses this element, and only the clan
  // modal knows how deep that chain of detours went.
  private openClan(tag: string): void {
    const publicId = this.publicId;
    if (publicId === null) return;
    document
      .querySelector<
        HTMLElement & {
          openFromProfile(
            tag: string,
            publicId: string,
            origin: ProfileOrigin | null,
          ): void;
        }
      >("clan-modal")
      ?.openFromProfile(tag, publicId, this.openedFrom);
  }

  // Called by the clan modal's Back button, handing back the origin openClan()
  // gave it. Reloads rather than restoring: the detour can rename a clan or
  // change this player's role or member count.
  public returnFromClan(publicId: string, origin: ProfileOrigin | null): void {
    this.open({ publicID: publicId, tab: "clans" });
    // open() cleared openedFrom; put this profile's own origin back.
    this.openedFrom = origin;
  }

  private renderGames() {
    const publicId = this.publicId;
    if (!publicId) {
      return html`
        <div class="flex flex-col items-center justify-center p-12 text-center">
          <span class="text-4xl mb-4">🎮</span>
          <p class="text-white/40 text-sm">
            ${translateText("account_modal.no_games")}
          </p>
        </div>
      `;
    }
    return html`
      <player-game-history-view
        .publicId=${publicId}
        .cachedState=${this.gameHistoryCache?.publicId === publicId
          ? this.gameHistoryCache
          : null}
        @history-updated=${(e: CustomEvent<PlayerGameHistoryCache>) => {
          this.gameHistoryCache = e.detail;
        }}
        @view-stats=${(e: CustomEvent<{ gameId: string }>) =>
          this.openGameStats(e.detail.gameId)}
        @view-game=${(e: CustomEvent<{ gameId: string }>) =>
          this.viewGame(e.detail.gameId)}
      ></player-game-history-view>
    `;
  }

  private renderProfile() {
    if (this.loading) {
      return this.renderLoadingSpinner(translateText("player_profile.loading"));
    }
    if (!this.profileLoaded()) {
      return this.renderNotFound();
    }
    // The card heads the stats; games and wins stay in the stats below it.
    return html`
      ${this.progress === null
        ? nothing
        : html`<profile-card
            class="mb-4 block"
            .username=${this.username ?? this.publicId ?? ""}
            .clanTag=${this.clans[0]?.tag ?? null}
            .progress=${this.progress}
            .openKey=${`profile-${this.openCount}`}
          ></profile-card>`}
      <player-stats-tree-view
        .statsTree=${this.statsTree}
      ></player-stats-tree-view>
    `;
  }

  // Everyone's level, your own included, comes from the public endpoint first:
  // the /users/@me copy is cached from page load and would miss the games
  // played since. But that endpoint 404s for a player who hides their level —
  // for everyone, them included — and they still see their own level. So on
  // your OWN profile only, no public progress falls back to your /users/@me
  // copy (memoised: normally no request). Nobody else's profile ever does, so a
  // hidden level stays hidden from others. Missing progress hides the card.
  private async loadProgress(publicId: string): Promise<PublicProgress | null> {
    try {
      const progress = await fetchPublicPlayerProgress(publicId);
      if (progress !== false) return progress;
      const me = await getUserMe();
      if (me === false || me.player.publicId !== publicId) return null;
      return me.player.progress ?? null;
    } catch {
      return null;
    }
  }

  // False when the fetch failed (missing player, network, bad schema).
  private profileLoaded(): boolean {
    return !!this.publicId && !!this.statsTree;
  }

  private renderNotFound() {
    return html`
      <div class="flex flex-col items-center justify-center p-12 text-center">
        <span class="text-4xl mb-4">📊</span>
        <p class="text-white/40 text-sm">
          ${translateText("player_profile.not_found")}
        </p>
      </div>
    `;
  }

  protected onOpen(args?: Record<string, unknown>): void {
    const publicId =
      typeof args?.publicID === "string" && args.publicID.length > 0
        ? args.publicID
        : null;

    // Returning from the game-stats modal. The page router closed this modal
    // underneath when the stats page showed, but onClose deliberately preserves
    // state (like the account modal) — so restore the scroll and keep the
    // game-history cache instead of refetching. Preserve even when the profile
    // stats never loaded (still pending / failed): the Games tab loads
    // independently, so its list should survive the detour regardless.
    if (
      this.restoreGamesScrollAfterOpen &&
      publicId !== null &&
      publicId === this.publicId
    ) {
      this.restoreGamesScrollAfterOpen = false;
      void this.restoreGamesScroll();
      return;
    }

    // Fresh open (router/share link): clear any stale origin. The openFrom*
    // helpers re-set it right after open() so back() routes home; the
    // return-from-stats path above skips this and keeps the origin intact.
    this.openedFrom = null;
    // A new opening: the profile card plays its flourish again.
    this.openCount++;
    this.publicId = publicId;
    this.username = null;
    this.statsTree = null;
    this.clans = [];
    this.progress = null;
    this.gameHistoryCache = null;
    this.gamesScrollTop = 0;
    this.restoreGamesScrollAfterOpen = false;
    this.loading = publicId !== null;
    if (publicId !== null) {
      void this.loadProfile(publicId);
    }
  }

  private async loadProfile(publicId: string): Promise<void> {
    const gen = ++this.loadGeneration;
    // Drop a superseded response: a newer load started, or the modal moved to a
    // different player. onClose no longer clears publicId, so the id check alone
    // can't reject a stale same-player load started before an earlier close.
    const current = () =>
      gen === this.loadGeneration && this.publicId === publicId;
    // The level is a nice-to-have: it lands whenever it arrives and never
    // holds up the profile (its request can take up to its own timeout).
    // Only shown alongside a loaded profile (see renderProfile).
    void this.loadProgress(publicId).then((progress) => {
      if (current()) this.progress = progress;
    });
    const profile = await fetchPublicPlayerProfile(publicId);
    if (!current()) return;
    this.loading = false;
    this.statsTree = profile === false ? null : profile.stats;
    this.username = profile === false ? null : (profile.username ?? null);
    this.clans = profile === false ? [] : (profile.clans ?? []);
  }

  // Intentionally preserves publicId/statsTree/history cache/scroll: the page
  // router closes this modal when the game-stats page opens on top, and the
  // return flow (returnToGames) needs that state intact. onOpen resets it for a
  // genuinely new player. Mirrors the account modal.
  protected onClose(): void {}

  // Open the game-stats modal on top for a game in this player's history. Stash
  // the scroll offset so returning restores it (see returnToGames()).
  private openGameStats(gameId: string): void {
    this.gamesScrollTop = this.modalEl?.getScrollTop() ?? 0;
    const statsModal = document.querySelector<
      HTMLElement & {
        openFromProfile(gameId: string, profilePublicId?: string): void;
      }
    >("game-stats-modal");
    statsModal?.openFromProfile(gameId, this.publicId ?? undefined);
  }

  private viewGame(gameId: string): void {
    this.close();
    const encodedGameId = encodeURIComponent(gameId);
    const newUrl = currentPagePath(ClientEnv.gamePath(gameId));

    history.pushState({ join: gameId }, "", newUrl);
    window.dispatchEvent(
      new CustomEvent("join-changed", { detail: { gameId: encodedGameId } }),
    );
  }

  // Called by the game-stats modal's back button when it was opened from here.
  public returnToGames(): void {
    this.restoreGamesScrollAfterOpen = true;
    this.open({ publicID: this.publicId ?? undefined, tab: "games" });
  }

  private async restoreGamesScroll(): Promise<void> {
    await this.updateComplete;
    await this.modalEl?.updateComplete;
    const historyView = this.querySelector<
      HTMLElement & { updateComplete?: Promise<boolean> }
    >("player-game-history-view");
    await historyView?.updateComplete;
    this.modalEl?.setScrollTop(this.gamesScrollTop);
  }

  // Origin is set after open() in every openFrom* helper: onOpen clears it, and
  // back() only reads it later on the user's click, so assigning here survives
  // to route the back button home (and survives the game-stats detour, which
  // never re-runs onOpen's fresh path).
  public openFromClan(publicId: string): void {
    this.open({ publicID: publicId });
    this.openedFrom = "clan";
  }

  public openFromLeaderboard(publicId: string): void {
    this.open({ publicID: publicId });
    this.openedFrom = "leaderboard";
  }

  public openFromAccount(publicId: string): void {
    this.open({ publicID: publicId });
    this.openedFrom = "account";
  }

  private back(): void {
    const openedFrom = this.openedFrom;
    this.close();
    if (openedFrom === "clan") {
      document
        .querySelector<
          HTMLElement & { returnFromPlayerProfile(): void }
        >("clan-modal")
        ?.returnFromPlayerProfile();
    } else if (openedFrom === "leaderboard") {
      document
        .querySelector<HTMLElement & { open(): void }>("leaderboard-modal")
        ?.open();
    } else if (openedFrom === "account") {
      document
        .querySelector<
          HTMLElement & { returnToFriends(): void }
        >("account-modal")
        ?.returnToFriends();
    }
  }
}
