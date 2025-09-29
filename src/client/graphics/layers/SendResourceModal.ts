import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { renderTroops, translateText } from "../../Utils";
import { UIState } from "../UIState";

/**
 * <send-resource-modal>
 * - mode: "troops" (capacity-limited) | "gold" (unlimited)
 * - Computes troops capacity internally (from gameView + target).
 * - Emits "confirm": { amount, closePanel: true } and "close".
 */
@customElement("send-resource-modal")
class SendResourceModal extends LitElement {
  // ── Public API
  @property({ type: Boolean }) open: boolean = false;
  @property({ type: String }) mode: "troops" | "gold" = "troops";

  @property({ type: Number }) total: number = 0; // sender available
  @property({ type: Object }) uiState: UIState | null = null; // to seed initial %
  @property({ attribute: false }) format: (n: number) => string = renderTroops;

  // Game context (troops only)
  @property({ type: Object }) myPlayer: PlayerView | null = null;
  @property({ type: Object }) target: PlayerView | null = null;
  @property({ type: Object }) gameView: GameView | null = null;

  // Optional custom heading (otherwise troops i18n / generic “Send”)
  @property({ type: String }) heading: string | null = null;

  @state() private sendAmount: number = 0;
  @state() private selectedPercent: number | null = null;

  private PRESETS = [10, 25, 50, 75, 100] as const;

  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────
  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    const initPct =
      this.uiState && typeof this.uiState.attackRatio === "number"
        ? Math.round(this.uiState.attackRatio * 100)
        : 100;
    this.selectedPercent = this.sanitizePercent(initPct);

    const basis = this.getPercentBasis();
    this.sendAmount = this.clampSend(
      Math.floor((basis * this.selectedPercent) / 100),
    );
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("open") && this.open) {
      queueMicrotask(() =>
        (this.querySelector('[role="dialog"]') as HTMLElement | null)?.focus(),
      );
    }

    // Keep amount sane when inputs change
    if (
      changed.has("total") ||
      changed.has("mode") ||
      changed.has("target") ||
      changed.has("gameView")
    ) {
      const basis = this.getPercentBasis();
      if (this.selectedPercent !== null) {
        const pct = this.sanitizePercent(this.selectedPercent);
        this.sendAmount = this.clampSend(Math.floor((basis * pct) / 100));
      } else {
        this.sendAmount = this.clampSend(this.sendAmount);
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Events
  // ────────────────────────────────────────────────────────────────────────────
  private closeModal() {
    this.dispatchEvent(new CustomEvent("close"));
  }

  private confirm() {
    const amount = this.limitAmount(this.sendAmount);
    this.dispatchEvent(
      new CustomEvent("confirm", { detail: { amount, closePanel: true } }),
    );
  }

  private handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      this.closeModal();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      this.confirm();
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // i18n
  // ─────────────────────────────────────────────────────────────────────────────
  private i18n = {
    title: (name: string) =>
      this.mode === "troops"
        ? translateText("send_troops_modal.title", { name })
        : name
          ? `Send Gold to ${name}`
          : "Send Gold",
    available: () =>
      this.mode === "troops"
        ? translateText("send_troops_modal.available")
        : "Available:",
    max: () =>
      this.mode === "troops"
        ? translateText("send_troops_modal.preset_max")
        : "Max",
    ariaSlider: () =>
      this.mode === "troops"
        ? translateText("send_troops_modal.aria_slider")
        : "Amount slider",
    summarySend: () =>
      this.mode === "troops"
        ? translateText("send_troops_modal.summary_send")
        : "Send",
    summaryKeep: () =>
      this.mode === "troops"
        ? translateText("send_troops_modal.summary_keep")
        : "Keep",
    closeLabel: () => translateText("common.close") ?? "Close",
    cancel: () => translateText("send_troops_modal.cancel") ?? "Cancel",
    send: () => translateText("send_troops_modal.send") ?? "Send",
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Computation
  // ────────────────────────────────────────────────────────────────────────────
  private toNum(x: unknown): number {
    if (typeof x === "bigint") return Number(x);
    return Number(x ?? 0);
  }

  private getTotalNumber(): number {
    return this.toNum(this.total);
  }

  private sanitizePercent(p: number) {
    return Math.max(0, Math.min(100, Math.round(p)));
  }

  /** Internal capacity only for troops; gold is unlimited. */
  private getCapacityLeft(): number | null {
    if (this.mode !== "troops") return null;
    if (!this.gameView || !this.target) return null;
    const current = this.toNum(this.target.troops());
    const max = this.toNum(this.gameView.config().maxTroops(this.target));
    return Math.max(0, max - current);
  }

  private getPercentBasis(): number {
    // Basis is the *true* max we let the user choose via presets/slider.
    if (this.mode === "troops") {
      const cap = this.getCapacityLeft(); // receiver headroom
      const total = this.getTotalNumber(); // sender available
      if (cap !== null) return Math.min(total, cap);
    }
    return this.getTotalNumber(); // gold or missing context → sender available
  }

  private limitAmount(proposed: number): number {
    const cap = this.getCapacityLeft();
    if (cap === null) return proposed; // gold -> unlimited
    return Math.min(proposed, cap);
  }

  private clampSend(n: number) {
    const total = this.getTotalNumber();
    const byTotal = Math.max(0, Math.min(n, total));
    const byCap = this.limitAmount(byTotal);
    return Math.max(0, Math.min(byCap, total));
  }

  private percentOfBasis(n: number): number {
    const basis = this.getPercentBasis();
    return basis ? Math.round((n / basis) * 100) : 0;
  }

  private keepAfter(allowed: number): number {
    const total = this.getTotalNumber();
    return Math.max(0, total - allowed);
  }

  private getFillColor(): string {
    return this.mode === "troops"
      ? "rgb(168 85 247)" /* purple */
      : "rgb(234 179 8)" /* amber */;
  }

  private getMinKeepRatio(): number {
    return this.mode === "troops" ? 0.3 : 0; // gold has no keep rule
  }
  // ─────────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────────
  private renderHeader() {
    const name = this.target?.name?.() ?? "";
    return html`
      <div class="mb-3 flex items-center justify-between">
        <h2
          id="send-title"
          class="text-lg font-semibold tracking-tight text-zinc-100"
        >
          ${this.heading ?? this.i18n.title(name)}
        </h2>
        <button
          class="rounded-md px-2 text-2xl leading-none text-zinc-300 hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-white/30"
          @click=${() => this.closeModal()}
          aria-label=${this.i18n.closeLabel()}
        >
          ×
        </button>
      </div>
    `;
  }

  private renderAvailable() {
    const total = this.getTotalNumber();

    if (this.mode === "troops") {
      const cap = this.getCapacityLeft();
      if (cap === null) {
        return html`
          <div class="mb-4 pb-3 border-b border-zinc-800">
            <div class="flex items-center gap-2 text-[13px]">
              <span
                class="inline-flex items-center gap-1 rounded-full bg-indigo-600/15 px-2 py-0.5 ring-1 ring-indigo-400/40 text-indigo-100"
                title="Your current available troops"
              >
                <span class="opacity-90">Available</span>
                <span class="font-mono tabular-nums"
                  >${this.format(total)}</span
                >
              </span>
            </div>
          </div>
        `;
      }

      const showAvailableOnly = total <= cap; // if equal, prefer Available
      return html`
        <div class="mb-4 pb-3 border-b border-zinc-800">
          <div class="flex items-center gap-2 text-[13px]">
            ${showAvailableOnly
              ? html`
                  <!-- Sender's available troops -->
                  <span
                    class="inline-flex items-center gap-1 rounded-full bg-indigo-600/15 px-2 py-0.5 ring-1 ring-indigo-400/40 text-indigo-100"
                    title="How much the recipient can still accept"
                  >
                    <span class="opacity-90">Available</span>
                    <span class="font-mono tabular-nums"
                      >${this.format(total)}</span
                    >
                  </span>
                `
              : html`
                  <!-- Recipient's capacity left -->
                  <span
                    class="inline-flex items-center gap-1 rounded-full bg-indigo-600/15 px-2 py-0.5 ring-1 ring-indigo-400/40 text-indigo-100"
                    title="How much the recipient can still accept"
                  >
                    <span class="opacity-90">Player Cap</span>
                    <span class="font-mono tabular-nums"
                      >${this.format(cap)}</span
                    >
                  </span>
                `}
          </div>
        </div>
      `;
    }
    // Gold / generic
    return html`
      <div class="mb-4 pb-3 border-b border-zinc-800">
        <div class="flex items-center gap-2 text-[13px]">
          <span
            class="inline-flex items-center gap-1 rounded-full bg-indigo-600/15 px-2 py-0.5 ring-1 ring-indigo-400/40 text-indigo-100"
            title="Your current available troops"
          >
            <span class="opacity-90"> ${this.i18n.available()}</span>
            <span class="font-mono tabular-nums">${this.format(total)}</span>
          </span>
        </div>
      </div>
    `;
  }

  private renderPresets(percentNow: number) {
    const basis = this.getPercentBasis();
    return html`
      <div class="mb-8 grid grid-cols-5 gap-2">
        ${this.PRESETS.map((p) => {
          const pct = this.sanitizePercent(p);
          const active = (this.selectedPercent ?? percentNow) === pct;
          const label = pct === 100 ? this.i18n.max() : `${pct}%`;
          return html`
            <button
              class="rounded-lg px-3 py-2 text-sm ring-1 transition
                     ${active
                ? "bg-indigo-600 text-white ring-indigo-300/60"
                : "bg-zinc-800 text-zinc-200 ring-zinc-700 hover:bg-zinc-700 hover:text-zinc-50"}"
              @click=${() => {
                this.selectedPercent = pct;
                this.sendAmount = this.clampSend(
                  Math.floor((basis * pct) / 100),
                );
              }}
              ?aria-pressed=${active}
              title="${pct}%"
            >
              ${label}
            </button>
          `;
        })}
      </div>
    `;
  }

  private renderSlider(percentNow: number) {
    const fill = this.getFillColor();
    const basis = this.getPercentBasis();
    return html`
      <div class="mb-2">
        <div
          class="relative px-1 rounded-lg overflow-visible focus-within:ring-2 focus-within:ring-indigo-500/30"
        >
          <input
            type="range"
            min="0"
            .max=${String(basis)}
            .value=${String(this.sendAmount)}
            @input=${(e: Event) => {
              const raw = Number((e.target as HTMLInputElement).value);
              this.selectedPercent = basis
                ? Math.round((raw / basis) * 100)
                : 0;
              this.sendAmount = this.clampSend(raw);
            }}
            class="w-full appearance-none bg-transparent range-x focus:outline-none"
            aria-label=${this.i18n.ariaSlider()}
            aria-valuemin="0"
            aria-valuemax=${basis}
            aria-valuenow=${this.sendAmount}
            style="--percent:${percentNow}%; --fill:${fill}; --track: rgba(255,255,255,.28); --thumb-ring: rgb(24 24 27);"
          />
          <div
            class="pointer-events-none absolute -top-6 -translate-x-1/2 select-none"
            style="left:${percentNow}%"
          >
            <div
              class="rounded bg-[#0f1116] ring-1 ring-zinc-700 text-zinc-100 px-1.5 py-0.5 text-[12px] shadow whitespace-nowrap w-max z-50"
            >
              ${percentNow}% • ${this.format(this.sendAmount)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderCapacityNote(allowed: number) {
    const capped = allowed !== this.sendAmount;
    if (!capped) return html``;
    return html`<p class="mt-1 text-xs text-amber-300">
      Receiver can accept only ${this.format(allowed)} right now.
    </p>`;
  }

  private renderSummary(allowed: number) {
    const total = this.getTotalNumber();
    const keep = this.keepAfter(allowed);
    const belowMinKeep =
      this.getMinKeepRatio() > 0 &&
      keep < Math.floor(total * this.getMinKeepRatio());

    return html`
      <div class="mt-3 text-center text-sm text-zinc-200">
        ${this.i18n.summarySend()}
        <span class="font-semibold text-indigo-400 font-mono"
          >${this.format(allowed)}</span
        >
        · ${this.i18n.summaryKeep()}
        <span
          class="font-semibold font-mono ${belowMinKeep
            ? "text-amber-400"
            : "text-emerald-400"}"
        >
          ${this.format(keep)}
        </span>
      </div>
    `;
  }

  private renderActions() {
    const total = this.getTotalNumber();
    const disabled = total <= 0 || this.clampSend(this.sendAmount) <= 0;
    return html`
      <div class="mt-5 flex justify-end gap-2">
        <button
          class="h-10 min-w-24 rounded-lg px-3 text-sm font-semibold
                 text-zinc-100 bg-zinc-800 ring-1 ring-zinc-700
                 hover:bg-zinc-700 focus:outline-none
                 focus-visible:ring-2 focus-visible:ring-white/20"
          @click=${() => this.closeModal()}
        >
          ${this.i18n.cancel()}
        </button>
        <button
          class="h-10 min-w-24 rounded-lg px-3 text-sm font-semibold text-white
                 bg-indigo-600 enabled:hover:bg-indigo-500
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50
                 disabled:cursor-not-allowed disabled:opacity-50"
          ?disabled=${disabled}
          @click=${() => this.confirm()}
        >
          ${this.i18n.send()}
        </button>
      </div>
    `;
  }

  private renderSliderStyles() {
    return html`
      <style>
        .range-x {
          -webkit-appearance: none;
          appearance: none;
          height: 8px;
          outline: none;
          background: transparent;
        }
        .range-x::-webkit-slider-runnable-track {
          height: 8px;
          border-radius: 9999px;
          background: linear-gradient(
            90deg,
            var(--fill) 0,
            var(--fill) var(--percent),
            rgba(255, 255, 255, 0.22) var(--percent),
            rgba(255, 255, 255, 0.22) 100%
          );
        }
        .range-x::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 18px;
          width: 18px;
          border-radius: 9999px;
          background: var(--fill);
          border: 3px solid var(--thumb-ring);
          margin-top: -5px;
        }
        .range-x::-moz-range-track {
          height: 8px;
          border-radius: 9999px;
          background: rgba(255, 255, 255, 0.22);
        }
        .range-x::-moz-range-progress {
          height: 8px;
          border-radius: 9999px;
          background: var(--fill);
        }
        .range-x::-moz-range-thumb {
          height: 18px;
          width: 18px;
          border-radius: 9999px;
          background: var(--fill);
          border: 3px solid var(--thumb-ring);
        }
      </style>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────
  render() {
    if (!this.open) return html``;

    const percent = this.percentOfBasis(this.sendAmount);
    const allowed = this.limitAmount(this.sendAmount);

    return html`
      <div class="fixed inset-0 z-[1100] flex items-center justify-center p-4">
        <div
          class="absolute inset-0 bg-black/60 backdrop-blur-sm rounded-2xl"
          @click=${() => this.closeModal()}
        ></div>

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="send-title"
          class="relative z-10 w-full max-w-[540px] focus:outline-none"
          tabindex="0"
          @keydown=${this.handleKeydown}
        >
          <div
            class="rounded-2xl bg-zinc-900 p-5 shadow-2xl ring-1 ring-zinc-800 max-h-[90vh] text-zinc-200"
            @click=${(e: MouseEvent) => e.stopPropagation()}
          >
            ${this.renderHeader()} ${this.renderAvailable()}
            ${this.renderPresets(percent)} ${this.renderSlider(percent)}
            ${this.mode === "troops"
              ? this.renderCapacityNote(allowed)
              : html``}
            ${this.renderSummary(allowed)} ${this.renderActions()}
            ${this.renderSliderStyles()}
          </div>
        </div>
      </div>
    `;
  }
}
