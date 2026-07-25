import { html, LitElement, TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import {
  GetMyTribeNamesResponse,
  TribeName,
  TribeNameStatus,
  UserMeResponse,
} from "../../core/ApiSchemas";
import {
  getMyTribeNames,
  getUserMe,
  invalidateUserMe,
  purchaseTribeName,
} from "../Api";
import { translateText } from "../Utils";
import { renderLoadingSpinner } from "./BaseModal";
import "./PlutoniumIcon";

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

  // null = not loaded yet; false = load failed; otherwise the fetched data
  // (which also carries the current purchase price).
  @state() private data: GetMyTribeNamesResponse | false | null = null;
  @state() private purchasing = false;
  @state() private notice: { kind: "success" | "error"; text: string } | null =
    null;

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
    this.data = await getMyTribeNames();
  }

  private get price(): number | null {
    return this.data ? this.data.priceHard : null;
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
      this.notice = {
        kind: "error",
        text:
          secs && secs > 0
            ? translateText("store.tribe_rate_limited_seconds", {
                seconds: secs,
              })
            : translateText("store.tribe_rate_limited"),
      };
      return;
    }
    // "invalid" carries the server's player-facing reason (bad name,
    // disallowed, or insufficient balance); fall back to a generic message.
    let text = translateText("store.tribe_purchase_failed");
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
    document.dispatchEvent(
      new CustomEvent("userMeResponse", {
        detail: fresh,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

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

  private renderTribeRow(tribe: TribeName): TemplateResult {
    const meta = STATE_META[DISPLAY_STATE[tribe.status]];
    return html`<div
      class="flex items-center justify-between gap-3 bg-surface rounded-lg border border-white/10 px-4 py-3"
    >
      <div class="flex flex-col min-w-0">
        <span class="font-bold text-white truncate">${tribe.displayName}</span>
        ${tribe.reviewReason
          ? html`<span class="text-xs text-white/50 mt-0.5"
              >${tribe.reviewReason}</span
            >`
          : ""}
      </div>
      <span
        class="shrink-0 text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded border ${meta.classes}"
      >
        ${translateText(meta.labelKey)}
      </span>
    </div>`;
  }

  private renderList(): TemplateResult {
    if (this.data === null) {
      return renderLoadingSpinner();
    }
    const names = this.data === false ? [] : this.data.names;
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
        ${this.renderList()}
      </section>
    </div>`;
  }
}
