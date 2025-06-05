import { LitElement, css, html } from "lit";
import { customElement, query } from "lit/decorators.js";
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
      <o-modal>
        <div class="options-layout">
          <div class="options-section">
            <div class="news-container">
              <div class="news-content">
                <p>
                  This test version introduces a new building:
                  <strong>Hospitals</strong>. Each hospital restores some of
                  your troop losses from both offensive and defensive combat.
                  The restored troops are displayed next to your population
                  growth count in your control panel.
                </p>
                <p>
                  The first hospital provides a
                  <strong>10% reduction</strong> in combat casualties. Each
                  additional hospital reduces losses by
                  <strong>75% of the previous reduction</strong>.
                </p>
                <ul>
                  <li>1st hospital: 10% reduction</li>
                  <li>2nd hospital: 7.5% additional reduction</li>
                  <li>3rd hospital: 5.6% additional reduction</li>
                  <li>... and so on</li>
                </ul>
                <p>These effects stack cumulatively.</p>
                <p>
                  For a full list of changes, join the
                  <a
                    href="https://discord.com/channels/1379151032369676338/1379156389699649566"
                    target="_blank"
                  >
                    Discord </a
                  >.
                </p>
              </div>
            </div>
          </div>
        </div>

        <o-button title="Close" @click=${this.close} blockDesktop></o-button>
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
