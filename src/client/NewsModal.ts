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
    :host {
      display: block;
    }

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
                <h3>Main things to note:</h3>
                <br />
                <ul>
                  <li>Workers reproduce faster than troops.</li>
                  <li>Defense = troops divided how much land you have.</li>
                  <li>Attacking troops count toward your population limit.</li>
                </ul>
                <br />
                <br />
                See full changelog
                <a
                  href="https://discord.com/channels/1284581928254701718/1286745902320713780"
                  target="_blank"
                  style="color: #4a9eff; font-weight: bold;"
                  >here</a
                >.
              </div>
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
}
