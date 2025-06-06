import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import megaphone from "../../../resources/images/Megaphone.svg";
import { NewsModal } from "../NewsModal";
import { translateText } from "../Utils";

@customElement("news-button")
export class NewsButton extends LitElement {
  @property({ type: Boolean })
  hidden = false;

  private handleClick() {
    const newsModal = document.querySelector("news-modal") as NewsModal;
    if (newsModal) {
      newsModal.open();
    }
  }

  render() {
    return html`
      <div class="flex relative ${this.hidden ? "parent-hidden" : ""}">
        <button
          class="border p-[4px] rounded-lg flex cursor-pointer border-black/30 dark:border-gray-300/60 bg-white/70 dark:bg-[rgba(55,65,81,0.7)]"
          @click=${this.handleClick}
        >
          <img
            class="size-[48px]"
            src="${megaphone}"
            alt=${translateText("news.title")}
          />
        </button>
      </div>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
