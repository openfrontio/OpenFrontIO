import { html, LitElement, render as litRender } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../Utils";

/**
 * A reusable inline confirmation dialog.
 *
 * Usage:
 * ```html
 * <confirm-dialog
 *   .message=${"Are you sure?"}
 *   variant="danger"
 *   @confirm=${() => doThing()}
 *   @cancel=${() => {}}
 * ></confirm-dialog>
 * ```
 *
 * For ban-style flows, add a textarea:
 * ```html
 * <confirm-dialog
 *   .message=${"Ban this player?"}
 *   variant="warning"
 *   textareaPlaceholder="Reason (optional)"
 *   @confirm=${(e) => ban(e.detail.text)}
 *   @cancel=${() => {}}
 * ></confirm-dialog>
 * ```
 */
@customElement("confirm-dialog")
export class ConfirmDialog extends LitElement {
  @property() message = "";
  @property() variant: "danger" | "warning" = "danger";
  @property() textareaPlaceholder = "";
  @property({ type: Boolean }) disabled = false;

  @state() private text = "";

  private portal: HTMLDivElement | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.portal = document.createElement("div");
    document.body.appendChild(this.portal);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.portal) {
      litRender(html``, this.portal);
      this.portal.remove();
      this.portal = null;
    }
  }

  render() {
    if (this.portal) {
      litRender(this.renderOverlay(), this.portal);
    }
    return html``;
  }

  private renderOverlay() {
    const isDanger = this.variant === "danger";
    const borderColor = isDanger ? "border-red-500/50" : "border-amber-500/50";
    const cardBg = "bg-surface";
    const textColor = isDanger ? "text-red-300" : "text-amber-300";
    const btnClass = isDanger
      ? "bg-red-600 text-white hover:bg-red-700"
      : "bg-amber-600 text-white hover:bg-amber-700";

    return html`
      <div
        class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.handleCancel();
        }}
      >
        <div
          class="mx-4 w-full max-w-sm p-6 rounded-2xl border ${borderColor} ${cardBg} shadow-2xl"
        >
          <p class="text-sm font-medium ${textColor} mb-5">${this.message}</p>
          ${this.textareaPlaceholder
            ? html`<textarea
                .value=${this.text}
                @input=${(e: Event) =>
                  (this.text = (e.target as HTMLTextAreaElement).value)}
                maxlength="200"
                rows="2"
                placeholder="${this.textareaPlaceholder}"
                class="w-full px-3 py-2 mb-4 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-amber-500/50 text-sm resize-none"
              ></textarea>`
            : ""}
          <div class="flex gap-3">
            <button
              @click=${() => this.handleCancel()}
              ?disabled=${this.disabled}
              class="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white/80 transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              ${translateText("common.cancel")}
            </button>
            <button
              @click=${() => this.handleConfirm()}
              ?disabled=${this.disabled}
              class="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl ${btnClass} transition-all disabled:opacity-50 disabled:pointer-events-none border-0"
            >
              ${translateText("common.confirm")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private handleConfirm() {
    this.dispatchEvent(
      new CustomEvent("confirm", { detail: { text: this.text } }),
    );
    this.text = "";
  }

  private handleCancel() {
    this.dispatchEvent(new CustomEvent("cancel"));
    this.text = "";
  }
}
