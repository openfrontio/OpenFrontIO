import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { PlayerView } from "../../../core/game/GameView";
import { renderTroops, translateText } from "../../Utils";
import { UIState } from "../UIState";

@customElement("send-troops-modal")
class SendTroopsModal extends LitElement {
  @property({ type: Object }) myPlayer: PlayerView | null = null;
  @property({ type: Object }) troopsTarget: PlayerView | null = null;
  @property({ type: Boolean }) open: boolean = false;
  @property({ type: Number }) total: number = 0;
  @property({ type: Object }) uiState: UIState | null = null;

  @state()
  private sendTroopsAmount: number = 0;
  @state()
  private selectedPercent: number | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    if (
      this.myPlayer &&
      this.uiState &&
      typeof this.uiState.attackRatio === "number"
    ) {
      this.selectedPercent = Math.round(this.uiState.attackRatio * 100);
    } else {
      this.selectedPercent = 100; // fallback to Max
    }
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("open") && this.open) {
      // focus dialog after render
      queueMicrotask(() => {
        const dlg = this.querySelector('[role="dialog"]') as HTMLElement | null;
        dlg?.focus();
      });
    }

    if (changed.has("total") || changed.has("selectedPercent")) {
      const maxAllowed = this.total;
      if (this.selectedPercent !== null) {
        // Keep sendTroopsAmount in sync with selected percent
        this.sendTroopsAmount = Math.floor(
          (maxAllowed * this.selectedPercent) / 100,
        );
      } else {
        if (this.sendTroopsAmount > maxAllowed)
          this.sendTroopsAmount = maxAllowed;
        if (this.sendTroopsAmount < 0) this.sendTroopsAmount = 0;
      }
    }
  }

  private closeTroopsModal() {
    this.dispatchEvent(new CustomEvent("close"));
  }

  private confirmSendTroops() {
    this.dispatchEvent(
      new CustomEvent("confirm", {
        detail: {
          amount: this.sendTroopsAmount,
          closePanel: true,
        },
      }),
    );
  }

  private handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      this.closeTroopsModal();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      this.confirmSendTroops();
    }
  };

  render() {
    if (!this.myPlayer || !this.troopsTarget || !this.open) return html``;

    const minKeepAbs = Math.floor(this.total * 0.3);
    const maxAmount = this.total;

    if (this.sendTroopsAmount > maxAmount) this.sendTroopsAmount = maxAmount;

    const setByPercent = (p: number | "Max") => {
      const val = p === "Max" ? 100 : p;
      this.selectedPercent = val;
      const next =
        p === "Max" ? maxAmount : Math.floor((this.total * val) / 100);
      this.sendTroopsAmount = Math.min(next, maxAmount);
    };

    const percent = this.total
      ? Math.round((this.sendTroopsAmount / this.total) * 100)
      : 0;
    const keepAfter = Math.max(0, this.total - this.sendTroopsAmount);
    const belowMinKeep = keepAfter < minKeepAbs;

    return html`
      <div class="fixed inset-0 z-[1100] flex items-center justify-center p-4">
        <div
          class="absolute inset-0 bg-black/60 backdrop-blur-sm rounded-2xl"
          @click=${() => this.closeTroopsModal()}
        ></div>

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="send-troops-title"
          class="relative z-10 w-full max-w-[540px] focus:outline-none"
          tabindex="0"
          @keydown=${this.handleKeydown}
        >
          <div
            class="rounded-2xl bg-zinc-900 p-5 shadow-2xl ring-1 ring-zinc-800 max-h-[90vh] text-zinc-200"
          >
            <!-- Header -->
            <div class="mb-3 flex items-center justify-between">
              <h2
                id="send-troops-title"
                class="text-lg font-semibold tracking-tight text-zinc-100"
              >
                ${translateText("send_troops_modal.title", {
                  name: this.troopsTarget?.name() ?? "",
                })}
              </h2>
              <button
                class="rounded-md px-2 text-2xl leading-none text-zinc-300 hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-white/30"
                @click=${() => this.closeTroopsModal()}
                aria-label=${translateText("common.close")}
              >
                ×
              </button>
            </div>

            <div
              class="mb-4 pb-3 text-sm text-zinc-300 border-b border-zinc-800"
            >
              ${translateText("send_troops_modal.available")}
              <span class="font-medium font-mono text-zinc-100"
                >${renderTroops(this.total)}</span
              >
              · ${translateText("send_troops_modal.min_keep")}
              <span class="font-medium font-mono text-zinc-100"
                >${renderTroops(minKeepAbs)}</span
              >
              ${translateText("send_troops_modal.min_keep_pct")}
            </div>

            <!-- Preset chips -->
            <div class="mb-8 grid grid-cols-5 gap-2">
              ${([10, 25, 50, 75, "Max"] as const).map((p: number | "Max") => {
                const val = p === "Max" ? 100 : p;
                return html` <button
                  class="rounded-lg px-3 py-2 text-sm ring-1 transition
                  ${(this.selectedPercent ?? percent) === val
                    ? "bg-indigo-600 text-white ring-indigo-300/60"
                    : "bg-zinc-800 text-zinc-200 ring-zinc-700 hover:bg-zinc-700 hover:text-zinc-50"}"
                  @click=${() => setByPercent(p)}
                  ?aria-pressed=${(this.selectedPercent ?? percent) === val}
                  title="${val}%"
                >
                  ${p === "Max"
                    ? translateText("send_troops_modal.preset_max")
                    : `${p}%`}
                </button>`;
              })}
            </div>

            <!-- Slider -->
            <div class="mb-2">
              <div
                class="relative px-1 rounded-lg overflow-visible focus-within:ring-2 focus-within:ring-indigo-500/30"
              >
                <input
                  type="range"
                  min="0"
                  max=${maxAmount}
                  .value=${String(this.sendTroopsAmount)}
                  @input=${(e: Event) => {
                    const val = Number((e.target as HTMLInputElement).value);
                    this.selectedPercent =
                      this.total > 0 ? Math.round((val / this.total) * 100) : 0;
                  }}
                  class="w-full appearance-none bg-transparent range-x focus:outline-none"
                  aria-label="${translateText("send_troops_modal.aria_slider")}"
                  aria-valuemin="0"
                  aria-valuemax=${maxAmount}
                  aria-valuenow=${this.sendTroopsAmount}
                  style="
                  --percent:${percent}%;
                  --fill: rgb(168 85 247);
                  --track: rgba(255,255,255,.28);
                  --thumb-ring: rgb(24 24 27);
                  "
                />

                <div
                  class="pointer-events-none absolute -top-6 -translate-x-1/2 select-none"
                  style="left:${percent}%"
                >
                  <div
                    class="rounded bg-[#0f1116] ring-1 ring-zinc-700 text-zinc-100
                        px-1.5 py-0.5 text-[12px] shadow whitespace-nowrap w-max z-50"
                  >
                    ${percent}% • ${renderTroops(this.sendTroopsAmount)}
                  </div>
                </div>

                <!-- Min keep indicator -->
                ${this.total > 0
                  ? html` <div
                      class="pointer-events-none absolute top-1/2 h-3 w-[3px]
                           -translate-y-1/2 rounded-sm bg-amber-500 ring-1 ring-amber-300/60"
                      style="left: ${((this.total - minKeepAbs) / this.total) *
                      100}%"
                    ></div>`
                  : null}
              </div>
            </div>

            <!-- Summary -->
            <div class="mt-2 text-center text-sm text-zinc-200">
              ${translateText("send_troops_modal.summary_send")}
              <span class="font-semibold text-indigo-400 font-mono"
                >${renderTroops(this.sendTroopsAmount)}</span
              >
              · ${translateText("send_troops_modal.summary_keep")}
              <span
                class="font-semibold font-mono ${belowMinKeep
                  ? "text-amber-400"
                  : "text-emerald-400"}"
              >
                ${renderTroops(this.total - this.sendTroopsAmount)}
              </span>
            </div>

            <!-- Actions -->
            <div class="mt-5 flex justify-end gap-2">
              <button
                class="h-10 min-w-24 rounded-lg px-3 text-sm font-semibold
                  text-zinc-100 bg-zinc-800 ring-1 ring-zinc-700
                  hover:bg-zinc-700 focus:outline-none
                    focus-visible:ring-2 focus-visible:ring-white/20"
                @click=${() => this.closeTroopsModal()}
              >
                ${translateText("send_troops_modal.cancel")}
              </button>
              <button
                class="h-10 min-w-24 rounded-lg px-3 text-sm font-semibold text-white
                    bg-indigo-600 enabled:hover:bg-indigo-500
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50
                    disabled:cursor-not-allowed disabled:opacity-50"
                ?disabled=${this.sendTroopsAmount <= 0 ||
                this.sendTroopsAmount > this.total}
                @click=${() => this.confirmSendTroops()}
              >
                ${translateText("send_troops_modal.send")}
              </button>
            </div>

            <!-- Slider styling -->
            <style>
              /* Remove number input spinners */
              .no-spinners::-webkit-outer-spin-button,
              .no-spinners::-webkit-inner-spin-button {
                -webkit-appearance: none;
                margin: 0;
              }

              .no-spinners[type="number"] {
                -moz-appearance: textfield;
              }

              /* Webkit */
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

              /* Firefox */
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
          </div>
        </div>
      </div>
    `;
  }
}
