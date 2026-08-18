import { html, LitElement, render as litRender } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { getUserMe } from "../../Api";
import { type ClanCurrencyType, donateToClan } from "../../ClanApi";
import { translateText } from "../../Utils";
import "../CapIcon";
import { formatCurrencyAmount } from "../CurrencyDisplay";
import "../PlutoniumIcon";

// UUID when available; crypto.randomUUID is undefined outside secure contexts
// (e.g. dev over plain http on a LAN address), so fall back to random hex of
// the same shape. Either way 8–64 chars, as the API requires.
function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// The player's wallet balances arrive as numbers (CurrencyBalancesSchema); the
// entered amount is compared as BigInt so a very large integer isn't rounded.
function balanceToBigInt(balance: number): bigint {
  return BigInt(Math.trunc(balance));
}

/**
 * Overlay for donating the signed-in player's own currency to a clan. Donations
 * are one-way and final — the API never credits a clan balance back to a player
 * — so the player must acknowledge that before confirming, with extra emphasis
 * for hard (premium, real-money) currency.
 *
 * Emits `donated` ({ currencyType, amount }) on success and `cancel` when
 * dismissed. One idempotency key is minted per open and reused for every
 * submit from this dialog, so a retry after a dead network cannot double-spend.
 */
@customElement("clan-donate-dialog")
export class ClanDonateDialog extends LitElement {
  @property() clanTag = "";

  @state() private currencyType: ClanCurrencyType = "soft";
  @state() private amountInput = "";
  @state() private balances: { soft: number; hard: number } | null = null;
  @state() private submitting = false;
  @state() private serverError: string | null = null;

  private idempotencyKey = newIdempotencyKey();
  private portal: HTMLDivElement | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.portal = document.createElement("div");
    document.body.appendChild(this.portal);
    void this.loadBalances();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.portal) {
      litRender(html``, this.portal);
      this.portal.remove();
      this.portal = null;
    }
  }

  private async loadBalances() {
    const me = await getUserMe();
    if (!this.isConnected) return;
    if (!me || !me.player.currency) return;
    this.balances = me.player.currency;
  }

  private currencyLabel(type: ClanCurrencyType = this.currencyType): string {
    return translateText(type === "hard" ? "cosmetics.hard" : "cosmetics.soft");
  }

  // Null when the input is empty or not a positive integer.
  private parsedAmount(): bigint | null {
    const raw = this.amountInput.trim();
    if (!/^\d+$/.test(raw)) return null;
    const amount = BigInt(raw);
    return amount > 0n ? amount : null;
  }

  private exceedsBalance(amount: bigint): boolean {
    if (!this.balances) return false;
    return amount > balanceToBigInt(this.balances[this.currencyType]);
  }

  private validationError(): string | null {
    if (this.amountInput.trim() === "") return null;
    const amount = this.parsedAmount();
    if (amount === null)
      return translateText("clan_modal.donate_invalid_amount");
    if (this.exceedsBalance(amount)) {
      return translateText("clan_modal.donate_insufficient", {
        currency: this.currencyLabel(),
      });
    }
    return null;
  }

  private canSubmit(): boolean {
    const amount = this.parsedAmount();
    return !this.submitting && amount !== null && !this.exceedsBalance(amount);
  }

  private selectCurrency(type: ClanCurrencyType) {
    if (this.submitting || type === this.currencyType) return;
    this.currencyType = type;
    this.serverError = null;
  }

  private onAmountInput(e: Event) {
    this.amountInput = (e.target as HTMLInputElement).value;
    this.serverError = null;
  }

  private cancel() {
    if (this.submitting) return;
    this.dispatchEvent(new CustomEvent("cancel"));
  }

  private async submit() {
    const amount = this.parsedAmount();
    if (!this.canSubmit() || amount === null) return;
    this.submitting = true;
    this.serverError = null;
    try {
      const result = await donateToClan(
        this.clanTag,
        this.currencyType,
        amount.toString(),
        this.idempotencyKey,
      );
      if (result !== true) {
        this.serverError = translateText(result.error, {
          currency: this.currencyLabel(),
        });
        return;
      }
      this.dispatchEvent(
        new CustomEvent("donated", {
          detail: {
            currencyType: this.currencyType,
            amount: amount.toString(),
          },
        }),
      );
    } finally {
      this.submitting = false;
    }
  }

  render() {
    if (this.portal) {
      litRender(this.renderOverlay(), this.portal);
    }
    return html``;
  }

  private renderCurrencyOption(type: ClanCurrencyType) {
    const selected = this.currencyType === type;
    const balance = this.balances
      ? formatCurrencyAmount(this.balances[type])
      : null;
    return html`
      <button
        type="button"
        role="radio"
        aria-checked=${selected}
        data-currency=${type}
        ?disabled=${this.submitting}
        @click=${() => this.selectCurrency(type)}
        class="flex-1 flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl border transition-all ${selected
          ? "bg-white/10 border-white/40 text-white"
          : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white"} disabled:opacity-50 disabled:pointer-events-none"
      >
        <span
          class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"
        >
          ${type === "hard"
            ? html`<plutonium-icon .size=${14}></plutonium-icon>`
            : html`<cap-icon .size=${16}></cap-icon>`}
          ${this.currencyLabel(type)}
        </span>
        <span class="text-[11px] text-white/50">
          ${balance === null
            ? "…"
            : translateText("clan_modal.donate_your_balance", {
                balance,
              })}
        </span>
      </button>
    `;
  }

  private renderOverlay() {
    const isHard = this.currencyType === "hard";
    const validationError = this.validationError();
    const error = this.serverError ?? validationError;
    const canSubmit = this.canSubmit();

    return html`
      <div
        class="fixed inset-0 z-[10020] flex items-center justify-center bg-black/80"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.cancel();
        }}
      >
        <div
          class="relative mx-4 w-full max-w-md p-6 rounded-2xl border ${isHard
            ? "border-red-500/50"
            : "border-amber-500/50"} bg-surface shadow-2xl"
        >
          <h2 class="text-lg font-bold text-white mb-1">
            ${translateText("clan_modal.donate_title", { tag: this.clanTag })}
          </h2>
          <p class="text-white/50 text-xs mb-4">
            ${translateText("clan_modal.donate_subtitle")}
          </p>

          <div role="radiogroup" class="flex gap-2 mb-4">
            ${this.renderCurrencyOption("soft")}
            ${this.renderCurrencyOption("hard")}
          </div>

          <label
            class="block text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2"
            for="clan-donate-amount"
            >${translateText("clan_modal.donate_amount")}</label
          >
          <input
            id="clan-donate-amount"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            placeholder="0"
            .value=${this.amountInput}
            ?disabled=${this.submitting}
            @input=${(e: Event) => this.onAmountInput(e)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") void this.submit();
            }}
            class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium hover:bg-white/10 text-sm disabled:opacity-50"
          />
          ${error
            ? html`<p class="text-red-400 text-xs mt-2" role="alert">
                ${error}
              </p>`
            : ""}

          <div
            class="mt-4 rounded-xl border p-3 text-xs ${isHard
              ? "border-red-500/40 bg-red-500/10 text-red-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-300"}"
          >
            <p class="font-bold">
              ${translateText("clan_modal.donate_irreversible")}
            </p>
            ${isHard
              ? html`<p class="mt-1">
                  ${translateText("clan_modal.donate_irreversible_hard")}
                </p>`
              : ""}
          </div>

          <div class="flex gap-3 mt-5">
            <button
              type="button"
              @click=${() => this.cancel()}
              ?disabled=${this.submitting}
              class="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white/80 transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              ${translateText("common.cancel")}
            </button>
            <button
              type="button"
              data-action="donate"
              @click=${() => void this.submit()}
              ?disabled=${!canSubmit}
              class="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl text-white transition-all disabled:opacity-50 disabled:pointer-events-none border-0 ${isHard
                ? "bg-red-600 hover:bg-red-700"
                : "bg-amber-600 hover:bg-amber-700"}"
            >
              ${translateText(
                this.submitting
                  ? "clan_modal.donate_submitting"
                  : "clan_modal.donate",
              )}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
