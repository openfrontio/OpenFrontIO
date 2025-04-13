import { LitElement, html } from "lit";
import { customElement, query } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { translateText } from "../client/Utils";
import "./components/Difficulties";
import "./components/Maps";

@customElement("support-us-modal")
export class SupportUsModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  createRenderRoot() {
    return this;
  }

  render() {
    return html` <o-modal
      id="supportUsModal"
      title=${translateText("support.title")}
    >
      <div class="flex flex-col gap-6">
        <div class="text-xl md:text-2xl font-semibold text-center">
          ${translateText("support.greeting")}
        </div>

        <p>${unsafeHTML(translateText("support.p1"))}</p>
        <p>${unsafeHTML(translateText("support.p2"))}</p>
        <p>${unsafeHTML(translateText("support.p3"))}</p>

        <div class="text-lg font-bold text-center">
          ${unsafeHTML(translateText("support.closing"))}
        </div>

        <div class="mt-6 flex justify-center">
          <a
            href="https://www.patreon.com/openfront"
            target="_blank"
            class="bg-green-600 hover:bg-green-700 text-white py-3 px-6 rounded-lg text-lg font-medium transition-colors duration-300"
          >
            ${translateText("support.button")}
          </a>
        </div>
      </div>
    </o-modal>`;
  }

  public open() {
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }
}
