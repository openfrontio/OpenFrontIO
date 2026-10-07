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
 * network cannot buy twice.
 */
@customElement("clan-boost-dialog")
export class ClanBoostDialog extends LitElement {
  @property() clanTag = "";

  @state() private status: ClanBoostStatus | null = null;
  @state() private loadFailed = false;
  @state() private selectedTier: string | null = null;
  @state() private submitting = false;
  @state() private serverError: string | null = null;

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
    if (this.submitting || tier === this.selectedTier) return;
    this.selectedTier = tier;
    this.serverError = null;
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
        data-tier=${tier.tier}
        ?disabled=${this.submitting}
        @click=${() => this.selectTier(tier.tier)}
        class="flex-1 flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl border transition-all ${selected
          ? "bg-fuchsia-500/15 border-fuchsia-400/70 ring-2 ring-fuchsia-400/40 text-white"
          : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white"} disabled:opacity-50 disabled:pointer-events-none"
      >
        <span class="text-xs font-bold uppercase tracking-wider">
          ${translateText(`clan_modal.boost_tier_${tier.tier}`)}
        </span>
        <span class="text-[11px]">${formatDuration(tier.durationMs)}</span>
        <span class="flex items-center gap-1 text-sm font-bold">
          ${tier.currency === "hard"
            ? html`<plutonium-icon .size=${14}></plutonium-icon>`
            : html`<cap-icon .size=${16}></cap-icon>`}
          ${formatCurrencyAmount(tier.price)}
        </span>
      </button>
    `;
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
      <div role="radiogroup" class="flex gap-2 mb-4">
        ${status.tiers.map((t) => this.renderTier(t))}
      </div>

      <div class="space-y-1 text-xs text-white/50">
        ${tier
          ? html`<p data-clan-balance>
              ${translateText("clan_modal.boost_clan_balance", {
                balance: `${formatCurrencyAmount(
                  this.clanBalance(tier.currency).toString(),
                )} ${this.currencyLabel(tier.currency)}`,
              })}
            </p>`
          : ""}
        <p>
          ${translateText("clan_modal.boost_limit_used", {
            used: formatHours(status.softLimit.usedMs),
            cap: formatHours(status.softLimit.capMs),
          })}
        </p>
        ${running
          ? html`<p class="text-fuchsia-300">
              ${translateText("clan_modal.boost_running", {
                remaining: running,
              })}
            </p>`
          : ""}
      </div>

      ${error
        ? html`<p class="text-red-400 text-xs mt-3" role="alert">${error}</p>`
        : ""}

      <div
        class="mt-4 rounded-xl border p-3 text-xs border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200"
      >
        <p class="font-bold">${translateText("clan_modal.boost_final")}</p>
        ${tier?.currency === "hard"
          ? html`<p class="mt-1">
              ${translateText("clan_modal.boost_final_hard")}
            </p>`
          : ""}
      </div>
    `;
  }

  private renderOverlay() {
    return html`
      <div
        class="fixed inset-0 z-[10020] flex items-center justify-center bg-black/80"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.cancel();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="clan-boost-dialog-title"
          tabindex="-1"
          class="relative mx-4 w-full max-w-md p-6 rounded-2xl border border-fuchsia-500/50 bg-surface shadow-2xl focus:outline-none"
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
              class="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl text-white transition-all disabled:opacity-50 disabled:pointer-events-none border-0 bg-fuchsia-600 hover:bg-fuchsia-700"
            >
              ${translateText(
                this.submitting
                  ? "clan_modal.boost_submitting"
                  : "clan_modal.boost_confirm",
              )}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
