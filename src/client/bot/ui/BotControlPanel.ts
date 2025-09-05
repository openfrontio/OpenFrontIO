import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getBotIntegration } from "../integration/BotIntegration";
import { BotStatus } from "../PlayerBot";

@customElement("bot-control-panel")
export class BotControlPanel extends LitElement {
  @state() private botStatus: BotStatus | null = null;
  @state() private isVisible = false;
  private updateInterval: number | null = null;

  static styles = css`
    :host {
      position: relative;
      z-index: 1000;
      font-family: "Overpass", sans-serif;
      display: none; /* Hidden by default until bot integration is available */
    }

    .bot-panel {
      background: rgba(0, 0, 0, 0.8);
      border: 1px solid #555;
      border-radius: 8px;
      padding: 12px;
      color: white;
      min-width: 250px;
      max-width: 400px;
    }

    .toggle-btn {
      background: #4caf50;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      margin-bottom: 8px;
    }

    .toggle-btn:hover {
      background: #45a049;
    }

    .toggle-btn.stop {
      background: #f44336;
    }

    .toggle-btn.stop:hover {
      background: #da190b;
    }

    .status-line {
      margin: 4px 0;
      font-size: 12px;
    }

    .confidence-bar {
      width: 100%;
      height: 6px;
      background: #333;
      border-radius: 3px;
      overflow: hidden;
      margin: 4px 0;
    }

    .confidence-fill {
      height: 100%;
      background: linear-gradient(90deg, #f44336 0%, #ff9800 50%, #4caf50 100%);
      transition: width 0.3s ease;
    }

    .recommendations {
      max-height: 80px;
      overflow-y: auto;
      font-size: 11px;
      margin-top: 8px;
      padding: 4px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
    }

    .hide-btn {
      position: absolute;
      top: 4px;
      right: 4px;
      background: none;
      border: none;
      color: #ccc;
      cursor: pointer;
      font-size: 16px;
    }

    .show-btn {
      background: rgba(0, 0, 0, 0.6);
      border: 1px solid #555;
      border-radius: 4px;
      color: white;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 12px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.startUpdating();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopUpdating();
  }

  private startUpdating() {
    this.updateStatus();
    this.updateInterval = window.setInterval(() => {
      this.updateStatus();
    }, 1000);
  }

  private stopUpdating() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  private updateStatus() {
    const botIntegration = getBotIntegration();
    this.botStatus = botIntegration?.getStatus() ?? null;

    // Hide the component if no bot integration is available
    if (!this.botStatus) {
      this.style.display = "none";
    } else {
      this.style.display = "block";
    }
  }

  private toggleBot() {
    const botIntegration = getBotIntegration();
    if (!botIntegration) {
      console.warn("Bot not available");
      return;
    }

    if (botIntegration.isRunning()) {
      botIntegration.stop();
      console.log("Bot stopped via UI");
    } else {
      botIntegration.start();
      console.log("Bot started via UI");
    }
  }

  private toggleVisibility() {
    this.isVisible = !this.isVisible;
  }

  render() {
    if (!this.botStatus) {
      // Component is hidden via CSS when no bot status, but render empty content just in case
      return html``;
    }

    if (!this.isVisible) {
      return html`
        <div
          class="show-btn"
          @click=${this.toggleVisibility}
          title="Show Bot Control Panel"
        >
          🤖 ${this.botStatus.isEnabled ? "✅" : "⏸️"}
        </div>
      `;
    }

    const confidenceColor =
      this.botStatus.confidence > 70
        ? "#4CAF50"
        : this.botStatus.confidence > 40
          ? "#ff9800"
          : "#f44336";

    return html`
      <div class="bot-panel">
        <button class="hide-btn" @click=${this.toggleVisibility}>×</button>

        <h3 style="margin: 0 0 8px 0; font-size: 14px;">🤖 AI Assistant</h3>

        <button
          class="toggle-btn ${this.botStatus.isEnabled ? "stop" : ""}"
          @click=${this.toggleBot}
        >
          ${this.botStatus.isEnabled ? "Stop Bot" : "Start Bot"}
        </button>

        <div class="status-line">
          <strong>Phase:</strong> ${this.botStatus.currentPhase}
        </div>

        <div class="status-line">
          <strong>Status:</strong> ${this.botStatus.isActive
            ? "Active"
            : "Idle"}
        </div>

        <div class="status-line">
          <strong>Decision:</strong> ${this.botStatus.lastDecision}
        </div>

        <div class="status-line">
          <strong>Confidence:</strong> ${this.botStatus.confidence}%
        </div>

        <div class="confidence-bar">
          <div
            class="confidence-fill"
            style="width: ${this.botStatus
              .confidence}%; background-color: ${confidenceColor};"
          ></div>
        </div>

        ${this.botStatus.recommendations.length > 0
          ? html`
              <div class="recommendations">
                <strong>Recommendations:</strong>
                <ul style="margin: 4px 0; padding-left: 16px;">
                  ${this.botStatus.recommendations.map(
                    (rec) => html`<li>${rec}</li>`,
                  )}
                </ul>
              </div>
            `
          : ""}
      </div>
    `;
  }
}

// Helper function to add bot control panel to any container
export function addBotControlPanel(
  container: HTMLElement = document.body,
): BotControlPanel {
  const panel = new BotControlPanel();
  container.appendChild(panel);
  return panel;
}

// Note: The bot-control-panel element is now defined in index.html
// and will be initialized by the GameRenderer like other UI components
