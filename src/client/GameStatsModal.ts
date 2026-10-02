import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./components/baseComponents/stats/GameInfoView";
import { BaseModal } from "./components/BaseModal";
import "./components/CopyButton";
import { modalHeader } from "./components/ui/ModalHeader";
import type { ProfileOrigin } from "./PlayerProfileModal";
import { translateText } from "./Utils";

@customElement("game-stats-modal")
export class GameStatsModal extends BaseModal {
  protected routerName = "stats";

  @state() private gameId: string | null = null;
  private openedFrom: "account" | "clan" | "profile" | null = null;
  private profileReturn: {
    publicId: string;
    origin: ProfileOrigin | null;
  } | null = null;
  private preserveStateForProfileHandoff = false;

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
          @view-profile=${(event: CustomEvent<{ publicId: string }>) =>
            this.openPlayerProfile(event.detail.publicId)}
        ></game-info-view>
      </div>
    `;
  }

  protected onOpen(args?: Record<string, unknown>): void {
    this.gameId =
      typeof args?.gameID === "string" && args.gameID.length > 0
        ? args.gameID
        : null;
  }

  protected onClose(): void {
    if (this.preserveStateForProfileHandoff) return;
    this.gameId = null;
    this.openedFrom = null;
    this.profileReturn = null;
  }

  public openFromAccount(gameId: string): void {
    this.openedFrom = "account";
    this.profileReturn = null;
    this.open({ gameID: gameId });
  }

  public openFromClan(gameId: string): void {
    this.openedFrom = "clan";
    this.profileReturn = null;
    this.open({ gameID: gameId });
  }

  public openFromProfile(
    gameId: string,
    publicId: string,
    origin: ProfileOrigin | null,
  ): void {
    this.openedFrom = "profile";
    this.profileReturn = { publicId, origin };
    this.open({ gameID: gameId });
  }

  public returnFromPlayerProfile(): void {
    if (this.gameId) this.open({ gameID: this.gameId });
  }

  private openPlayerProfile(publicId: string): void {
    if (!publicId) return;
    const profileModal = document.querySelector<
      HTMLElement & { openFromStats(publicId: string): void }
    >("player-profile-modal");
    if (!profileModal) return;

    this.preserveStateForProfileHandoff = true;
    try {
      profileModal.openFromStats(publicId);
    } finally {
      this.preserveStateForProfileHandoff = false;
    }
  }

  private back(): void {
    const openedFrom = this.openedFrom;
    const profileReturn = this.profileReturn;
    this.close();
    if (openedFrom === "account") {
      document
        .querySelector<HTMLElement & { returnToGames(): void }>("account-modal")
        ?.returnToGames();
    } else if (openedFrom === "profile") {
      document
        .querySelector<
          HTMLElement & {
            returnToGames(
              publicId?: string | null,
              origin?: ProfileOrigin | null,
            ): void;
          }
        >("player-profile-modal")
        ?.returnToGames(profileReturn?.publicId, profileReturn?.origin);
    } else if (openedFrom === "clan") {
      document
        .querySelector<
          HTMLElement & { returnToGameHistory(): void }
        >("clan-modal")
        ?.returnToGameHistory();
    }
  }
}
