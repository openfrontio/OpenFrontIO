import { LitElement, css, html } from "lit";
import { resolveMarkdown } from "lit-markdown";
import { customElement, property, query } from "lit/decorators.js";
import changelog from "../../resources/changelog.md";
import megaphone from "../../resources/images/Megaphone.svg";
import santaHatIcon from "../../resources/images/SantaHat.webp";
import version from "../../resources/version.txt";
import { translateText } from "../client/Utils";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";

@customElement("news-modal")
export class NewsModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeyDown);
    super.disconnectedCallback();
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      e.preventDefault();
      this.close();
    }
  };

  @property({ type: String }) markdown = "Loading...";

  private initialized: boolean = false;

  static styles = css`
    :host {
      display: block;
    }

    .news-container {
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .news-content {
      color: #ddd;
      line-height: 1.5;
      background: rgba(0, 0, 0, 0.6);
      border-radius: 8px;
      padding: 1rem;
    }

    .news-content a {
      color: #4a9eff !important;
      text-decoration: underline !important;
      transition: color 0.2s ease;
    }

    .news-content a:hover {
      color: #6fb3ff !important;
    }
  `;

  render() {
    return html`
      <o-modal title=${translateText("news.title")}>
        <div class="options-layout">
          <div class="options-section">
            <div class="news-container">
              <div class="news-content">
                ${resolveMarkdown(this.markdown, {
                  includeImages: true,
                  includeCodeBlockClassNames: true,
                })}
              </div>
            </div>
          </div>
        </div>

        <div>
          ${translateText("news.see_all_releases")}
          <a
            href="https://github.com/openfrontio/OpenFrontIO/releases"
            target="_blank"
            >${translateText("news.github_link")}</a
          >.
        </div>

        <o-button
          title=${translateText("common.close")}
          @click=${this.close}
          blockDesktop
        ></o-button>
      </o-modal>
    `;
  }

  public open() {
    if (!this.initialized) {
      this.initialized = true;
      fetch(changelog)
        .then((response) => (response.ok ? response.text() : "Failed to load"))
        .then((markdown) =>
          markdown
            .replace(
              /(?<!\()\bhttps:\/\/github\.com\/openfrontio\/OpenFrontIO\/pull\/(\d+)\b/g,
              (_match, prNumber) =>
                `[#${prNumber}](https://github.com/openfrontio/OpenFrontIO/pull/${prNumber})`,
            )
            .replace(
              /(?<!\()\bhttps:\/\/github\.com\/openfrontio\/OpenFrontIO\/compare\/([\w.-]+)\b/g,
              (_match, comparison) =>
                `[${comparison}](https://github.com/openfrontio/OpenFrontIO/compare/${comparison})`,
            ),
        )
        .then((markdown) => (this.markdown = markdown));
    }
    this.requestUpdate();
    this.modalEl?.open();
  }

  private close() {
    this.modalEl?.close();
  }
}

@customElement("news-button")
export class NewsButton extends LitElement {
  @query("news-modal") private newsModal!: NewsModal;

  connectedCallback() {
    super.connectedCallback();
    this.checkForNewVersion();
  }

  private checkForNewVersion() {
    const lastSeenVersion = localStorage.getItem("last-seen-version");
    if (lastSeenVersion !== null && lastSeenVersion !== version) {
      setTimeout(() => {
        this.openNewsModel();
      }, 500);
    }
  }

  private openNewsModel() {
    localStorage.setItem("last-seen-version", version);
    this.newsModal.open();
  }

  render() {
    return html`
      <div class="flex relative">
        <button
          class="border p-[4px] rounded-lg flex cursor-pointer border-black/30 dark:border-gray-300/60 bg-white/70 dark:bg-[rgba(55,65,81,0.7)]"
          @click=${this.openNewsModel}
        >
          <img
            class="size-[48px] dark:invert"
            src="${megaphone}"
            alt=${translateText("news.title")}
          />
          <div
            class="santa-hat-overlay absolute bg-contain bg-no-repeat pointer-events-none"
            style="background-image: url('${santaHatIcon}')"
          ></div>
        </button>
      </div>
      <news-modal></news-modal>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
