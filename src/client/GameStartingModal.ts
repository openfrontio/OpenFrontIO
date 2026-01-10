import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "./Utils";

@customElement("game-starting-modal")
export class GameStartingModal extends LitElement {
  @state()
  isVisible = false;

  createRenderRoot() {
    return this;
  }

  render() {
    const isVisible = this.isVisible;
    return html`
      <div
        class="fixed inset-0 bg-black/30 backdrop-blur-[4px] z-[9998] transition-all duration-300 ${isVisible
          ? "opacity-100 visible"
          : "opacity-0 invisible"}"
      ></div>
      <div
        class="fixed top-1/2 left-1/2 bg-zinc-800/70 p-6 rounded-xl z-[9999] shadow-[0_0_20px_rgba(0,0,0,0.5)] backdrop-blur-[5px] text-white w-[300px] text-center transition-all duration-300 -translate-x-1/2 ${isVisible
          ? "opacity-100 visible -translate-y-1/2"
          : "opacity-0 invisible -translate-y-[48%]"}"
      >
        <div class="text-xl mt-5 mb-2.5 px-0">
          © OpenFront and Contributors
        </div>
        <a
          href="https://github.com/openfrontio/OpenFrontIO/blob/main/CREDITS.md"
          target="_blank"
          rel="noopener noreferrer"
          class="block mt-2.5 mb-4 text-xl text-blue-400 no-underline transition-colors duration-200 hover:text-blue-300 hover:underline"
          >${translateText("game_starting_modal.credits")}</a
        >
        <p class="my-0.5 text-sm">
          ${translateText("game_starting_modal.code_license")}
        </p>
        <p class="text-base my-5 bg-black/30 p-2.5 rounded">
          ${translateText("game_starting_modal.title")}
        </p>
      </div>
    `;
  }

  show() {
    this.isVisible = true;
    this.requestUpdate();
  }

  hide() {
    this.isVisible = false;
    this.requestUpdate();
  }
}
