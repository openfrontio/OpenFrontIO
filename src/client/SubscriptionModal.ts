import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { Cosmetics } from "../core/CosmeticSchemas";
import "./components/SubscriptionPanel";
import { fetchCosmetics } from "./Cosmetics";
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
    const sub = userMe.player.subscription;
    if (!sub) {
      return html`
        <div class="p-6">
          <div
            class="bg-white/5 rounded-xl border border-white/10 p-8 text-center flex flex-col items-center gap-4"
          >
            <p class="text-white/60 text-sm">
              ${translateText("subscription_modal.none")}
            </p>
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
    return html`
      <div class="custom-scrollbar mr-1">
        <div class="p-6">
          <subscription-panel
            .sub=${sub}
            .cosmetic=${this.cosmetics?.subscriptions?.[sub.tier] ?? null}
            @request-close=${() => this.close()}
          ></subscription-panel>
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
