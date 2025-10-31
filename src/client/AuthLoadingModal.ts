import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "./Utils";

@customElement("auth-loading-modal")
export class AuthLoadingModal extends LitElement {
  @property({ type: Boolean }) visible = false;

  createRenderRoot() {
    return this;
  }

  show() {
    this.visible = true;
    document.body.style.overflow = "hidden";
  }

  hide() {
    this.visible = false;
    document.body.style.overflow = "auto";
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.body.style.overflow = "auto";
  }

  render() {
    if (!this.visible) return html``;

    return html`
      <aside
        class="fixed p-4 z-[1000] inset-0 bg-black/50 flex items-center justify-center"
      >
        <div
          class="relative bg-gray-800/80 backdrop-blur-md rounded-xl min-w-[340px] max-w-[480px] w-full"
        >
          <div
            class="animate-pulse  absolute border-4 border-white/55 -inset-1 rounded-2xl"
          ></div>
          <div
            class="rounded-lg m-2 text-lg font-bold bg-black/20 text-center text-white px-6 py-4"
          >
            ${translateText("auth_loading_modal.title")}
          </div>
          <section class="text-white p-6 text-center">
            <div
              class="animate-spin inline-block w-8 h-8 border-4 border-white border-t-transparent rounded-full"
            ></div>
            <p class="animate-pulse mt-4 opacity-80">
              ${translateText("auth_loading_modal.please_wait")}
            </p>
          </section>
        </div>
      </aside>
    `;
  }
}

export function getAuthModal(): AuthLoadingModal {
  let modal = document.querySelector("auth-loading-modal");
  if (!modal) {
    modal = document.createElement("auth-loading-modal");
    document.body.appendChild(modal);
  }
  return modal as any as AuthLoadingModal;
}
