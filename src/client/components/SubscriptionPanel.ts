import { html, LitElement, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { UserSubscription } from "../../core/ApiSchemas";
import { Subscription } from "../../core/CosmeticSchemas";
import {
  cancelSubscription,
  invalidateUserMe,
  openSubscriptionPortal,
} from "../Api";
import { translateCosmetic } from "../Cosmetics";
import { translateText } from "../Utils";
import "./baseComponents/Button";
import "./CapIcon";
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
      alert(translateText("account_modal.subscription_portal_failed"));
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  private handleChangeTier = (): void => {
    window.location.hash = "modal=store&tab=subscriptions";
  };

  private handleCancel = async (): Promise<void> => {
    const confirmed = window.confirm(
      translateText("account_modal.cancel_subscription_confirm"),
    );
    if (!confirmed) return;
    const ok = await cancelSubscription();
    if (!ok) {
      alert(translateText("account_modal.cancel_subscription_failed"));
      return;
    }
    alert(translateText("account_modal.cancel_subscription_success"));
    invalidateUserMe();
    window.location.reload();
  };

  private renderStatus(): TemplateResult {
    const periodEnd = this.sub.currentPeriodEnd
      ? this.sub.currentPeriodEnd.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : null;

    if (this.sub.cancelAtPeriodEnd) {
      return html`<div
        class="text-xs font-bold text-amber-400 uppercase tracking-wider"
      >
        ${periodEnd
          ? translateText("account_modal.sub_status_canceling_on", {
              date: periodEnd,
            })
          : translateText("account_modal.sub_status_canceling")}
      </div>`;
    }

    const isActive =
      this.sub.status === "active" || this.sub.status === "trialing";
    const colorClass = isActive ? "text-green-400" : "text-white/60";
    const translatedStatus = translateText(
      `account_modal.sub_status_${this.sub.status}`,
    );
    const statusLabel = translatedStatus.startsWith("account_modal.sub_status_")
      ? this.sub.status
      : translatedStatus;

    return html`<div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="font-bold ${colorClass} uppercase tracking-wider"
        >${statusLabel}</span
      >
      ${periodEnd
        ? html`<span class="text-white/50"
            >${translateText("account_modal.sub_renews_on", {
              date: periodEnd,
            })}</span
          >`
        : ""}
    </div>`;
  }

  render() {
    const { sub, cosmetic } = this;
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-6">
        <h3 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <span class="text-amber-400">⭐</span>
          ${translateText("account_modal.your_subscription")}
        </h3>
        <div
          class="flex flex-wrap items-start justify-between gap-4 p-4 rounded-lg bg-white/5 border border-white/10"
        >
          <div class="flex flex-col gap-3 flex-1 min-w-0">
            <div class="flex items-baseline gap-2 flex-wrap">
              <div class="text-base font-bold text-white">
                ${translateCosmetic(
                  "subscriptions",
                  cosmetic?.name ?? sub.tier,
                )}
              </div>
              ${cosmetic?.product?.price
                ? html`<div class="text-xs text-white/60">
                    ${translateText("account_modal.sub_price_monthly", {
                      price: cosmetic.product.price,
                    })}
                  </div>`
                : ""}
            </div>
            ${cosmetic?.description
              ? html`<div class="text-sm text-white/70">
                  ${cosmetic.description}
                </div>`
              : ""}
            ${cosmetic
              ? html`<div class="flex flex-wrap gap-4 mt-1">
                  <div class="flex items-center gap-1.5">
                    <plutonium-icon .size=${20}></plutonium-icon>
                    <span class="text-sm font-bold text-green-400"
                      >${cosmetic.dailyHardCurrency.toLocaleString()}</span
                    >
                    <span class="text-[10px] text-white/50 uppercase"
                      >${translateText("cosmetics.per_day")}</span
                    >
                  </div>
                  <div class="flex items-center gap-1.5">
                    <cap-icon .size=${20}></cap-icon>
                    <span class="text-sm font-bold text-amber-700"
                      >${cosmetic.dailySoftCurrency.toLocaleString()}</span
                    >
                    <span class="text-[10px] text-white/50 uppercase"
                      >${translateText("cosmetics.per_day")}</span
                    >
                  </div>
                </div>`
              : ""}
          </div>
          <div class="flex flex-col items-end gap-2">
            ${this.renderStatus()}
            <div class="flex flex-wrap justify-end gap-2">
              ${sub.cancelAtPeriodEnd
                ? html`<o-button
                    variant="secondary"
                    size="xs"
                    translationKey="account_modal.reactivate_subscription"
                    @click=${this.handleManage}
                  ></o-button>`
                : html`
                    <o-button
                      variant="secondary"
                      size="xs"
                      translationKey="account_modal.manage_subscription"
                      @click=${this.handleManage}
                    ></o-button>
                    <o-button
                      variant="secondary"
                      size="xs"
                      translationKey="account_modal.change_tier"
                      @click=${this.handleChangeTier}
                    ></o-button>
                  `}
            </div>
            ${sub.cancelAtPeriodEnd
              ? ""
              : html`<div class="flex justify-center w-full">
                  <o-button
                    variant="danger"
                    size="xs"
                    translationKey="account_modal.cancel_subscription"
                    @click=${this.handleCancel}
                  ></o-button>
                </div>`}
          </div>
        </div>
      </div>
    `;
  }
}
