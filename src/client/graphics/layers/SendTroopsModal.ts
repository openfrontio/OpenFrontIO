import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { PlayerView } from "../../../core/game/GameView";
import { renderTroops } from "../../Utils";

@customElement("send-troops-modal")
class SendTroopsModal extends LitElement {
  @property({ type: Object }) myPlayer: PlayerView | null = null;
  @property({ type: Object }) troopsTarget: PlayerView | null = null;
  @property({ type: Boolean }) open: boolean = false;
  @property({ type: Number }) total: number = 0;

  @state() private sendTroopsAmount: number = 0;

  createRenderRoot() {
    return this;
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("total")) {
      const maxAllowed = this.total;
      if (this.sendTroopsAmount > maxAllowed)
        this.sendTroopsAmount = maxAllowed;
      if (this.sendTroopsAmount < 0) this.sendTroopsAmount = 0;
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

    const setByPercent = (p: number) => {
      const next = Math.floor((this.total * p) / 100);
      this.sendTroopsAmount = Math.min(next, maxAmount);
    };

    const setByAmount = (n: number) => {
      this.sendTroopsAmount = Math.max(0, Math.min(Math.floor(n), maxAmount));
    };

    const percent = this.total
      ? Math.round((this.sendTroopsAmount / this.total) * 100)
      : 0;
    const keepAfter = Math.max(0, this.total - this.sendTroopsAmount);
    const belowMinKeep = keepAfter < minKeepAbs;

    return html`
      <div
        class="fixed inset-0 z-[1100] flex items-center justify-center"
        @keydown=${this.handleKeydown}
      >
        <div
          class="absolute inset-0 bg-black/60"
          @click=${() => this.closeTroopsModal()}
        ></div>

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="send-troops-title"
          class="relative z-10 w-full max-w-[340px] rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
          tabindex="0"
        >
          <!-- Header -->
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-lg font-semibold text-zinc-100">
              Send Troops → ${this.troopsTarget?.name()}
            </h2>
            <button
              class="rounded-md px-2 text-2xl leading-none text-zinc-400 hover:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-white/20"
              @click=${() => this.closeTroopsModal()}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div class="mb-4 border-b border-zinc-700 pb-3 text-xs text-zinc-400">
            Available ${renderTroops(this.total)} · Min keep
            ${renderTroops(minKeepAbs)} (30%)
          </div>

          <!-- Preset chips -->
          <div class="mb-3 grid grid-cols-4 gap-2">
            ${[10, 25, 50, 75].map(
              (p) => html`
                <button
                  class="rounded-lg border px-3 py-2 text-sm
                ${percent === p
                    ? "border-indigo-500 bg-indigo-600 text-white"
                    : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}"
                  @click=${() => setByPercent(p)}
                  aria-pressed=${percent === p}
                  title="${p}%"
                >
                  ${p}%
                </button>
              `,
            )}
          </div>

          <!-- Number input -->
          <div class="mb-4 flex gap-2">
            <div class="relative w-full">
              <input
                type="number"
                min="0"
                max="${maxAmount / 10}"
                .value=${String(Math.floor(this.sendTroopsAmount / 10))}
                @input=${(e: Event) => {
                  const v = parseInt(
                    (e.target as HTMLInputElement).value || "0",
                  );
                  setByAmount(Number.isFinite(v) ? v * 10 : 0);
                }}
                class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-base text-zinc-100 outline-none focus:border-purple-500 no-spinners"
                aria-label="Troops to send"
              />
            </div>
          </div>

          <!-- Slider -->
          <div class="mb-2">
            <div class="relative px-1">
              <input
                type="range"
                min="0"
                max=${maxAmount}
                .value=${String(this.sendTroopsAmount)}
                @input=${(e: Event) =>
                  (this.sendTroopsAmount = Number(
                    (e.target as HTMLInputElement).value,
                  ))}
                class="w-full appearance-none bg-transparent range-x"
                aria-label="Troops slider"
                aria-valuemin="0"
                aria-valuemax=${maxAmount}
                aria-valuenow=${this.sendTroopsAmount}
                style="
              --percent:${percent}%;
              --fill: rgb(168 85 247);
              --track: rgba(255,255,255,.22);
              --thumb-ring: rgb(24 24 27);
            "
              />

              <div
                class="pointer-events-none absolute -top-6 -translate-x-1/2 select-none"
                style="left:${percent}%"
              >
                <div
                  class="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-100 shadow"
                >
                  ${percent}%
                </div>
              </div>

              <!-- Min keep indicator -->
              ${this.total > 0
                ? html` <div
                    class="pointer-events-none absolute top-1/2 h-3 w-[3px] -translate-y-1/2 rounded-sm bg-amber-500"
                    style="left: ${((this.total - minKeepAbs) / this.total) *
                    100}%"
                  ></div>`
                : null}
            </div>
          </div>

          <!-- Summary -->
          <div class="mt-2 text-center text-sm text-zinc-200">
            Send
            <span class="font-semibold text-indigo-400"
              >${renderTroops(this.sendTroopsAmount)}</span
            >
            · Keep
            <span
              class="font-semibold ${belowMinKeep
                ? "text-amber-400"
                : "text-emerald-400"}"
            >
              ${renderTroops(this.total - this.sendTroopsAmount)}
            </span>
          </div>

          <!-- Actions -->
          <div class="mt-5 flex justify-end gap-2">
            <button
              class="min-h-10 min-w-20 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-semibold text-zinc-100 hover:bg-zinc-700"
              @click=${() => this.closeTroopsModal()}
            >
              Cancel
            </button>
            <button
              class="min-h-10 min-w-20 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white
              enabled:hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              ?disabled=${this.sendTroopsAmount <= 0 ||
              this.sendTroopsAmount > this.total}
              @click=${() => this.confirmSendTroops()}
            >
              Send
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
    `;
  }
}
