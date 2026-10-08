import type { GameType } from "@openfront/engine-api/game/GameTypes";
import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./components/baseComponents/stats/GameInfoView";
import type { GameInfoLoadedDetail } from "./components/baseComponents/stats/GameInfoView";
import { BaseModal } from "./components/BaseModal";
import "./components/CopyButton";
import "./components/PastGameXpCard";
import type { PastGameXpView } from "./components/PastGameXpCard";
import { modalHeader } from "./components/ui/ModalHeader";
import { resolveXpAccount } from "./ProgressionAccount";
import { fetchMyGameXp, pollGameXp } from "./ProgressionApi";
import { translateText } from "./Utils";

// How long after a game ends a missing XP record still reads as "being
// scored" rather than "not yours": the server scores a game within moments,
// and retries a failed one well inside this.
export const RECENT_GAME_MS = 10 * 60_000;

@customElement("game-stats-modal")
export class GameStatsModal extends BaseModal {
  protected routerName = "stats";

  @state() private gameId: string | null = null;
  // The XP the signed-in player earned in this game, if any.
  @state() private xpView: PastGameXpView = { kind: "hidden" };
  // The open game's type, once GameInfoView has loaded its record.
  @state() private gameType: GameType | null = null;
  // Cancels the current XP lookup (and its polling) on close or a new game.
  private xpAbort: AbortController | null = null;
  private openedFrom: "account" | "clan" | "profile" | null = null;
  // Whose profile the game was opened from, when opened from a profile.
  private profilePublicId: string | null = null;
  // The loaded game's end time, once GameInfoView has it (null: it failed
  // to load), and whoever is waiting for it. Keyed by game, so it never
  // answers for another one.
  private gameEnd: { gameId: string; end: number | null } | null = null;
  private gameEndWaiters: (() => void)[] = [];

  protected modalConfig() {
    return { maxWidth: "960px" };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("game_list.stats"),
      onBack: () => this.back(),
      ariaLabel: translateText("common.back"),
      rightContent: this.gameId
        ? html`
            <copy-button
              compact
              class="shrink-0"
              .copyText=${this.gameId}
              .displayText=${this.gameId}
              .showVisibilityToggle=${false}
            ></copy-button>
          `
        : undefined,
    });
  }

  protected renderBody() {
    return html`
      <div class="px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-7">
        <game-info-view
          .gameId=${this.gameId}
          .afterSummary=${html`<past-game-xp-card
            .view=${this.xpView}
            .gameType=${this.gameType}
          ></past-game-xp-card>`}
          @game-info-loaded=${this.onGameInfoLoaded}
        ></game-info-view>
      </div>
    `;
  }

  protected onOpen(args?: Record<string, unknown>): void {
    this.gameId =
      typeof args?.gameID === "string" && args.gameID.length > 0
        ? args.gameID
        : null;
    this.gameType = null;
    this.resetXp();
    if (this.gameId !== null) {
      this.xpAbort = new AbortController();
      void this.loadXp(this.gameId, this.xpAbort.signal);
    }
  }

  private onGameInfoLoaded = (e: CustomEvent<GameInfoLoadedDetail>): void => {
    this.gameEnd = { gameId: e.detail.gameId, end: e.detail.info?.end ?? null };
    if (e.detail.gameId === this.gameId) {
      this.gameType = e.detail.info?.config.gameType ?? null;
    }
    const waiters = this.gameEndWaiters;
    this.gameEndWaiters = [];
    for (const wake of waiters) wake();
  };

  // When the game ended, from the record GameInfoView loads (no second
  // request for it). Null if it failed to load or the lookup was cancelled.
  private async gameEndedAt(
    gameId: string,
    signal: AbortSignal,
  ): Promise<number | null> {
    while (!signal.aborted) {
      if (this.gameEnd?.gameId === gameId) return this.gameEnd.end;
      await new Promise<void>((resolve) => {
        const wake = () => {
          signal.removeEventListener("abort", wake);
          resolve();
        };
        this.gameEndWaiters.push(wake);
        signal.addEventListener("abort", wake, { once: true });
      });
    }
    return null;
  }

  // The endpoint only ever returns the signed-in player's own record, so any
  // answer is theirs to see: the XP earned, or why the game didn't earn any
  // (including a game played before levels existed). A 404 is either a game
  // still being scored or someone else's game: it reads as "calculating" only
  // for the player's own game, opened from their own history, that ended in
  // the last few minutes — and then it is polled like the end-of-game screen.
  // Anything else shows nothing.
  private async loadXp(gameId: string, signal: AbortSignal): Promise<void> {
    try {
      // The same "signed in" rule as the end-of-game panel.
      const account = await resolveXpAccount();
      if (signal.aborted || account.kind !== "signed_in") return;
      // No progress on /users/@me means progression is off.
      if (account.me.player.progress === undefined) return;
      const result = await fetchMyGameXp(gameId, signal);
      if (signal.aborted) return;
      if (result.status === "ok") {
        // This reason reads differently for a singleplayer game, and the
        // game's type comes with its record.
        if (!result.data.eligible && result.data.reason === "unverified") {
          await this.gameEndedAt(gameId, signal);
          if (signal.aborted) return;
        }
        this.xpView = { kind: "result", data: result.data };
        return;
      }
      if (result.status === "unavailable") return;
      const ownHistory =
        this.openedFrom === "account" ||
        (this.openedFrom === "profile" &&
          this.profilePublicId !== null &&
          this.profilePublicId === account.me.player.publicId);
      if (!ownHistory) return;
      const end = await this.gameEndedAt(gameId, signal);
      if (signal.aborted || end === null) return;
      if (Date.now() - end > RECENT_GAME_MS) return;
      this.xpView = { kind: "calculating" };
      const polled = await pollGameXp(gameId, { signal });
      if (signal.aborted) return;
      this.xpView =
        polled === null ? { kind: "hidden" } : { kind: "result", data: polled };
    } catch (err) {
      console.warn("GameStatsModal: XP lookup failed", err);
      if (!signal.aborted) this.xpView = { kind: "hidden" };
    }
  }

  private resetXp(): void {
    this.xpAbort?.abort();
    this.xpAbort = null;
    this.xpView = { kind: "hidden" };
  }

  protected onClose(): void {
    this.resetXp();
    this.gameId = null;
    this.openedFrom = null;
    this.profilePublicId = null;
  }

  public openFromAccount(gameId: string): void {
    this.openedFrom = "account";
    this.profilePublicId = null;
    this.open({ gameID: gameId });
  }

  public openFromClan(gameId: string): void {
    this.openedFrom = "clan";
    this.profilePublicId = null;
    this.open({ gameID: gameId });
  }

  // `profilePublicId` is whose profile the game was listed on: the player's
  // own profile counts as their own history.
  public openFromProfile(gameId: string, profilePublicId?: string): void {
    this.openedFrom = "profile";
    this.profilePublicId = profilePublicId ?? null;
    this.open({ gameID: gameId });
  }

  private back(): void {
    const openedFrom = this.openedFrom;
    this.close();
    if (openedFrom === "account") {
      document
        .querySelector<HTMLElement & { returnToGames(): void }>("account-modal")
        ?.returnToGames();
    } else if (openedFrom === "profile") {
      document
        .querySelector<
          HTMLElement & { returnToGames(): void }
        >("player-profile-modal")
        ?.returnToGames();
    } else if (openedFrom === "clan") {
      document
        .querySelector<
          HTMLElement & { returnToGameHistory(): void }
        >("clan-modal")
        ?.returnToGameHistory();
    }
  }
}
