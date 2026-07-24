import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import { isVerifiedUsername, type PlayerStatsTree } from "../core/ApiSchemas";
import { fetchPublicPlayerProfile } from "./Api";
import "./components/baseComponents/stats/PlayerGameHistoryView";
import type { PlayerGameHistoryCache } from "./components/baseComponents/stats/PlayerGameHistoryView";
import "./components/baseComponents/stats/PlayerStatsTree";
import { BaseModal } from "./components/BaseModal";
import "./components/PlayerName";
import { modalHeader } from "./components/ui/ModalHeader";
import { usernameText } from "./components/ui/UsernameText";
import { verifiedBadge } from "./components/ui/VerifiedBadge";
import { translateText } from "./Utils";

/** Build a shareable profile URL for a publicId. */
export function playerProfileUrl(publicId: string): string {
  return `${window.location.origin}${window.location.pathname}#modal=profile&publicID=${encodeURIComponent(publicId)}`;
}

@customElement("player-profile-modal")
export class PlayerProfileModal extends BaseModal {
  protected routerName = "profile";

  @state() private publicId: string | null = null;
  @state() private username: string | null = null;
  @state() private statsTree: PlayerStatsTree | null = null;
  @state() private loading = false;
  private openedFrom: "clan" | "leaderboard" | "account" | null = null;
  // Mirrors the account modal's Games tab: keep the accumulated history list +
  // cursor across tab switches (and the game-stats detour) so re-entering Games
  // restores the scroll position the viewer had built up.
  private gameHistoryCache: PlayerGameHistoryCache | null = null;
  private gamesScrollTop = 0;
  private restoreGamesScrollAfterOpen = false;
  // Bumped on every profile load so a superseded in-flight response is dropped.
  private loadGeneration = 0;

  protected modalConfig() {
    return {
      maxWidth: "960px",
      tabs: [
        { key: "stats", label: translateText("account_modal.tab_stats") },
        { key: "games", label: translateText("account_modal.tab_games") },
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
        <div class="p-6">
          ${tab === "games" ? this.renderGames() : this.renderProfile()}
        </div>
      </div>
    `;
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
    if (!this.publicId || !this.statsTree) {
      return html`
        <div class="flex flex-col items-center justify-center p-12 text-center">
          <span class="text-4xl mb-4">📊</span>
          <p class="text-white/40 text-sm">
            ${translateText("player_profile.not_found")}
          </p>
        </div>
      `;
    }
    return html`
      <player-stats-tree-view
        .statsTree=${this.statsTree}
      ></player-stats-tree-view>
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
    this.publicId = publicId;
    this.username = null;
    this.statsTree = null;
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
    const profile = await fetchPublicPlayerProfile(publicId);
    // Drop a superseded response: a newer load started, or the modal moved to a
    // different player. onClose no longer clears publicId, so the id check alone
    // can't reject a stale same-player load started before an earlier close.
    if (gen !== this.loadGeneration || this.publicId !== publicId) return;
    this.loading = false;
    this.statsTree = profile === false ? null : profile.stats;
    this.username = profile === false ? null : (profile.username ?? null);
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
      HTMLElement & { openFromProfile(gameId: string): void }
    >("game-stats-modal");
    statsModal?.openFromProfile(gameId);
  }

  private viewGame(gameId: string): void {
    this.close();
    const encodedGameId = encodeURIComponent(gameId);
    const newUrl = `/${ClientEnv.workerPath(gameId)}/game/${encodedGameId}`;

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
