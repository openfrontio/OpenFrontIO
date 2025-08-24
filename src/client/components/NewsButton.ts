import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import megaphone from "../../../resources/images/Megaphone.svg";
import version from "../../../resources/version.txt";
import { NewsModal } from "../NewsModal";
import { translateText } from "../Utils";

@customElement("news-button")
export class NewsButton extends LitElement {
  @property({ type: Boolean }) hidden = false;
  @state() private isActive = false;

  connectedCallback() {
    super.connectedCallback();
    this.checkForNewVersion();
  }

  private checkForNewVersion() {
    try {
      const lastSeenVersion = localStorage.getItem("version");
      this.isActive = lastSeenVersion !== version;
    } catch (error) {
      // Fallback to NOT showing notification if localStorage fails
      this.isActive = false;
    }
  }

  private handleClick() {
    localStorage.setItem("version", version);
    this.isActive = false;

    const newsModal = document.querySelector("news-modal") as NewsModal;
    if (newsModal) {
      newsModal.open();
    }
  }

  render() {
    return html`
      <div
        class="flex relative ${this.hidden ? "parent-hidden" : ""} ${
          this.isActive ? "active" : ""
        }"
      >
        <button
          class="border p-[4px] rounded-lg flex cursor-pointer border-black/30
          dark:border-gray-300/60 bg-white/70 dark:bg-[rgba(55,65,81,0.7)]"
          @click=${this.handleClick}
        >
          <img
            class="size-[48px] dark:invert"
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
