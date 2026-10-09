import { isRewardClaimable, Reward } from "@openfront/shared/ApiSchemas";
import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { BaseModal } from "./components/BaseModal";
import "./components/RewardsPanel";
import type { RewardsChangedDetail } from "./components/RewardsPanel";
import { modalHeader } from "./components/ui/ModalHeader";
import { translateText } from "./Utils";

// Popup shown at login when the player has unclaimed subscription rewards.
// The list and claim actions are <rewards-panel>, shared with the account
// modal.
@customElement("rewards-modal")
export class RewardsModal extends BaseModal {
  @state() private rewards: Reward[] = [];
  // RewardsPanel.signedIn: picks the held-reward note.
  @state() private signedIn = false;

  protected modalConfig() {
    return { maxWidth: "620px" };
  }

  public openWithRewards(rewards: Reward[], signedIn: boolean): void {
    this.rewards = rewards;
    this.signedIn = signedIn;
    this.open();
  }

  // Held rewards stay listed (with why), but on their own they leave the popup
  // nothing to do: it opens, and stays open, only while one can be claimed.
  private hasClaimable(): boolean {
    return this.rewards.some(isRewardClaimable);
  }

  public open(args?: Record<string, unknown>): void {
    if (!this.hasClaimable()) return;
    super.open(args);
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("rewards_modal.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  private handleRewardsChanged = (
    event: CustomEvent<RewardsChangedDetail>,
  ): void => {
    this.rewards = event.detail.rewards;
    if (!this.hasClaimable()) this.close();
  };

  protected renderBody(): TemplateResult {
    return html`
      <div class="p-6">
        <rewards-panel
          .rewards=${this.rewards}
          .signedIn=${this.signedIn}
          @rewards-changed=${this.handleRewardsChanged}
        ></rewards-panel>
      </div>
    `;
  }
}
