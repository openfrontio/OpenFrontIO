import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { ReportReason, ReportReasonSchema } from "../../../core/Schemas";
import { SendPlayerReportEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { PlayerView } from "../../view";
const reportIcon = assetUrl("images/SirenIconWhite.svg");

// Picks a reason and files a report against `target` with the game server,
// which forwards it to the API with the archived game (see
// GameServer.handleReport). Nothing comes back to the reporter.
@customElement("player-report-modal")
export class PlayerReportModal extends LitElement {
  @property({ attribute: false }) eventBus: EventBus | null = null;
  @property({ attribute: false }) target: PlayerView | null = null;
  @property({ type: Boolean }) open: boolean = false;

  @state() private reason: ReportReason | null = null;

  createRenderRoot() {
    return this;
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("open") && this.open) {
      this.reason = null;
      queueMicrotask(() =>
        (this.querySelector('[role="dialog"]') as HTMLElement | null)?.focus(),
      );
    }
  }

  private closeModal() {
    this.dispatchEvent(new CustomEvent("close"));
  }

  private handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      this.closeModal();
    }
  };

  private handleSubmit = (e: MouseEvent) => {
    e.stopPropagation();
    const other = this.target;
    const reason = this.reason;
    if (!other || !reason || !this.eventBus) return;
    const targetClientID = other.clientID();
    if (!targetClientID) return;

    // Transport answers with PlayerReportedEvent once the report is sent.
    this.eventBus.emit(new SendPlayerReportEvent(targetClientID, reason));
    this.closeModal();
  };

  render() {
    if (!this.open) return html``;
    const other = this.target;
    if (!other) return html``;

    const title = translateText("player_panel.report_title");

    return html`
      <div class="absolute inset-0 z-1200 flex items-center justify-center p-4">
        <div
          class="absolute inset-0 bg-black/60 rounded-2xl"
          @click=${() => this.closeModal()}
        ></div>

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-title"
          class="relative z-10 w-full max-w-120 focus:outline-hidden"
          tabindex="0"
          @keydown=${this.handleKeydown}
        >
          <div
            class="rounded-2xl bg-zinc-900 p-5 shadow-2xl ring-1 ring-zinc-800 max-h-[90vh] text-zinc-200"
            @click=${(e: MouseEvent) => e.stopPropagation()}
          >
            <div class="mb-3 flex items-center justify-between relative">
              <div class="flex items-center gap-2">
                <img
                  src=${reportIcon}
                  alt=""
                  aria-hidden="true"
                  class="h-5 w-5"
                />
                <h2
                  id="report-title"
                  class="text-lg font-semibold tracking-tight text-zinc-100"
                >
                  ${title}
                </h2>
              </div>

              <button
                type="button"
                @click=${() => this.closeModal()}
                class="absolute -top-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700 text-white shadow-sm hover:bg-red-500 transition-colors focus-visible:ring-2 focus-visible:ring-white/30 focus:outline-hidden"
                aria-label=${translateText("common.close")}
                title=${translateText("common.close")}
              >
                ✕
              </button>
            </div>

            <div
              class="mb-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
            >
              <div
                class="text-sm font-semibold text-zinc-100 truncate"
                title=${other.displayName()}
              >
                ${other.displayName()}
              </div>
            </div>

            <div class="mb-4 flex flex-col gap-1" role="radiogroup">
              ${ReportReasonSchema.options.map((reason) => {
                const selected = this.reason === reason;
                return html`
                  <button
                    type="button"
                    role="radio"
                    aria-checked=${selected}
                    @click=${() => (this.reason = reason)}
                    class=${`w-full text-left rounded-lg border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white/20 ${
                      selected
                        ? "border-red-400/60 bg-red-500/15 text-red-300"
                        : "border-white/10 bg-white/4 text-zinc-200 hover:bg-white/10"
                    }`}
                  >
                    ${translateText(`player_panel.report_reason_${reason}`)}
                  </button>
                `;
              })}
            </div>

            <button
              type="button"
              @click=${this.handleSubmit}
              ?disabled=${this.reason === null}
              class="w-full rounded-lg border border-red-400/40 bg-red-500/15 py-2 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-red-400/30"
            >
              ${translateText("player_panel.report_submit")}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
