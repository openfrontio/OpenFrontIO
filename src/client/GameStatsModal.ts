import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { hasLinkedIdentity } from "./AccountIdentity";
import { getUserMe } from "./Api";
import "./components/baseComponents/stats/GameInfoView";
import { BaseModal } from "./components/BaseModal";
import "./components/CopyButton";
import "./components/GameXpPanel";
import type { GameXpPanelState } from "./components/GameXpPanel";
import { modalHeader } from "./components/ui/ModalHeader";
import { fetchMyGameXp } from "./ProgressionApi";
import { translateText } from "./Utils";

@customElement("game-stats-modal")
export class GameStatsModal extends BaseModal {
  protected routerName = "stats";

  @state() private gameId: string | null = null;
  // The XP the signed-in player earned in this game, if any.
  @state() private xpView: GameXpPanelState = { kind: "hidden" };
  private xpGeneration = 0;
  private openedFrom: "account" | "clan" | "profile" | null = null;

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
        <game-xp-panel compact .view=${this.xpView}></game-xp-panel>
        <game-info-view .gameId=${this.gameId}></game-info-view>
      </div>
    `;
  }

  protected onOpen(args?: Record<string, unknown>): void {
    this.gameId =
      typeof args?.gameID === "string" && args.gameID.length > 0
        ? args.gameID
        : null;
    this.xpView = { kind: "hidden" };
    if (this.gameId !== null) void this.loadXp(this.gameId);
  }

  // One look, no polling: a past game is either processed or it never will
  // be. Only an eligible result is shown — this modal also opens other
  // players' games, where "you didn't spawn" would read as a verdict on them.
  private async loadXp(gameId: string): Promise<void> {
    const gen = ++this.xpGeneration;
    try {
      const me = await getUserMe();
      if (!me || !hasLinkedIdentity(me.user)) return;
      // No progress on /users/@me means progression is off.
      if (me.player.progress === undefined) return;
      const result = await fetchMyGameXp(gameId);
      if (gen !== this.xpGeneration || this.gameId !== gameId) return;
      if (result.status === "ok" && result.data.eligible) {
        this.xpView = { kind: "result", data: result.data };
      }
    } catch (err) {
      console.warn("GameStatsModal: XP lookup failed", err);
    }
  }

  protected onClose(): void {
    this.xpGeneration++;
    this.xpView = { kind: "hidden" };
    this.gameId = null;
    this.openedFrom = null;
  }

  public openFromAccount(gameId: string): void {
    this.openedFrom = "account";
    this.open({ gameID: gameId });
  }

  public openFromClan(gameId: string): void {
    this.openedFrom = "clan";
    this.open({ gameID: gameId });
  }

  public openFromProfile(gameId: string): void {
    this.openedFrom = "profile";
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
