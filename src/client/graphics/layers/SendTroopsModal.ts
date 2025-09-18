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
  @state() private sendTroopsKeepThirty: boolean = true;

  createRenderRoot() {
    return this;
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

  render() {
    // if not ready yet, render nothing
    if (!this.myPlayer || !this.troopsTarget) return html``;

    const minKeepAbs = Math.floor(this.total * 0.3);
    const maxAmount = this.total;

    const safeAmount = Math.min(this.sendTroopsAmount, maxAmount);
    if (safeAmount !== this.sendTroopsAmount)
      this.sendTroopsAmount = safeAmount;

    const keepAfter = this.total - this.sendTroopsAmount;
    const belowMinKeep = keepAfter < minKeepAbs;

    const setByPercent = (p: number) => {
      const next = Math.floor((this.total * p) / 100);
      this.sendTroopsAmount = Math.min(next, maxAmount);
    };

    return html`
      <div class="fixed inset-0 z-[1100] flex items-center justify-center">
        <div
          class="absolute inset-0 bg-black/60"
          @click=${() => this.closeTroopsModal()}
        ></div>

        <div
          class="relative z-10 w-full max-w-[340px] rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
        >
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-lg font-semibold text-zinc-100">
              Send Troops → ${this.troopsTarget?.name()}
            </h2>
            <button
              class="rounded-md px-2 text-2xl leading-none text-zinc-400 hover:text-zinc-200"
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
          <div class="mb-3 flex gap-2">
            ${[10, 25, 50, 75].map(
              (p) => html`
                <button
                  class="flex-1 rounded-lg border px-3 py-2 text-sm
                ${Math.round(
                    (this.sendTroopsAmount / Math.max(1, this.total)) * 100,
                  ) === p
                    ? "border-indigo-500 bg-indigo-600 text-white"
                    : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}"
                  @click=${() => setByPercent(p)}
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
                max="${maxAmount}"
                .value=${String(this.sendTroopsAmount)}
                @input=${(e: Event) => {
                  const target = e.target as HTMLInputElement;
                  const v = parseInt(target.value) || 0;
                  this.sendTroopsAmount = Math.max(0, Math.min(v, maxAmount));
                }}
                class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-base text-zinc-100 outline-none focus:border-purple-500"
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
                class="w-full text-white range-purple"
              />

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
            ${belowMinKeep
              ? html` <div class="mt-1 text-xs font-medium text-red-400">
                  You’re sending more than 70% (advisory). Consider keeping ≥
                  ${renderTroops(minKeepAbs)}.
                </div>`
              : null}
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

          <style>
            .range-purple {
              accent-color: rgb(168 85 247);
            }
            .range-purple::-webkit-slider-runnable-track {
              height: 8px;
              border-radius: 9999px;
              background: rgb(91 33 182);
            }
            .range-purple::-webkit-slider-thumb {
              -webkit-appearance: none;
              height: 18px;
              width: 18px;
              margin-top: -5px;
              border-radius: 9999px;
              background: rgb(168 85 247);
              border: 3px solid rgb(24 24 27);
            }
            .range-purple::-moz-range-track {
              height: 8px;
              border-radius: 9999px;
              background: rgb(91 33 182);
            }
            .range-purple::-moz-range-progress {
              height: 8px;
              border-radius: 9999px;
              background: rgb(168 85 247);
            }
            .range-purple::-moz-range-thumb {
              height: 18px;
              width: 18px;
              border-radius: 9999px;
              background: rgb(168 85 247);
              border: 3px solid rgb(24 24 27);
            }
            /* Progress-style range: white base with a colored fill */
          </style>
        </div>
      </div>
    `;
  }
}
