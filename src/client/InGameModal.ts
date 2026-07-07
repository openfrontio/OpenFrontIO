import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { translateText } from "./Utils";

type Resolver = (confirmed: boolean) => void;

/**
 * A lightweight in-game replacement for the native `confirm()` / `alert()`
 * browser dialogs. CrazyGames does not allow native browser prompts inside the
 * game frame, so these must be rendered in-game. While a pop-up is displayed we
 * report gameplay as stopped to CrazyGames (and resume it when dismissed).
 */
@customElement("in-game-modal")
export class InGameModal extends LitElement {
  @state() private isVisible = false;
  @state() private message = "";
  @state() private showCancel = true;
  private resolver: Resolver | null = null;

  createRenderRoot() {
    // Light DOM so Tailwind classes apply.
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.onKeyDown);
    super.disconnectedCallback();
  }

  open(message: string, showCancel: boolean): Promise<boolean> {
    // Dismiss any dialog already on screen before showing the new one.
    this.resolver?.(false);

    this.message = message;
    this.showCancel = showCancel;
    this.isVisible = true;
    this.requestUpdate();

    crazyGamesSDK.gameplayStop();

    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
    });
  }

  private close(confirmed: boolean) {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.requestUpdate();

    crazyGamesSDK.gameplayStart();

    const resolve = this.resolver;
    this.resolver = null;
    resolve?.(confirmed);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.isVisible) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.close(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.close(true);
    }
  };

  render() {
    if (!this.isVisible) return null;
    return html`
      <div
        class="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) this.close(false);
        }}
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div
          class="bg-slate-800 border border-slate-600 rounded-lg max-w-sm w-full p-6 shadow-xl"
        >
          <div class="text-white text-base whitespace-pre-line mb-6">
            ${this.message}
          </div>
          <div class="flex justify-end gap-3">
            ${this.showCancel
              ? html`<button
                  class="px-4 py-2 rounded-md text-sm font-medium text-white bg-slate-600 hover:bg-slate-500 transition-colors"
                  @click=${() => this.close(false)}
                >
                  ${translateText("common.cancel")}
                </button>`
              : null}
            <button
              class="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors"
              @click=${() => this.close(true)}
            >
              ${this.showCancel
                ? translateText("common.confirm")
                : translateText("common.close")}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

let instance: InGameModal | null = null;

function getInstance(): InGameModal {
  if (instance === null) {
    instance = document.createElement("in-game-modal") as InGameModal;
    document.body.appendChild(instance);
  }
  return instance;
}

/** In-game replacement for `confirm()`. Resolves true when confirmed. */
export function showInGameConfirm(message: string): Promise<boolean> {
  return getInstance().open(message, true);
}

/** In-game replacement for `alert()`. Resolves once dismissed. */
export function showInGameAlert(message: string): Promise<boolean> {
  return getInstance().open(message, false);
}
