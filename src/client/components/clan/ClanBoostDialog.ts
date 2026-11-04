import { html, LitElement, render as litRender } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  buyClanBoost,
  type ClanBoostStatus,
  type ClanBoostTier,
  fetchClanBoostStatus,
} from "../../ClanApi";
import { translateText } from "../../Utils";
import "../CapIcon";
import { formatCurrencyAmount } from "../CurrencyDisplay";
import "../PlutoniumIcon";
import { formatBoostRemaining } from "./ClanShared";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Same shape as ClanDonateDialog's: UUID when available, random hex outside
// secure contexts. 8–64 chars, as the API requires.
function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Tier lengths: whole days as days ("7 days"), anything else as hours.
function formatDuration(ms: number): string {
  if (ms >= DAY_MS && ms % DAY_MS === 0) {
    return translateText("clan_modal.boost_days", { days: ms / DAY_MS });
  }
  return formatHours(ms);
}

function formatHours(ms: number): string {
  return translateText("clan_modal.boost_hours", {
    hours: Math.round((ms / HOUR_MS) * 10) / 10,
  });
}

/**
 * Overlay for an officer or the leader to buy a clan boost with the CLAN's
 * balance. Tiers, prices, eligibility and the caps limit all come from
 * GET /clans/:tag/boost, so nothing here is hardcoded; the server re-checks
 * everything on purchase and its refusal is shown in place.
 *
 * Emits `boosted` ({ endsAt }) on success and `cancel` when dismissed. One
 * idempotency key per open, reused for every submit, so a retry after a dead
 * network cannot buy twice. After such a failure the purchase may have gone
 * through, so the tier is locked: the retry replays that purchase rather
 * than meeting the key again with another tier (which the server refuses).
 */
@customElement("clan-boost-dialog")
export class ClanBoostDialog extends LitElement {
  @property() clanTag = "";

  @state() private status: ClanBoostStatus | null = null;
  @state() private loadFailed = false;
  @state() private selectedTier: string | null = null;
  @state() private submitting = false;
  @state() private serverError: string | null = null;
  // Set once a submit failed without a server answer; see the class comment.
  @state() private tierLocked = false;

  private idempotencyKey = newIdempotencyKey();
  private portal: HTMLDivElement | null = null;
  // The Boost button that opened the dialog, refocused when it closes.
  private previouslyFocused: HTMLElement | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    this.portal = document.createElement("div");
    document.body.appendChild(this.portal);
    // Capture phase, so this runs before the clan modal's own window Escape
    // handler (BaseModal) and can stop it: Escape closes this dialog only.
    window.addEventListener("keydown", this.onKeydown, true);
    void this.loadStatus();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKeydown, true);
    if (this.portal) {
      litRender(html``, this.portal);
      this.portal.remove();
      this.portal = null;
    }
    if (this.previouslyFocused?.isConnected) this.previouslyFocused.focus();
    this.previouslyFocused = null;
  }

  private onKeydown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    this.cancel();
  };

  // Focus the dialog once its content (loaded async) has rendered.
  private focusDialog() {
    void this.updateComplete.then(() => {
      const target =
        this.portal?.querySelector<HTMLElement>(
          '[role="radio"][aria-checked="true"]',
        ) ?? this.portal?.querySelector<HTMLElement>('[role="dialog"]');
      target?.focus();
    });
  }

  private async loadStatus() {
    const status = await fetchClanBoostStatus(this.clanTag);
    if (!this.isConnected) return;
    if (status === false) {
      this.loadFailed = true;
      this.focusDialog();
      return;
    }
    this.status = status;
    this.selectedTier = status.tiers[0]?.tier ?? null;
    this.focusDialog();
  }

  private tier(): ClanBoostTier | null {
    return this.status?.tiers.find((t) => t.tier === this.selectedTier) ?? null;
  }

  private currencyLabel(currency: "soft" | "hard"): string {
    return translateText(
      currency === "hard" ? "cosmetics.hard" : "cosmetics.soft",
    );
  }

  private clanBalance(currency: "soft" | "hard"): bigint {
    if (!this.status) return 0n;
    return BigInt(
      currency === "hard" ? this.status.hardBalance : this.status.softBalance,
    );
  }

  // Why the selected tier can't be bought right now, from what the status
  // says; null when it looks buyable. The server has the final word.
  private blocker(): string | null {
    const status = this.status;
    const tier = this.tier();
    if (!status || !tier) return null;
    const e = status.eligibility;
    if (e.memberCount < e.minMembers) {
      return translateText("clan_modal.boost_error_not_enough_members", {
        min: e.minMembers,
      });
    }
    if (!e.recentlyActive) {
      return translateText("clan_modal.boost_error_not_recently_active");
    }
    if (
      tier.currency === "soft" &&
      status.softLimit.usedMs + tier.durationMs > status.softLimit.capMs
    ) {
      return translateText("clan_modal.boost_error_daily_limit");
    }
    if (BigInt(tier.price) > this.clanBalance(tier.currency)) {
      return translateText("clan_modal.boost_error_insufficient_balance", {
        currency: this.currencyLabel(tier.currency),
      });
    }
    return null;
  }

  private canSubmit(): boolean {
    return !this.submitting && this.tier() !== null && this.blocker() === null;
  }

  private selectTier(tier: string) {
    if (this.submitting || this.tierLocked || tier === this.selectedTier) {
      return;
    }
    this.selectedTier = tier;
    this.serverError = null;
  }

  // Radio-group keys: the arrows move the selection, and focus with it.
  private onTierKeydown(e: KeyboardEvent) {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    const tiers = this.status?.tiers ?? [];
    if (step === 0 || tiers.length === 0) return;
    e.preventDefault();
    const at = tiers.findIndex((t) => t.tier === this.selectedTier);
    const next = tiers[(at + step + tiers.length) % tiers.length];
    this.selectTier(next.tier);
    void this.updateComplete.then(() =>
      this.portal
        ?.querySelector<HTMLElement>(`[data-tier="${this.selectedTier}"]`)
        ?.focus(),
    );
  }

  private cancel() {
    if (this.submitting) return;
    this.dispatchEvent(new CustomEvent("cancel"));
  }

  private async submit() {
    const tier = this.tier();
    if (!this.canSubmit() || !tier) return;
    this.submitting = true;
    this.serverError = null;
    try {
      const result = await buyClanBoost(
        this.clanTag,
        tier.tier,
        this.idempotencyKey,
      );
      if ("error" in result) {
        if (result.error === "clan_modal.error_network") this.tierLocked = true;
        this.serverError = translateText(result.error, {
          currency: this.currencyLabel(tier.currency),
          min: this.status?.eligibility.minMembers ?? 0,
        });
        return;
      }
      this.dispatchEvent(
        new CustomEvent("boosted", { detail: { endsAt: result.endsAt } }),
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

  private renderTier(tier: ClanBoostTier) {
    const selected = tier.tier === this.selectedTier;
    return html`
      <button
        type="button"
        role="radio"
        aria-checked=${selected}
        tabindex=${selected ? 0 : -1}
        data-tier=${tier.tier}
        ?disabled=${this.submitting || (this.tierLocked && !selected)}
        @click=${() => this.selectTier(tier.tier)}
        class="flex-1 flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl border transition-all ${
          selected
            ? "bg-malibu-blue/15 border-aquarius/70 ring-2 ring-malibu-blue/40 text-white"
            : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white"
        } disabled:opacity-50 disabled:pointer-events-none"
      >
        <span class="text-xs font-bold uppercase tracking-wider">
          ${translateText(`clan_modal.boost_tier_${tier.tier}`)}
        </span>
        <span class="text-[11px]">${formatDuration(tier.durationMs)}</span>
        <span class="flex items-center gap-1 text-sm font-bold">
          ${this.currencyIcon(tier.currency)}
          ${formatCurrencyAmount(tier.price)}
        </span>
      </button>
    `;
  }

  private currencyIcon(currency: "soft" | "hard") {
    return currency === "hard"
      ? html`<plutonium-icon .size=${14}></plutonium-icon>`
      : html`<cap-icon .size=${16}></cap-icon>`;
  }

  private balanceLabel(currency: "soft" | "hard"): string {
    return translateText("clan_modal.boost_clan_balance", {
      balance: `${formatCurrencyAmount(
        this.clanBalance(currency).toString(),
      )} ${this.currencyLabel(currency)}`,
    });
  }

  // Caps boost time bought in the rolling window, as a small meter.
  private renderLimitMeter(status: ClanBoostStatus) {
    const { usedMs, capMs } = status.softLimit;
    const pct = capMs > 0 ? Math.min(100, (usedMs / capMs) * 100) : 0;
    const label = translateText("clan_modal.boost_limit_used", {
      used: formatHours(usedMs),
      cap: formatHours(capMs),
    });
    return html`<span
      data-limit-meter
      title=${label}
      aria-label=${label}
      class="flex items-center gap-2 text-white/50"
    >
      <cap-icon .size=${14}></cap-icon>
      <span class="w-20 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <span
          data-limit-fill
          class="block h-full rounded-full bg-aquarius"
          style="width: ${pct}%"
        ></span>
      </span>
      ${translateText("clan_modal.boost_limit_short", {
        used: Math.round((usedMs / HOUR_MS) * 10) / 10,
        cap: Math.round((capMs / HOUR_MS) * 10) / 10,
      })}
    </span>`;
  }

  private renderBody() {
    if (this.loadFailed) {
      return html`<p class="text-red-400 text-sm" role="alert">
        ${translateText("clan_modal.boost_error_failed")}
      </p>`;
    }
    const status = this.status;
    if (!status) {
      return html`<p class="text-white/40 text-sm">…</p>`;
    }
    const tier = this.tier();
    const running = formatBoostRemaining(status.boostEndsAt);
    const error = this.serverError ?? this.blocker();
    return html`
      <div
        role="radiogroup"
        aria-label=${translateText("clan_modal.boost_tier_label")}
        @keydown=${(e: KeyboardEvent) => this.onTierKeydown(e)}
        class="flex gap-2 mb-4"
      >
        ${status.tiers.map((t) => this.renderTier(t))}
      </div>

      <div class="flex items-center justify-between gap-3 text-xs">
        ${
          tier
            ? html`<span
                data-clan-balance
                title=${this.balanceLabel(tier.currency)}
                aria-label=${this.balanceLabel(tier.currency)}
                class="flex items-center gap-1.5 font-bold text-white/80"
              >
                ${this.currencyIcon(tier.currency)}
                ${formatCurrencyAmount(
                  this.clanBalance(tier.currency).toString(),
                )}
              </span>`
            : html`<span></span>`
        }
        ${this.renderLimitMeter(status)}
      </div>

      ${
        running
          ? html`<p
              data-boost-running
              class="mt-3 inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-malibu-blue/15 text-aquarius border border-malibu-blue/40"
            >
              ${translateText("clan_modal.boost_time_left", {
                remaining: running,
              })}
            </p>`
          : ""
      }
      ${
        error
          ? html`<p class="text-red-400 text-xs mt-3" role="alert">${error}</p>`
          : ""
      }

      <p class="mt-3 text-[11px] text-white/40">
        ${translateText("clan_modal.boost_final")}
      </p>
    `;
  }

  private renderOverlay() {
    return html`
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="clan-boost-dialog-title"
        tabindex="-1"
        class="fixed inset-0 z-[10020] flex items-center justify-center bg-black/80 focus:outline-none"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.cancel();
        }}
      >
        <!-- A section, not a div: the Halloween theme restyles
             [role="dialog"] > div (translucent purple, orange border), and
             this panel keeps its own look like the donate dialog. -->
        <section
          data-boost-panel
          class="relative mx-4 w-full max-w-md p-6 rounded-2xl border border-malibu-blue/50 bg-surface shadow-2xl"
        >
          <h2
            id="clan-boost-dialog-title"
            class="text-lg font-bold text-white mb-1"
          >
            ${translateText("clan_modal.boost_title", { tag: this.clanTag })}
          </h2>
          <p class="text-white/50 text-xs mb-4">
            ${translateText("clan_modal.boost_subtitle")}
          </p>

          ${this.renderBody()}

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
              data-action="buy-boost"
              @click=${() => void this.submit()}
              ?disabled=${!this.canSubmit()}
              class="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl text-white transition-all disabled:opacity-50 disabled:pointer-events-none border-0 bg-malibu-blue hover:bg-aquarius"
            >
              ${translateText(
                this.submitting
                  ? "clan_modal.boost_submitting"
                  : "clan_modal.boost_confirm",
              )}
            </button>
          </div>
        </section>
      </div>
    `;
  }
}
