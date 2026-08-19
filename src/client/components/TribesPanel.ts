import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import {
  GetMyTribeNamesResponse,
  TribeName,
  TribeNameStatus,
  UserMeResponse,
} from "../../core/ApiSchemas";
import { Cosmetics } from "../../core/CosmeticSchemas";
import {
  boostTribeName,
  getMyTribeNames,
  getUserMe,
  invalidateUserMe,
  purchaseTribeName,
} from "../Api";
import { fetchCosmetics, InsufficientCurrency } from "../Cosmetics";
import { showInGameConfirm } from "../InGameModal";
import { translateText } from "../Utils";
import { renderLoadingSpinner } from "./BaseModal";
import "./InsufficientCurrencyDialog";
import "./PlutoniumIcon";
import "./TribeStatsView";

const MAX_TRIBE_NAME_LENGTH = 100;

// A name goes live in games as soon as it's bought; review happens afterwards
// and can only take a bad name down. So players only care about two states:
// active (pending or live) or rejected (rejected or revoked).
type TribeDisplayState = "active" | "rejected";

const DISPLAY_STATE: Record<TribeNameStatus, TribeDisplayState> = {
  pending: "active",
  live: "active",
  rejected: "rejected",
  revoked: "rejected",
};

const STATE_META: Record<
  TribeDisplayState,
  { labelKey: string; classes: string }
> = {
  active: {
    labelKey: "store.tribe_status_active",
    classes: "bg-green-500/20 text-green-300 border-green-500/30",
  },
  rejected: {
    labelKey: "store.tribe_status_rejected",
    classes: "bg-red-500/20 text-red-300 border-red-500/30",
  },
};

// The store's Tribes tab: buy a custom bot tribe name and see the ones you own.
// Self-contained (fetches its own list) like <effects-grid>; the store passes
// in the logged-in user so the panel can gate on login and refresh the header
// balance after a purchase.
@customElement("tribes-panel")
export class TribesPanel extends LitElement {
  @property({ attribute: false }) userMeResponse: UserMeResponse | false =
    false;

  // null = not loaded yet; false = load failed; otherwise the fetched data.
  @state() private data: GetMyTribeNamesResponse | false | null = null;
  @state() private purchasing = false;
  @state() private notice: { kind: "success" | "error"; text: string } | null =
    null;
  // Boost pricing from cosmetics.json; null hides boost purchasing entirely
  // (an older cosmetics.json without the tribeNames block).
  @state() private tribeNamesConfig: NonNullable<
    Cosmetics["tribeNames"]
  > | null = null;
  // id of the name whose boost purchase is in flight (all boost buttons
  // disable while set, preventing the double-submit the API doc warns about).
  @state() private boostingId: string | null = null;
  @state() private boostNotice: {
    kind: "success" | "error";
    text: string;
  } | null = null;
  @state() private insufficientInfo: InsufficientCurrency | null = null;
  // Name whose stats page is open in place of the list; null shows the list.
  @state() private statsName: string | null = null;

  @query("#tribe-name-input") private input?: HTMLInputElement;

  // Fetch once, the first time we know the user is logged in.
  private loadStarted = false;

  createRenderRoot() {
    return this;
  }

  protected updated() {
    if (!this.loadStarted && this.userMeResponse !== false) {
      this.loadStarted = true;
      void this.load();
    }
  }

  private async load() {
    const [data, cosmetics] = await Promise.all([
      getMyTribeNames(),
      fetchCosmetics(), // cached after the first call
    ]);
    this.data = data;
    this.tribeNamesConfig = cosmetics?.tribeNames ?? null;
  }

  // Name purchase price from cosmetics.json — the only source; the button
  // stays disabled when the tribeNames block is absent.
  private get price(): number | null {
    return this.tribeNamesConfig?.priceHard ?? null;
  }

  private get hardBalance(): number {
    if (this.userMeResponse === false) return 0;
    return this.userMeResponse.player.currency?.hard ?? 0;
  }

  private submit = async (e: Event) => {
    e.preventDefault();
    if (this.purchasing) return;
    const name = this.input?.value.trim() ?? "";
    if (name.length === 0) {
      this.notice = {
        kind: "error",
        text: translateText("store.tribe_name_required"),
      };
      return;
    }

    this.purchasing = true;
    this.notice = null;
    const result = await purchaseTribeName(name);
    this.purchasing = false;

    if (result.ok) {
      if (this.input) this.input.value = "";
      this.notice = {
        kind: "success",
        text: translateText("store.tribe_purchase_live", {
          name: result.data.displayName,
        }),
      };
      await this.refreshAfterPurchase();
      return;
    }
    if (result.code === "duplicate") {
      this.notice = {
        kind: "error",
        text: translateText("store.tribe_duplicate"),
      };
      return;
    }
    if (result.code === "rate_limited") {
      const secs = result.retryAfterSeconds;
      // The server always sends Retry-After; if it's somehow missing, the
      // generic failure message below covers it.
      this.notice = {
        kind: "error",
        text:
          secs && secs > 0
            ? translateText("store.tribe_rate_limited", { seconds: secs })
            : translateText("store.purchase_failed"),
      };
      return;
    }
    // "invalid" carries the server's player-facing reason (bad name,
    // disallowed, or insufficient balance); fall back to a generic message.
    let text = translateText("store.purchase_failed");
    if (result.code === "invalid" && result.message) {
      text = result.message;
    }
    this.notice = { kind: "error", text };
  };

  // A purchase spends plutonium and adds a pending name, so refresh both the
  // list and the store header's balance (re-broadcast /users/@me like Main.ts).
  private async refreshAfterPurchase() {
    await this.load();
    invalidateUserMe();
    const fresh = await getUserMe();
    // getUserMe returns false on any error, not just auth — broadcasting
    // that would flip the whole app to its logged-out UI right after a
    // successful purchase. A stale header balance is the better failure.
    if (fresh === false) return;
    document.dispatchEvent(
      new CustomEvent("userMeResponse", {
        detail: fresh,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  private showInsufficient(tribe: TribeName, price: number) {
    this.insufficientInfo = {
      currency: translateText("cosmetics.hard"),
      shortfall: Math.max(1, price - this.hardBalance),
      item: tribe.displayName,
      canTopUp: true,
    };
  }

  private boost = async (tribe: TribeName) => {
    const cfg = this.tribeNamesConfig;
    if (cfg === null || this.boostingId !== null) return;
    const price = cfg.boostPriceHard;

    // Don't let the player submit into a guaranteed 400 — offer top-up.
    if (this.hardBalance < price) {
      this.showInsufficient(tribe, price);
      return;
    }

    const confirmed = await showInGameConfirm(
      translateText("store.tribe_boost_confirm", {
        name: tribe.displayName,
        price,
        days: cfg.boostDurationDays,
      }),
      {
        heading: translateText("store.tribe_boost_heading"),
        variant: "warning",
      },
    );
    if (!confirmed) return;

    this.boostingId = tribe.id;
    this.boostNotice = null;
    // Fresh key per user-initiated purchase. We never auto-retry (a retry of
    // this click would reuse it), so the key's job is to make an accidental
    // duplicate submit return the original boost instead of charging twice.
    const result = await boostTribeName(tribe.id, crypto.randomUUID());
    this.boostingId = null;

    if (result.ok) {
      this.boostNotice = {
        kind: "success",
        text: translateText("store.tribe_boost_success", {
          name: tribe.displayName,
        }),
      };
      await this.refreshAfterPurchase();
      return;
    }
    if (result.code === "insufficient_balance") {
      // The balance moved under us (another tab, another purchase) —
      // refresh it and show the top-up path.
      await this.refreshAfterPurchase();
      this.showInsufficient(tribe, price);
      return;
    }
    if (result.code === "not_found") {
      // Taken down while the page was open; the refreshed list will come
      // back rejected/revoked with the review reason.
      this.boostNotice = {
        kind: "error",
        text: translateText("store.tribe_boost_gone"),
      };
      await this.load();
      return;
    }
    this.boostNotice = {
      kind: "error",
      text: translateText("store.tribe_boost_failed"),
    };
  };

  private renderLoginPrompt(): TemplateResult {
    return html`<div
      class="flex flex-col items-center justify-center gap-4 py-16 text-center"
    >
      <p class="text-white/60 font-medium">
        ${translateText("store.tribes_login_required")}
      </p>
      <button
        class="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase tracking-wider text-sm transition-colors cursor-pointer"
        @click=${() => window.showPage?.("page-account")}
      >
        ${translateText("main.sign_in")}
      </button>
    </div>`;
  }

  private renderPurchaseCard(): TemplateResult {
    const price = this.price;
    return html`<section
      class="bg-surface rounded-xl border border-white/10 p-6 flex flex-col gap-3"
    >
      <h3 class="text-lg font-bold text-white">
        ${translateText("store.tribes_purchase_heading")}
      </h3>
      <p class="text-white/60 text-sm leading-relaxed">
        ${translateText("store.tribes_purchase_description")}
      </p>
      <form class="flex flex-col sm:flex-row gap-2" @submit=${this.submit}>
        <label for="tribe-name-input" class="sr-only"
          >${translateText("store.tribe_name_placeholder")}</label
        >
        <input
          id="tribe-name-input"
          type="text"
          maxlength=${MAX_TRIBE_NAME_LENGTH}
          placeholder=${translateText("store.tribe_name_placeholder")}
          class="flex-1 min-w-0 bg-black/30 border border-white/10 rounded px-3 py-2 text-white outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/40"
          ?disabled=${this.purchasing}
        />
        <button
          type="submit"
          class="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded px-4 py-2 whitespace-nowrap transition-colors cursor-pointer"
          ?disabled=${this.purchasing || price === null}
        >
          ${translateText("store.purchase_tribe_button")}
          ${price !== null
            ? html`<span class="flex items-center gap-1">
                <plutonium-icon .size=${18}></plutonium-icon>${price}
              </span>`
            : ""}
        </button>
      </form>
      ${this.notice
        ? html`<p
            class="text-sm font-medium ${this.notice.kind === "success"
              ? "text-green-400"
              : "text-red-400"}"
          >
            ${this.notice.text}
          </p>`
        : ""}
    </section>`;
  }

  // "2 boosts · next boost expires Aug 5" under an actively boosted name.
  // The date is when the NEXT boost lapses (the API serves min(expiresAt)),
  // i.e. when the count drops — not when boosting ends entirely.
  private renderBoostStatus(tribe: TribeName): TemplateResult | typeof nothing {
    const boosts = tribe.activeBoosts ?? 0;
    if (boosts === 0) return nothing;
    const countText =
      boosts === 1
        ? translateText("store.tribe_boost_count")
        : translateText("store.tribe_boost_count_plural", { count: boosts });
    // The wire format has wobbled (ISO vs raw pg text); if this browser
    // can't parse it, show the count alone rather than "Invalid Date".
    const parsed = tribe.boostExpiresAt ? new Date(tribe.boostExpiresAt) : null;
    const until =
      parsed !== null && !Number.isNaN(parsed.getTime())
        ? parsed.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })
        : null;
    return html`<span class="text-xs text-amber-300 mt-0.5">
      ${countText}${until
        ? html` ·
          ${translateText("store.tribe_boost_next_expiry", { date: until })}`
        : ""}
    </span>`;
  }

  private renderBoostButton(tribe: TribeName): TemplateResult | typeof nothing {
    const cfg = this.tribeNamesConfig;
    // Only active (pending/live) names can be boosted, and only when
    // cosmetics.json serves the price — never hardcode it.
    if (cfg === null || DISPLAY_STATE[tribe.status] !== "active") {
      return nothing;
    }
    return html`<button
      class="shrink-0 flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold uppercase tracking-wider rounded px-2.5 py-1.5 transition-colors cursor-pointer"
      ?disabled=${this.boostingId !== null}
      @click=${() => this.boost(tribe)}
    >
      ${translateText("store.tribe_boost_button")}
      <span class="flex items-center gap-0.5 normal-case">
        <plutonium-icon .size=${14}></plutonium-icon>${cfg.boostPriceHard}
      </span>
    </button>`;
  }

  // Rejected/revoked names deliberately 404 on the public stats endpoint,
  // so only active names get the button.
  private renderStatsButton(tribe: TribeName): TemplateResult | typeof nothing {
    if (DISPLAY_STATE[tribe.status] !== "active") return nothing;
    return html`<button
      class="shrink-0 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs font-bold uppercase tracking-wider rounded px-2.5 py-1.5 transition-colors cursor-pointer"
      @click=${() => (this.statsName = tribe.displayName)}
    >
      ${translateText("store.tribe_stats_button")}
    </button>`;
  }

  private renderTribeRow(tribe: TribeName): TemplateResult {
    const meta = STATE_META[DISPLAY_STATE[tribe.status]];
    return html`<div
      class="flex items-center justify-between gap-3 bg-surface rounded-lg border border-white/10 px-4 py-3"
    >
      <div class="flex flex-col min-w-0">
        <span class="font-bold text-white truncate">${tribe.displayName}</span>
        ${this.renderBoostStatus(tribe)}
        ${tribe.reviewReason
          ? html`<span class="text-xs text-white/50 mt-0.5"
              >${tribe.reviewReason}</span
            >`
          : ""}
      </div>
      <div class="shrink-0 flex items-center gap-2">
        ${this.renderStatsButton(tribe)} ${this.renderBoostButton(tribe)}
        <span
          class="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded border ${meta.classes}"
        >
          ${translateText(meta.labelKey)}
        </span>
      </div>
    </div>`;
  }

  private renderList(): TemplateResult {
    if (this.data === null) {
      return renderLoadingSpinner();
    }
    if (this.data === false) {
      return html`<p
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.tribes_load_failed")}
      </p>`;
    }
    // Most-boosted names first. The sort is stable, so within equal boost
    // counts the API's newest-first order is preserved (unboosted and
    // rejected names all tie at 0 and keep their relative order).
    const names = [...this.data.names].sort(
      (a, b) => (b.activeBoosts ?? 0) - (a.activeBoosts ?? 0),
    );
    if (names.length === 0) {
      return html`<p
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_tribes")}
      </p>`;
    }
    return html`<div class="flex flex-col gap-2">
      ${names.map((tribe) => this.renderTribeRow(tribe))}
    </div>`;
  }

  render(): TemplateResult {
    if (this.userMeResponse === false) {
      return this.renderLoginPrompt();
    }
    // The stats page takes over the whole tab, profile-modal style; its back
    // button returns to the list.
    if (this.statsName !== null) {
      return html`<div
        class="p-6 lg:p-8 flex flex-col gap-6 max-w-2xl mx-auto w-full"
      >
        <tribe-stats-view
          .tribeName=${this.statsName}
          @back=${() => (this.statsName = null)}
        ></tribe-stats-view>
      </div>`;
    }
    return html`<div
      class="p-6 lg:p-8 flex flex-col gap-6 max-w-2xl mx-auto w-full"
    >
      ${this.renderPurchaseCard()}
      <section class="flex flex-col gap-3">
        <h3
          class="text-sm font-bold uppercase tracking-wider text-white/60 px-1"
        >
          ${translateText("store.your_tribes_heading")}
        </h3>
        ${this.boostNotice
          ? html`<p
              class="text-sm font-medium px-1 ${this.boostNotice.kind ===
              "success"
                ? "text-green-400"
                : "text-red-400"}"
            >
              ${this.boostNotice.text}
            </p>`
          : ""}
        ${this.renderList()}
      </section>
      <insufficient-currency-dialog
        .info=${this.insufficientInfo}
        @close=${() => (this.insufficientInfo = null)}
      ></insufficient-currency-dialog>
    </div>`;
  }
}
