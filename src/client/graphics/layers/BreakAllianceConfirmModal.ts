import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { PlayerView } from "../../../core/game/GameView";
import { translateText } from "../../Utils";

@customElement("break-alliance-confirm-modal")
export class BreakAllianceConfirmModal extends LitElement {
  @property({ type: Boolean }) open: boolean = false;
  @property({ attribute: false }) target: PlayerView | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("open") && this.open) {
      queueMicrotask(() =>
        (this.querySelector('[role="dialog"]') as HTMLElement | null)?.focus(),
      );
    }
  }

  private closeModal() {
    this.dispatchEvent(new CustomEvent("close"));
  }

  private confirm() {
    this.dispatchEvent(
      new CustomEvent("confirm", {
        detail: { confirmed: true },
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

  private i18n = {
    title: () => translateText("break_alliance_confirm.title"),
    message: (name: string) =>
      translateText("break_alliance_confirm.message", { name }),
    warning: (name: string) =>
      translateText("break_alliance_confirm.warning", { name }),
    cancel: () => translateText("common.cancel"),
    confirm: () => translateText("break_alliance_confirm.confirm_button"),
    closeLabel: () => translateText("common.close"),
  };

  private renderHeader() {
    return html`
      <div class="mb-3 flex items-center justify-between relative">
        <h2
          id="break-alliance-title"
          class="text-lg font-semibold tracking-tight text-zinc-100"
        >
          ${this.i18n.title()}
        </h2>
        <!-- Close button -->
        <button
          type="button"
          @click=${() => this.closeModal()}
          class="absolute -top-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700 text-white shadow hover:bg-red-500 transition-colors focus-visible:ring-2 focus-visible:ring-white/30 focus:outline-none"
          aria-label=${this.i18n.closeLabel()}
          title=${this.i18n.closeLabel()}
        >
          ✕
        </button>
      </div>
    `;
  }

  private renderContent() {
    const targetName = this.target?.name?.() ?? "";
    return html`
      <div class="mb-4 text-zinc-200">
        <p class="mb-3 text-sm">${this.i18n.message(targetName)}</p>
        <div
          class="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200 text-sm"
        >
          <div class="font-semibold mb-1">⚠️ Warning</div>
          <div class="text-xs">${this.i18n.warning(targetName)}</div>
        </div>
      </div>
    `;
  }

  private renderActions() {
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
                 bg-red-600 hover:bg-red-500
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
          @click=${() => this.confirm()}
        >
          ${this.i18n.confirm()}
        </button>
      </div>
    `;
  }

  render() {
    if (!this.open) return html``;

    return html`
      <div
        class="absolute inset-0 z-[1100] flex items-center justify-center p-4"
      >
        <div
          class="absolute inset-0 bg-black/60 rounded-2xl"
          @click=${() => this.closeModal()}
        ></div>

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="break-alliance-title"
          class="relative z-10 w-full max-w-[440px] focus:outline-none"
          tabindex="0"
          @keydown=${this.handleKeydown}
        >
          <div
            class="rounded-2xl bg-zinc-900 p-5 shadow-2xl ring-1 ring-zinc-800 text-zinc-200"
            @click=${(e: MouseEvent) => e.stopPropagation()}
          >
            ${this.renderHeader()} ${this.renderContent()}
            ${this.renderActions()}
          </div>
        </div>
      </div>
    `;
  }
}
