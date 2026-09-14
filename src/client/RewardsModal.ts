import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Reward } from "../core/ApiSchemas";
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

  protected modalConfig() {
    return { maxWidth: "620px" };
  }

  public openWithRewards(rewards: Reward[]): void {
    this.rewards = rewards;
    this.open();
  }

  public open(args?: Record<string, unknown>): void {
    if (this.rewards.length === 0) return;
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
    if (this.rewards.length === 0) this.close();
  };

  protected renderBody(): TemplateResult {
    return html`
      <div class="p-6">
        <rewards-panel
          .rewards=${this.rewards}
          @rewards-changed=${this.handleRewardsChanged}
        ></rewards-panel>
      </div>
    `;
  }
}
