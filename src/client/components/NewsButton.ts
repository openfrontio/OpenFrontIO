import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import megaphone from "../../../resources/images/Megaphone.svg";
import { NewsModal } from "../NewsModal";
import { translateText } from "../Utils";

@customElement("news-button")
export class NewsButton extends LitElement {
  @property({ type: Boolean })
  hidden = false;

  static styles = css`
    .news-button {
      opacity: 0.75;
      transition: opacity 0.2s ease;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      margin: 0;
      border: none;
      background: none;
      cursor: pointer;
    }

    .news-button:hover {
      opacity: 1;
    }

    .news-button img {
      width: 24px;
      height: 24px;
      display: block;
      margin-left: 12px;
    }

    .hidden {
      display: none !important;
    }
  `;

  private handleClick() {
    const newsModal = document.querySelector("news-modal") as NewsModal;
    if (newsModal) {
      newsModal.open();
    }
  }

  render() {
    return html`
      <div class="text-center mb-0.5 ${this.hidden ? "hidden" : ""}">
        <button class="news-button" @click=${this.handleClick}>
          <img src="${megaphone}" alt=${translateText("news.title")} />
        </button>
      </div>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
