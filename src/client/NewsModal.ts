import { LitElement, css, html } from "lit";
import { customElement, query } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";

@customElement("news-modal")
export class NewsModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  static styles = css`
    .news-container {
      max-height: 60vh;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .news-content {
      color: #ddd;
      line-height: 1.5;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 8px;
      padding: 1rem;
    }
  `;

  render() {
    return html`
      <o-modal title=${translateText("news.title")}>
        <div class="options-layout">
          <div class="options-section">
            <div class="news-container">
              <div class="news-content">INSERT NEWS HERE</div>
            </div>
          </div>
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
    this.requestUpdate();
    this.modalEl?.open();
  }

  private close() {
    this.modalEl?.close();
  }

  createRenderRoot() {
    return this; // light DOM
  }
}
