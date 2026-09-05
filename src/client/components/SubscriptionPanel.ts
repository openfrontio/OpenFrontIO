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
import { isDesktopShell } from "../DesktopShell";
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

  /**
   * Is this subscription a GRANT — free access nobody is billing — rather than
   * something the player bought?
   *
   * OPE-314. A grant has no billing period to run out, so the server's cancel
   * expires it on the spot and revokes the premium username with it, and the
   * ledger only ever earns the grant once, so it does not come back. The panel
   * therefore must not offer Cancel (nor Manage or Change Tier, which have no
   * billing to reach) and must not claim the month renews.
   *
   * `=== null`, deliberately, and never `!this.sub.provider`:
   *
   *   null      — granted. Hide the destructive controls.
   *   undefined — the field is absent because the server predates it. We
   *               CANNOT tell a grant from a Stripe subscription, so keep
   *               today's behaviour; hiding Cancel on this path would take the
   *               one control a paying subscriber actually needs.
   *
   * A truthiness test is true for both and would do the wrong thing on the
   * second — which is the whole hazard, because `provider` is on `main` but not
   * yet on staging, so `undefined` is the live case until the next deploy.
   */
  private isGranted(): boolean {
    return this.sub.provider === null;
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
  //
  // A grant never renews — `sub_renews_on` was a straight falsehood on it — so
  // it gets an ends-on line instead. Checked before `cancelAtPeriodEnd` because
  // a grant is never winding down: the server has no pending-cancel state for
  // one, it expires immediately.
  private renderPeriodLine(): TemplateResult | typeof nothing {
    const periodEnd = this.periodEnd();
    if (!periodEnd) return nothing;
    const dateKey = this.isGranted()
      ? "account_modal.sub_granted_ends_on"
      : this.sub.cancelAtPeriodEnd
        ? "account_modal.sub_status_canceling_on"
        : "account_modal.sub_renews_on";
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
      <span>${translateText(dateKey, { date: periodEnd })}</span>
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

  /**
   * Static copy replacing the Manage/Reactivate button in the desktop build.
   *
   * Both of those go through the Stripe billing portal, and the packaged Steam
   * build must never steer a player to a payment page -- `navigationPolicy.ts`
   * refuses the link-out, so the button is dead. Worse than dead, once infra
   * accepts `app://openfront` as a returnUrl: the click then raises the
   * shell's "Purchase unavailable / nothing has been charged" dialog at a
   * player who is trying to STOP paying.
   *
   * Deliberately NOT a link. Naming the website as a fact is not steering to a
   * payment page; handing over a clickable route to one is exactly what the
   * rule forbids. So: no anchor, no URL, no click handler.
   */
  private renderManageOnWeb(): TemplateResult {
    return html`
      <p class="text-[11px] text-center text-white/40 leading-snug">
        ${translateText("account_modal.manage_subscription_on_web")}
      </p>
    `;
  }

  /**
   * The actions area for a grant: no buttons at all, just what it is.
   *
   * Every control on this panel is about billing, and a grant has none. Manage
   * and Change Tier reach a billing account that does not exist; Cancel does
   * something far worse than nothing (see `isGranted`). So the whole row is
   * replaced by static copy — no anchor, no click handler, same shape as
   * `renderManageOnWeb`.
   *
   * Two variants, on a fact the client already has rather than a guess. Grants
   * come from two writers and only one of them sets an end date: a Steam
   * ownership grant is a fixed free month (`currentPeriodEnd = now + 30d`), an
   * admin comp is open-ended (`currentPeriodEnd` null, so no date line renders
   * above either). Telling an admin-comped player their access came from a
   * Steam purchase would be a fresh instance of exactly the dishonesty this
   * change exists to remove.
   */
  private renderGrantedNote(): TemplateResult {
    return html`
      <p class="text-[11px] text-center text-white/40 leading-snug">
        ${translateText(
          this.sub.currentPeriodEnd
            ? "account_modal.sub_granted_from_purchase"
            : "account_modal.sub_granted_indefinite",
        )}
      </p>
    `;
  }

  private renderActions(): TemplateResult {
    // Before every other branch, and NOT gated on the desktop shell: a grant is
    // a property of the account, so a Steam buyer who signs in on the website
    // sees the same panel and would meet the same one-way Cancel there.
    if (this.isGranted()) return this.renderGrantedNote();

    // The whole desktop build, not just a Steam-authenticated session: the
    // guard that makes the button dead is in the shell and applies to every
    // packaged launch.
    const onDesktop = isDesktopShell();

    if (this.sub.cancelAtPeriodEnd) {
      if (onDesktop) return this.renderManageOnWeb();
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
          ${onDesktop
            ? nothing
            : html`<o-button
                class="flex-1 min-w-[8rem]"
                variant="secondary"
                width="block"
                size="md"
                translationKey="account_modal.manage_subscription"
                @click=${this.handleManage}
              ></o-button>`}
        </div>
        ${onDesktop ? this.renderManageOnWeb() : nothing}
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
