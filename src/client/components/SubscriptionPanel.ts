import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { UserSubscription } from "../../core/ApiSchemas";
import { Subscription } from "../../core/CosmeticSchemas";
import {
  cancelSubscription,
  invalidateUserMe,
  openSubscriptionPortal,
} from "../Api";
import { translateCosmetic } from "../Cosmetics";
import { showInGameAlert, showInGameConfirm } from "../InGameModal";
import { translateText } from "../Utils";
import "./baseComponents/Button";
import "./PlutoniumIcon";

@customElement("subscription-panel")
export class SubscriptionPanel extends LitElement {
  @property({ type: Object })
  sub!: UserSubscription;

  @property({ type: Object })
  cosmetic: Subscription | null = null;

  createRenderRoot() {
    return this;
  }

  private handleManage = async (): Promise<void> => {
    const url = await openSubscriptionPortal();
    if (url === false) {
      await showInGameAlert(
        translateText("account_modal.subscription_portal_failed"),
      );
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  private handleChangeTier = (): void => {
    // Ask the host to get out of the way first: the store is a different modal,
    // and a popup host (the subscription modal) doesn't close itself the way
    // the inline ones do when another page is shown.
    this.dispatchEvent(
      new CustomEvent("request-close", { bubbles: true, composed: true }),
    );
    window.location.hash = "modal=store&tab=subscriptions";
  };

  private handleCancel = async (): Promise<void> => {
    const confirmed = await showInGameConfirm(
      translateText("account_modal.cancel_subscription_confirm"),
      { heading: translateText("account_modal.cancel_subscription") },
    );
    if (!confirmed) return;
    const ok = await cancelSubscription();
    if (!ok) {
      await showInGameAlert(
        translateText("account_modal.cancel_subscription_failed"),
      );
      return;
    }
    await showInGameAlert(
      translateText("account_modal.cancel_subscription_success"),
    );
    invalidateUserMe();
    window.location.reload();
  };

  private periodEnd(): string | null {
    return this.sub.currentPeriodEnd
      ? this.sub.currentPeriodEnd.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : null;
  }

  // Status pill: amber while winding down, green while active, neutral for the
  // payment-problem states (past_due, unpaid, …).
  private renderStatusPill(): TemplateResult {
    const base =
      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider border";

    if (this.sub.cancelAtPeriodEnd) {
      return html`<span
        class="${base} bg-amber-500/10 border-amber-500/30 text-amber-300"
      >
        <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
        ${translateText("account_modal.sub_status_canceling")}
      </span>`;
    }

    const isActive =
      this.sub.status === "active" || this.sub.status === "trialing";
    // Unknown/newer statuses fall back to the raw value rather than showing a
    // translation key.
    const translated = translateText(
      `account_modal.sub_status_${this.sub.status}`,
    );
    const label = translated.startsWith("account_modal.sub_status_")
      ? this.sub.status
      : translated;

    return html`<span
      class="${base} ${isActive
        ? "bg-green-500/10 border-green-500/30 text-green-300"
        : "bg-white/5 border-white/15 text-white/60"}"
    >
      <span
        class="w-1.5 h-1.5 rounded-full ${isActive
          ? "bg-green-400"
          : "bg-white/40"}"
      ></span>
      ${label}
    </span>`;
  }

  // The one date line that matters: when it renews, or when access ends.
  private renderPeriodLine(): TemplateResult | typeof nothing {
    const periodEnd = this.periodEnd();
    if (!periodEnd) return nothing;
    return html`<div
      class="flex items-center gap-2 text-sm ${this.sub.cancelAtPeriodEnd
        ? "text-amber-200/80"
        : "text-white/50"}"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="w-4 h-4 shrink-0"
        aria-hidden="true"
      >
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <line x1="8" y1="3" x2="8" y2="7" />
        <line x1="16" y1="3" x2="16" y2="7" />
      </svg>
      <span>
        ${this.sub.cancelAtPeriodEnd
          ? translateText("account_modal.sub_status_canceling_on", {
              date: periodEnd,
            })
          : translateText("account_modal.sub_renews_on", { date: periodEnd })}
      </span>
    </div>`;
  }

  private renderPerk(value: number, labelKey: string): TemplateResult {
    return html`
      <div
        class="flex items-center gap-3 rounded-lg bg-white/5 border border-white/10 px-3 py-2.5"
      >
        <plutonium-icon .size=${24}></plutonium-icon>
        <div class="flex flex-col min-w-0">
          <span class="text-sm font-bold text-white leading-tight"
            >${value.toLocaleString()}</span
          >
          <span
            class="text-[10px] uppercase tracking-wider text-white/50 leading-tight"
            >${translateText(labelKey)}</span
          >
        </div>
      </div>
    `;
  }

  private renderActions(): TemplateResult {
    if (this.sub.cancelAtPeriodEnd) {
      return html`
        <o-button
          variant="primary"
          width="block"
          size="md"
          translationKey="account_modal.reactivate_subscription"
          @click=${this.handleManage}
        ></o-button>
      `;
    }
    return html`
      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap gap-2">
          <o-button
            class="flex-1 min-w-[8rem]"
            variant="primary"
            width="block"
            size="md"
            translationKey="account_modal.change_tier"
            @click=${this.handleChangeTier}
          ></o-button>
          <o-button
            class="flex-1 min-w-[8rem]"
            variant="secondary"
            width="block"
            size="md"
            translationKey="account_modal.manage_subscription"
            @click=${this.handleManage}
          ></o-button>
        </div>
        <button
          @click=${this.handleCancel}
          class="self-center text-[11px] font-bold uppercase tracking-widest text-white/30 hover:text-red-400 transition-colors py-1 cursor-pointer"
        >
          ${translateText("account_modal.cancel_subscription")}
        </button>
      </div>
    `;
  }

  render() {
    const { sub, cosmetic } = this;
    const tierName = translateCosmetic(
      "subscriptions",
      cosmetic?.name ?? sub.tier,
    );
    return html`
      <div class="flex flex-col gap-4">
        <div
          class="rounded-xl border border-white/10 bg-gradient-to-br from-white/10 to-white/[0.02] p-5 flex flex-col gap-4"
        >
          <div class="flex items-start justify-between gap-3 flex-wrap">
            <div class="flex flex-col gap-1 min-w-0">
              <div class="text-xl font-bold text-white leading-tight">
                ${tierName}
              </div>
              ${cosmetic?.product?.price
                ? html`<div class="text-sm text-white/50">
                    ${translateText("account_modal.sub_price_monthly", {
                      price: cosmetic.product.price,
                    })}
                  </div>`
                : ""}
            </div>
            ${this.renderStatusPill()}
          </div>

          ${cosmetic?.description
            ? html`<p class="text-sm text-white/70 leading-relaxed">
                ${cosmetic.description}
              </p>`
            : ""}
          ${cosmetic
            ? html`<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                ${this.renderPerk(
                  cosmetic.hardCurrencySignupBonus,
                  "cosmetics.signup_bonus",
                )}
                ${this.renderPerk(
                  cosmetic.dailyHardCurrency,
                  "cosmetics.per_day",
                )}
              </div>`
            : ""}
          ${this.renderPeriodLine()}

          <div class="border-t border-white/10 pt-4">
            ${this.renderActions()}
          </div>
        </div>
      </div>
    `;
  }
}
