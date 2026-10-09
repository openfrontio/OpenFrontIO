import { isRewardClaimable, Reward } from "@openfront/shared/ApiSchemas";
import { html, LitElement, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  claimAllRewards,
  claimReward,
  getUserMe,
  invalidateUserMe,
} from "../Api";
import { crazyGamesSDK } from "../CrazyGamesSDK";
import { showInGameAlert } from "../InGameModal";
import { levelRewardReasonKey } from "../Progression";
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

  // Whether the viewer has an account trust can attach to: a linked identity
  // (responseHasLinkedIdentity) or a CrazyGames sign-in, as for
  // trustRequiredDialog. Without one an account is never trusted, whatever it
  // plays or buys, so the trust note tells them to sign in first.
  @property({ type: Boolean })
  signedIn = false;

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
        await showInGameAlert(translateText("account_modal.claim_failed"));
        return;
      }
      invalidateUserMe();
      if (result !== "not_found" && "held" in result) {
        // Held since this list was read (or read by an older API): nothing
        // was claimed. A hold is on the account, not the reward, so others in
        // this list may be held too: re-read the whole list rather than let
        // each offer a claim that 403s in turn. The refused reward keeps the
        // 403's hold either way.
        const userMe = await getUserMe();
        const rewards =
          userMe === false ? this.rewards : (userMe.player.rewards ?? []);
        this.emitChanged({
          currency: userMe === false ? null : (userMe.player.currency ?? null),
          rewards: rewards.map((r) =>
            r.id === reward.id && isRewardClaimable(r)
              ? { ...r, held: result.held }
              : r,
          ),
        });
        return;
      }
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
        await showInGameAlert(translateText("account_modal.claim_failed"));
        return;
      }
      invalidateUserMe();
      // Held rewards stay pending: keep showing them, with why.
      this.emitChanged({ currency: result.currency, rewards: result.held });
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
    // Level rewards get localized copy ahead of the note: their note is
    // server-side English, and the reason alone says what the reward is for.
    const levelKey = levelRewardReasonKey(reward.reason);
    if (levelKey !== undefined) return translateText(levelKey);
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
        ${!isRewardClaimable(reward)
          ? // A hold with no copy of its own is left to the note below.
            html`<span
              data-reward-held
              class="shrink-0 text-xs font-bold text-white/60 text-right"
              >${reward.held === "trust"
                ? translateText("account_modal.reward_held_trust")
                : ""}</span
            >`
          : html`<o-button
              variant="primary"
              size="xs"
              translationKey="account_modal.claim"
              .disable=${this.claiming}
              @click=${() => this.handleClaim(reward)}
            ></o-button>`}
      </div>
    `;
  }

  // The trust note, by whether the viewer is signed in (see signedIn) and on
  // CrazyGames, which has no purchases, so its copy only suggests playing.
  private trustNoteKey(): string {
    const onCrazyGames = crazyGamesSDK.isOnCrazyGames();
    if (this.signedIn) {
      return onCrazyGames
        ? "account_modal.reward_held_trust_info_crazygames"
        : "account_modal.reward_held_trust_info";
    }
    return onCrazyGames
      ? "account_modal.reward_held_trust_info_signed_out_crazygames"
      : "account_modal.reward_held_trust_info_signed_out";
  }

  // A hold this client has no copy for: say only that it can't be claimed.
  private otherHoldNoteKey(): string {
    return "account_modal.reward_held_other_info";
  }

  // Why held rewards can't be claimed yet: once under the list per kind of
  // hold, however many rewards it holds.
  private renderHeldNotes(): TemplateResult[] {
    const held = this.rewards.filter((r) => !isRewardClaimable(r));
    const keys = new Set<string>();
    if (held.some((r) => r.held === "trust")) keys.add(this.trustNoteKey());
    if (held.some((r) => r.held !== "trust")) keys.add(this.otherHoldNoteKey());
    return [...keys].map(
      (key) =>
        html`<p data-reward-held-note class="mt-3 text-xs text-white/60">
          ${translateText(key)}
        </p>`,
    );
  }

  render() {
    if (this.rewards.length === 0) return html``;
    const claimable = this.rewards.filter(isRewardClaimable);
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-6">
        <div class="flex items-center justify-between gap-4 mb-4">
          <h3 class="text-lg font-bold text-white flex items-center gap-2">
            <span>🎁</span>
            ${translateText("account_modal.unclaimed_rewards")}
          </h3>
          ${claimable.length > 1
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
        ${this.renderHeldNotes()}
      </div>
    `;
  }
}
