import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./components/baseComponents/stats/GameInfoView";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { translateText } from "./Utils";

@customElement("game-stats-modal")
export class GameStatsModal extends BaseModal {
  protected routerName = "stats";

  @state() private gameId: string | null = null;
  private openedFromAccount = false;

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("game_list.stats"),
      onBack: () => this.back(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected renderBody() {
    return html`
      <div class="custom-scrollbar mr-1">
        <div class="p-6">
          <game-info-view .gameId=${this.gameId}></game-info-view>
        </div>
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
    this.gameId = null;
    this.openedFromAccount = false;
  }

  public openFromAccount(gameId: string): void {
    this.openedFromAccount = true;
    this.open({ gameID: gameId });
  }

  private back(): void {
    const returnToAccount = this.openedFromAccount;
    this.close();
    if (!returnToAccount) return;

    document
      .querySelector<HTMLElement & { returnToGames(): void }>("account-modal")
      ?.returnToGames();
  }
}
