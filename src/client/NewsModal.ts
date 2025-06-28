import { CapacitorHttp } from "@capacitor/core";
import { LitElement, css, html } from "lit";
import { resolveMarkdown } from "lit-markdown";
import { customElement, property, query } from "lit/decorators.js";
import changelog from "../../resources/changelog.md";
import { translateText } from "../client/Utils";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";

@customElement("news-modal")
export class NewsModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
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
          ${translateText("news.full_changelog")}
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
      CapacitorHttp.get({
        url: `${process.env.APP_BASE_URL || ""}${changelog}`,
      })
        .then((response) =>
          response.status === 200 ? response.data : "Failed to load",
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
