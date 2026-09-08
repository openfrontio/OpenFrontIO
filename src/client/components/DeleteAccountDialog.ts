import { html, LitElement, render as litRender } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../Utils";

/**
 * Hard-confirm dialog for account deletion. Confirming logs the player out
 * everywhere at once and schedules the account for irreversible deletion 24
 * hours later (only support can cancel), so the confirm button stays disabled
 * until the player types the confirmation word. Mirrors <confirm-dialog>'s
 * danger styling and body portal (escapes the account modal's stacking
 * context); kept separate so the shared dialog doesn't grow a
 * typed-confirmation mode for a single caller.
 *
 * Emits `confirm` when the typed word matches and the button is pressed,
 * `cancel` on cancel / backdrop click.
 */
@customElement("delete-account-dialog")
export class DeleteAccountDialog extends LitElement {
  @state() private typedWord = "";

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

  private confirmWord(): string {
    return translateText("account_modal.delete_account_confirm_word");
  }

  private wordMatches(): boolean {
    return (
      this.typedWord.trim().toUpperCase() === this.confirmWord().toUpperCase()
    );
  }

  private renderOverlay() {
    const word = this.confirmWord();
    return html`
      <div
        class="fixed inset-0 z-[10020] flex items-center justify-center bg-black/80"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.handleCancel();
        }}
      >
        <div
          class="relative mx-4 w-full max-w-md p-6 rounded-2xl border border-red-500/50 bg-surface shadow-2xl"
        >
          <h2 class="text-lg font-bold text-white mb-2">
            ${translateText("account_modal.delete_account_title")}
          </h2>
          <p class="text-sm font-medium text-red-300 mb-5">
            ${translateText("account_modal.delete_account_warning")}
          </p>
          <label class="block mb-5">
            <span class="text-white/50 text-xs">
              ${translateText("account_modal.delete_account_type_to_confirm", {
                word,
              })}
            </span>
            <input
              type="text"
              .value=${this.typedWord}
              @input=${(e: Event) =>
                (this.typedWord = (e.target as HTMLInputElement).value)}
              placeholder=${word}
              autocomplete="off"
              class="mt-1.5 w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-red-500/50 text-sm"
            />
          </label>
          <div class="flex gap-3">
            <button
              @click=${() => this.handleCancel()}
              class="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white/80 transition-all"
            >
              ${translateText("common.cancel")}
            </button>
            <button
              @click=${() => this.handleConfirm()}
              ?disabled=${!this.wordMatches()}
              class="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl bg-red-600 text-white hover:bg-red-700 transition-all disabled:opacity-50 disabled:pointer-events-none border-0"
            >
              ${translateText("account_modal.delete_account_confirm_button")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private handleConfirm() {
    if (!this.wordMatches()) return;
    this.dispatchEvent(new CustomEvent("confirm"));
  }

  private handleCancel() {
    this.dispatchEvent(new CustomEvent("cancel"));
  }
}
