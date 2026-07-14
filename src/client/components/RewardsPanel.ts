import { html, LitElement, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Reward } from "../../core/ApiSchemas";
import {
  claimAllRewards,
  claimReward,
  getUserMe,
  invalidateUserMe,
} from "../Api";
import { translateText } from "../Utils";
import "./baseComponents/Button";
import "./CapIcon";
import "./PlutoniumIcon";

// The new state of the rewards list after a claim. `currency` is the fresh
// post-claim balances, or null when they couldn't be determined (the parent
// should leave its wallet display unchanged).
export interface RewardsChangedDetail {
  currency: { soft: number; hard: number } | null;
  rewards: Reward[];
}

@customElement("rewards-panel")
export class RewardsPanel extends LitElement {
  @property({ type: Array })
  rewards: Reward[] = [];

  @state() private claiming = false;

  createRenderRoot() {
    return this;
  }

  private emitChanged(detail: RewardsChangedDetail): void {
    this.dispatchEvent(
      new CustomEvent<RewardsChangedDetail>("rewards-changed", {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async handleClaim(reward: Reward): Promise<void> {
    if (this.claiming) return;
    this.claiming = true;
    try {
      const result = await claimReward(reward.id);
      if (result === false) {
        alert(translateText("account_modal.claim_failed"));
        return;
      }
      invalidateUserMe();
      if (result === "not_found") {
        // Already claimed elsewhere (double-click or second device) — the
        // currency was still credited exactly once. Re-sync from the server.
        const userMe = await getUserMe();
        this.emitChanged({
          currency: userMe === false ? null : (userMe.player.currency ?? null),
          rewards:
            userMe === false
              ? this.rewards.filter((r) => r.id !== reward.id)
              : (userMe.player.rewards ?? []),
        });
        return;
      }
      this.emitChanged({
        currency: result.currency,
        rewards: this.rewards.filter((r) => r.id !== reward.id),
      });
    } finally {
      this.claiming = false;
    }
  }

  private async handleClaimAll(): Promise<void> {
    if (this.claiming) return;
    this.claiming = true;
    try {
      const result = await claimAllRewards();
      if (result === false) {
        alert(translateText("account_modal.claim_failed"));
        return;
      }
      invalidateUserMe();
      this.emitChanged({ currency: result.currency, rewards: [] });
    } finally {
      this.claiming = false;
    }
  }

  // Amounts are stringified bigints that can exceed Number.MAX_SAFE_INTEGER.
  private formatAmount(amount: string): string {
    try {
      return BigInt(amount).toLocaleString();
    } catch {
      return amount;
    }
  }

  private rewardLabel(reward: Reward): string {
    if (reward.note) return reward.note;
    if (reward.reason === "subscription_signup_bonus") {
      return translateText("account_modal.reward_signup_bonus");
    }
    if (reward.reason === "subscription_daily") {
      return translateText("account_modal.reward_daily");
    }
    return reward.reason;
  }

  private renderReward(reward: Reward): TemplateResult {
    const isHard = reward.currencyType === "hard";
    return html`
      <div
        class="flex items-center justify-between gap-4 p-3 rounded-lg bg-white/5 border border-white/10"
      >
        <div class="flex items-center gap-3 min-w-0">
          ${isHard
            ? html`<plutonium-icon .size=${20}></plutonium-icon>`
            : html`<cap-icon .size=${20}></cap-icon>`}
          <div class="flex flex-col min-w-0">
            <span
              class="text-sm font-bold ${isHard
                ? "text-green-400"
                : "text-amber-700"}"
              >+${this.formatAmount(reward.amount)}</span
            >
            <span class="text-xs text-white/60 truncate"
              >${this.rewardLabel(reward)}</span
            >
          </div>
        </div>
        <o-button
          variant="primary"
          size="xs"
          translationKey="account_modal.claim"
          .disable=${this.claiming}
          @click=${() => this.handleClaim(reward)}
        ></o-button>
      </div>
    `;
  }

  render() {
    if (this.rewards.length === 0) return html``;
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-6">
        <div class="flex items-center justify-between gap-4 mb-4">
          <h3 class="text-lg font-bold text-white flex items-center gap-2">
            <span>🎁</span>
            ${translateText("account_modal.unclaimed_rewards")}
          </h3>
          ${this.rewards.length > 1
            ? html`<o-button
                variant="primary"
                size="xs"
                translationKey="account_modal.claim_all"
                .disable=${this.claiming}
                @click=${this.handleClaimAll}
              ></o-button>`
            : ""}
        </div>
        <div class="flex flex-col gap-2">
          ${this.rewards.map((r) => this.renderReward(r))}
        </div>
      </div>
    `;
  }
}
