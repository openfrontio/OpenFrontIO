import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { Cosmetics } from "../core/CosmeticSchemas";
import { getUserMe } from "./Api";
import { BaseModal } from "./components/BaseModal";
import "./components/SubscriptionPanel";
import { modalHeader } from "./components/ui/ModalHeader";
import { signedOutNotice } from "./components/ui/SignedOutNotice";
import { fetchCosmetics } from "./Cosmetics";
import { translateText } from "./Utils";

/**
 * Standalone subscription management, opened from the nav profile menu
 * (`#modal=subscription`). The menu only offers it to subscribers, but the
 * modal is reachable by URL, so it also handles the no-subscription case by
 * pointing at the store's subscriptions tab.
 */
@customElement("subscription-modal")
export class SubscriptionModal extends BaseModal {
  protected routerName = "subscription";

  @state() private userMeResponse: UserMeResponse | false = false;
  @state() private isLoadingUser = false;
  @state() private cosmetics: Cosmetics | null = null;

  protected modalConfig() {
    return { maxWidth: "620px" };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("subscription_modal.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected renderBody(): TemplateResult {
    if (this.isLoadingUser) {
      return this.renderLoadingSpinner(
        translateText("account_modal.fetching_account"),
      );
    }
    if (this.userMeResponse === false) {
      return signedOutNotice(() => {
        this.close();
        window.showPage?.("page-account");
      });
    }
    const sub = this.userMeResponse.player.subscription;
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
          ></subscription-panel>
        </div>
      </div>
    `;
  }

  protected onOpen(): void {
    this.isLoadingUser = true;
    void fetchCosmetics().then((cosmetics) => {
      this.cosmetics = cosmetics;
    });
    void getUserMe()
      .then((userMe) => {
        this.userMeResponse = userMe ?? false;
      })
      .catch((err) => {
        console.warn("SubscriptionModal: failed to fetch user", err);
      })
      .finally(() => {
        this.isLoadingUser = false;
      });
  }
}
