import { LitElement, css, html } from "lit";
import { resolveMarkdown } from "lit-markdown";
import { customElement, property, query } from "lit/decorators.js";
import version from "resources/version.txt?raw";
import { translateText } from "../client/Utils";
import "./components/baseComponents/Modal";
import changelog from "/changelog.md?url";
import megaphone from "/images/Megaphone.svg?url";

@customElement("news-modal")
export class NewsModal extends LitElement {
  @property({ type: Boolean }) inline = false;
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  @property({ type: String }) markdown = "Loading...";

  private initialized: boolean = false;

  static styles = css`
    :host {
      display: block;
    }
    .news-content a:hover {
      color: #6fb3ff !important;
    }
  `;

  render() {
    return html`
      <o-modal title=${translateText("news.title")} ?inline=${this.inline}>
        ${resolveMarkdown(this.markdown, {
          includeImages: true,
          includeCodeBlockClassNames: true,
        })}
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
        this.open();
      }, 500);
    }
  }

  public open() {
    localStorage.setItem("last-seen-version", version);
    this.newsModal.open();
  }

  render() {
    return html`
      <button
        class="border p-[4px] rounded-lg flex cursor-pointer border-black/30 dark:border-gray-300/60 bg-white/70 dark:bg-[rgba(55,65,81,0.7)] hidden"
        @click=${this.open}
      >
        <img
          class="size-[48px] dark:invert"
          src="${megaphone}"
          alt=${translateText("news.title")}
        />
      </button>
      <news-modal></news-modal>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
