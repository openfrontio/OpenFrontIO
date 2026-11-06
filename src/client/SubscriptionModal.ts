import {
  giftSubscriptionOf,
  paidSubscriptionOf,
  UserMeResponse,
  UserSubscription,
} from "@openfront/shared/ApiSchemas";
import { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { renderFreePlayPerks } from "./components/FreePlayPerks";
import "./components/SubscriptionPanel";
import { fetchCosmetics, subscriptionTier } from "./Cosmetics";
import { ProfileMenuModal } from "./ProfileMenuModal";
import { translateText } from "./Utils";

/**
 * Standalone subscription management, opened from the nav profile menu
 * (`#modal=subscription`). The menu only offers it to subscribers, but the
 * modal is reachable by URL, so it also handles the no-subscription case by
 * pointing at the store's subscriptions tab.
 */
@customElement("subscription-modal")
export class SubscriptionModal extends ProfileMenuModal {
  protected routerName = "subscription";
  protected titleKey = "subscription_modal.title";

  @state() private cosmetics: Cosmetics | null = null;

  protected renderSignedIn(userMe: UserMeResponse): TemplateResult {
    const pastDue = userMe.player.pastDueSubscription;
    // A past_due subscription renders on the same panel, which branches on
    // its status to offer only the billing portal. The server sends it only
    // for Stripe, and a renewal that failed has no period worth showing.
    const paid: UserSubscription | null =
      paidSubscriptionOf(userMe.player) ??
      (pastDue
        ? {
            tier: pastDue.tier,
            status: "past_due",
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            provider: "stripe",
          }
        : null);
    const gift = giftSubscriptionOf(userMe.player);
    if (!paid && !gift) {
      return html`
        <div class="p-6">
          <div
            class="bg-white/5 rounded-xl border border-white/10 p-8 text-center flex flex-col items-center gap-4"
          >
            <p class="text-white/60 text-sm">
              ${translateText("subscription_modal.none")}
            </p>
            <div class="w-full text-left rounded-lg bg-white/5 px-4 py-3">
              ${userMe.steamLicence
                ? renderFreePlayPerks("free_play.licence_heading", true)
                : renderFreePlayPerks("free_play.free_heading")}
            </div>
            <o-button
              variant="primary"
              size="md"
              translationKey="subscription_modal.browse"
              @click=${() => {
                this.close();
                window.location.hash = "modal=store&tab=subscriptions";
              }}
            ></o-button>
          </div>
        </div>
      `;
    }
    const stacked = paid !== null && gift !== null;
    const panel = (sub: UserSubscription, role: "paid" | "gift") => html`
      <subscription-panel
        .sub=${sub}
        .cosmetic=${subscriptionTier(this.cosmetics, sub.tier)}
        .steamLicence=${userMe.steamLicence}
        .stacked=${stacked ? role : null}
        @request-close=${() => this.close()}
      ></subscription-panel>
    `;
    return html`
      <div class="custom-scrollbar mr-1">
        <div class="p-6 flex flex-col gap-4">
          ${paid ? panel(paid, "paid") : ""} ${gift ? panel(gift, "gift") : ""}
        </div>
      </div>
    `;
  }

  protected onOpenExtra(): void {
    void fetchCosmetics().then((cosmetics) => {
      this.cosmetics = cosmetics;
    });
  }
}
