import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invalidateUserMe } from "../../Api";
import { withdrawClanRequest } from "../../ClanApi";
import { translateText } from "../../Utils";
import { formatClanDate, showToast } from "./ClanShared";

@customElement("clan-my-requests-view")
export class ClanMyRequestsView extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ type: Array }) myPendingRequests: {
    tag: string;
    name: string;
    createdAt: string;
  }[] = [];

  @state() private actionPending = false;

  async handleWithdrawRequest(tag: string) {
    if (this.actionPending) return;
    this.actionPending = true;
    try {
      const result = await withdrawClanRequest(tag);
      if (result !== true) {
        showToast(translateText(result.error), "red");
        return;
      }
      invalidateUserMe();
      showToast(translateText("clan_modal.join_request_cancelled"), "green");
      this.dispatchEvent(
        new CustomEvent("request-withdrawn", {
          detail: { tag },
          bubbles: true,
          composed: true,
        }),
      );
    } finally {
      this.actionPending = false;
    }
  }

  render() {
    return html`
      <div>
        ${this.myPendingRequests.length === 0
          ? html`<p class="text-white/40 text-sm text-center py-8">
              ${translateText("clan_modal.no_pending_applications")}
            </p>`
          : html`
              <div class="space-y-3">
                ${this.myPendingRequests.map(
                  (req) => html`
                    <div
                      class="flex items-center gap-3 bg-white/5 rounded-xl border border-white/10 p-4"
                    >
                      <div
                        class="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20 shrink-0"
                      >
                        <span class="text-amber-400 font-bold text-xs"
                          >${req.tag}</span
                        >
                      </div>
                      <div class="flex-1 min-w-0">
                        <span
                          class="text-white font-bold text-sm truncate block"
                          >${req.name}</span
                        >
                        <span class="text-white/30 text-xs">
                          ${translateText("clan_modal.applied")}
                          ${formatClanDate(req.createdAt)}
                        </span>
                      </div>
                      <button
                        @click=${() => this.handleWithdrawRequest(req.tag)}
                        ?disabled=${this.actionPending}
                        class="text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/20 hover:bg-red-500/25 transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                      >
                        ${translateText("clan_modal.cancel_request")}
                      </button>
                    </div>
                  `,
                )}
              </div>
            `}
      </div>
    `;
  }
}
