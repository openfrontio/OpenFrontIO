import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { within } from "../../../core/Util";
import {
  SendDonateGoldIntentEvent,
  SendDonateTroopsIntentEvent,
} from "../../Transport";
import { renderTroops, translateText } from "../../Utils";
import { UIState } from "../UIState";

@customElement("send-resource-modal")
export class SendResourceModal extends LitElement {
  @property({ attribute: false }) eventBus: EventBus | null = null;

  @property({ type: Boolean }) open: boolean = false;
  @property({ type: String }) mode: "troops" | "gold" = "troops";

  @property({ type: Object }) total: number | bigint = 0;
  @property({ type: Object }) uiState: UIState | null = null; // to seed initial %
  @property({ attribute: false }) format: (n: number) => string = renderTroops;

  @property({ attribute: false }) myPlayer: PlayerView | null = null;
  @property({ attribute: false }) target: PlayerView | null = null;
  @property({ attribute: false }) gameView: GameView | null = null;

  @property({ type: String }) heading: string | null = null;

  @state() private sendAmount: number = 0;
  @state() private selectedPercent: number | null = null;

  private PRESETS = [10, 25, 50, 75, 100] as const;

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
      // If either side is dead, just close and do nothing
      if (!this.isSenderAlive() || !this.isTargetAlive()) {
        this.closeModal();
        return;
      }
      queueMicrotask(() =>
        (this.querySelector('[role="dialog"]') as HTMLElement | null)?.focus(),
      );
    }

    if (
      changed.has("total") ||
      changed.has("mode") ||
      changed.has("target") ||
      changed.has("gameView")
    ) {
      const basis = this.getPercentBasis();
      if (this.selectedPercent !== null) {
        const pct = this.sanitizePercent(this.selectedPercent);
        const raw = Math.floor((basis * pct) / 100);
        this.sendAmount = this.clampSend(raw);
      } else {
        this.sendAmount = this.clampSend(this.sendAmount);
      }
    }
  }

  private closeModal() {
    this.dispatchEvent(new CustomEvent("close"));
  }

  private confirm() {
    if (!this.isSenderAlive() || !this.isTargetAlive() || !this.eventBus) {
      return;
    }

    const myPlayer = this.myPlayer;
    const target = this.target;
    const amount = this.limitAmount(this.sendAmount);

    if (!myPlayer || !target || amount <= 0) return;

    if (this.mode === "troops") {
      const myTroops = Number(myPlayer.troops());
      if (amount > myTroops) return;
      this.eventBus.emit(new SendDonateTroopsIntentEvent(target, amount));
    } else {
      const myGold = Number(myPlayer.gold());
      if (amount > myGold) return;
      this.eventBus.emit(new SendDonateGoldIntentEvent(target, BigInt(amount)));
    }

    this.dispatchEvent(
      new CustomEvent("confirm", {
        detail: { amount, closePanel: true, success: true },
      }),
    );

    this.closeModal();
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

  private toNum(x: unknown): number {
    if (typeof x === "bigint") return Number(x);
    return Number(x ?? 0);
  }

  private getTotalNumber(): number {
    const base = this.toNum(this.total);
    return this.isSenderAlive() ? base : 0;
  }

  private sanitizePercent(p: number) {
    return within(p, 0, 100);
  }

  /** Internal capacity only for troops; gold is unlimited. */
  private getCapacityLeft(): number | null {
    if (!this.isTargetAlive()) return 0;
    if (this.mode !== "troops") return null;
    if (!this.gameView || !this.target) return null;
    const current = this.toNum(this.target.troops());
    const max = this.toNum(this.gameView.config().maxTroops(this.target));
    return Math.max(0, max - current);
  }

  private getPercentBasis(): number {
    return this.getTotalNumber();
  }

  private limitAmount(proposed: number): number {
    const cap = this.getCapacityLeft();
    const total = this.getTotalNumber();
    const hardMax = cap === null ? total : Math.min(total, cap);
    return within(proposed, 0, hardMax);
  }

  private clampSend(n: number) {
    const total = this.getTotalNumber();
    const byTotal = within(n, 0, total);
    return this.limitAmount(byTotal);
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
    return this.mode === "troops" ? 0.3 : 0;
  }

  private isTargetAlive(): boolean {
    return this.target?.isAlive() ?? false;
  }

  private isSenderAlive(): boolean {
    return this.myPlayer?.isAlive() ?? false;
  }

  private i18n = {
    title: (name: string) =>
      this.mode === "troops"
        ? translateText("send_troops_modal.title_with_name", { name })
        : translateText("send_gold_modal.title_with_name", { name }),

    availableChip: () => translateText("common.available"),

    availableTooltip: () =>
      this.mode === "troops"
        ? translateText("send_troops_modal.available_tooltip")
        : translateText("send_gold_modal.available_tooltip"),

    max: () => translateText("common.preset_max"),

    ariaSlider: () =>
      this.mode === "troops"
        ? translateText("send_troops_modal.aria_slider")
        : translateText("send_gold_modal.aria_slider"),

    summarySend: () => translateText("common.summary_send"),
    summaryKeep: () => translateText("common.summary_keep"),

    closeLabel: () => translateText("common.close"),
    cancel: () => translateText("common.cancel"),
    send: () => translateText("common.send"),

    cap: () => translateText("common.cap_label"),
    capTooltip: () => translateText("common.cap_tooltip"),

    sliderTooltip: (percent: number, amountStr: string) =>
      this.mode === "troops"
        ? translateText("send_troops_modal.slider_tooltip", {
            percent,
            amount: amountStr,
          })
        : translateText("send_gold_modal.slider_tooltip", {
            percent,
            amount: amountStr,
          }),

    capacityNote: (amountStr: string) =>
      translateText("send_troops_modal.capacity_note", { amount: amountStr }),

    targetDeadTitle: () => translateText("common.target_dead"),
    targetDeadNote: () => translateText("common.target_dead_note"),
  };

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
    const cap = this.getCapacityLeft();

    return html`
      <div class="mb-4 pb-3 border-b border-zinc-800">
        <div class="flex items-center gap-2 text-[13px]">
          <!-- Available -->
          <span
            class="inline-flex items-center gap-1 rounded-full bg-indigo-600/15 px-2 py-0.5 ring-1 ring-indigo-400/40 text-indigo-100"
            title=${this.i18n.availableTooltip()}
          >
            <span class="opacity-90">${this.i18n.availableChip()}</span>
            <span class="font-mono tabular-nums">${this.format(total)}</span>
          </span>

          ${cap !== null
            ? html`
                <!-- Cap -->
                <span
                  class="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 ring-1 ring-amber-400/40 text-amber-200"
                  title=${this.i18n.capTooltip()}
                >
                  <span class="opacity-90">${this.i18n.cap()}</span>
                  <span class="font-mono tabular-nums"
                    >${this.format(cap)}</span
                  >
                </span>
              `
            : html``}
        </div>
      </div>
    `;
  }

  private renderPresets(percentNow: number) {
    const basis = this.getTotalNumber();
    const dead = !this.isSenderAlive() || !this.isTargetAlive();

    return html`
      <div class="mb-8 grid grid-cols-5 gap-2">
        ${this.PRESETS.map((p) => {
          const pct = this.sanitizePercent(p);
          const active = (this.selectedPercent ?? percentNow) === pct;
          const label = pct === 100 ? this.i18n.max() : `${pct}%`;
          return html`
            <button
              ?disabled=${dead}
              class="rounded-lg px-3 py-2 text-sm ring-1 transition
                ${dead
                ? "bg-zinc-800/70 text-zinc-400 ring-zinc-700 cursor-not-allowed"
                : active
                  ? "bg-indigo-600 text-white ring-indigo-300/60"
                  : "bg-zinc-800 text-zinc-200 ring-zinc-700 hover:bg-zinc-700 hover:text-zinc-50"}"
              @click=${() => {
                if (dead) return;
                this.selectedPercent = pct;
                const raw = Math.floor((basis * pct) / 100);
                this.sendAmount = this.clampSend(raw);
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
    const basis = this.getTotalNumber();
    const cap = this.getCapacityLeft();
    const hardMax = cap === null ? basis : Math.min(basis, cap);
    const dead = !this.isSenderAlive() || !this.isTargetAlive();

    // Where to draw the cap marker (as % of Available)
    const capPercent =
      cap === null
        ? null
        : Math.max(
            0,
            Math.min(
              100,
              Math.round((Math.min(cap, basis) / (basis || 1)) * 100),
            ),
          );

    const fill = this.getFillColor();
    const disabled = basis <= 0 || dead;
    const sliderOuterMb = capPercent !== null ? "mb-8" : "mb-2";

    return html`
      <div class="${sliderOuterMb}">
        <div
          class="relative px-1 rounded-lg overflow-visible focus-within:ring-2 focus-within:ring-indigo-500/30"
        >
          <input
            type="range"
            min="0"
            .max=${basis}
            .value=${this.sendAmount}
            ?disabled=${disabled}
            @input=${(e: Event) => {
              if (dead) return;
              const raw = Number((e.target as HTMLInputElement).value);
              const pctRaw = basis ? Math.round((raw / basis) * 100) : 0;
              this.selectedPercent = this.sanitizePercent(pctRaw);
              const clamped = Math.min(raw, hardMax);
              this.sendAmount = this.clampSend(clamped);
            }}
            class="w-full appearance-none bg-transparent range-x focus:outline-none"
            aria-label=${this.i18n.ariaSlider()}
            aria-valuemin="0"
            aria-valuemax=${hardMax}
            aria-valuetext=${this.i18n.sliderTooltip(
              percentNow,
              this.format(this.sendAmount),
            )}
            style="--percent:${percentNow}%; --fill:${fill}; --track: rgba(255,255,255,.28); --thumb-ring: rgb(24 24 27);"
          />

          <!-- Tooltip -->
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

          <!-- Cap marker -->
          ${capPercent !== null
            ? html`
                <div
                  class="pointer-events-none absolute top-1/2 -translate-y-1/2 h-3 w-[2px] bg-amber-400/80 shadow"
                  style="left:${capPercent}%;"
                  title=${this.i18n.capTooltip()}
                ></div>
                <div
                  class="pointer-events-none absolute top-full mt-1.5 -translate-x-1/2 select-none"
                  style="left:${capPercent}%"
                >
                  <div
                    class="rounded bg-[#0f1116] ring-1 ring-amber-400/40 text-amber-200 px-1 py-0.5 text-[11px] shadow whitespace-nowrap"
                  >
                    ${this.i18n.cap()}
                  </div>
                </div>
              `
            : html``}
        </div>
      </div>
    `;
  }

  private renderCapacityNote(allowed: number) {
    const capped = allowed !== this.sendAmount;
    if (!capped) return html``;
    return html`<p class="mt-1 text-xs text-amber-300">
      ${this.i18n.capacityNote(this.format(allowed))}
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
    const dead = !this.isSenderAlive() || !this.isTargetAlive();
    const disabled = total <= 0 || this.clampSend(this.sendAmount) <= 0 || dead;
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

  private renderDeadNote() {
    return html`
      <div
        class="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-200 text-sm"
      >
        <div class="font-semibold">${this.i18n.targetDeadTitle()}</div>
        <div>${this.i18n.targetDeadNote()}</div>
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
            /* allowed (clamped) fill */ rgba(255, 255, 255, 0.22)
              var(--percent),
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
            ${!this.isTargetAlive() ? this.renderDeadNote() : html``}
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
