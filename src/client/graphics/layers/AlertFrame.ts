import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  BrokeAllianceUpdate,
  GameUpdateType,
} from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { Layer } from "./Layer";

// Parameters for the alert animation
const ALERT_SPEED = 1.6;
const ALERT_COUNT = 5;

@customElement("alert-frame")
export class AlertFrame extends LitElement implements Layer {
  public game: GameView;
  private userSettings: UserSettings = new UserSettings();

  @state()
  private isActive = false;

  private animationTimeout: number | null = null;

  constructor() {
    super();
    // Add styles to document since we're using light DOM
    const styleEl = document.createElement("style");
    styleEl.textContent = `
      .alert-border {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        border: 17px solid red;
        box-sizing: border-box;
        z-index: 40;
        opacity: 0;
      }

      .alert-border.animate {
        animation: alertBlink ${ALERT_SPEED}s ease-in-out ${ALERT_COUNT};
      }

      @keyframes alertBlink {
        0% { opacity: 0; }
        50% { opacity: 1; }
        100% { opacity: 0; }
      }
    `;
    document.head.appendChild(styleEl);
  }

  createRenderRoot() {
    return this;
  }

  init() {
    // Listen for BrokeAllianceUpdate events directly from game updates
    this.activateAlert();
  }

  tick() {
    if (!this.game) {
      return; // Game not initialized yet
    }

    // Check for BrokeAllianceUpdate events
    const updates = this.game.updatesSinceLastTick();
    if (updates && updates[GameUpdateType.BrokeAlliance]) {
      updates[GameUpdateType.BrokeAlliance].forEach((update) => {
        this.onBrokeAllianceUpdate(update as BrokeAllianceUpdate);
      });
    }
  }

  // The alert frame is not affected by the camera transform
  shouldTransform(): boolean {
    return false;
  }

  private onBrokeAllianceUpdate(update: BrokeAllianceUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const betrayed = this.game.playerBySmallID(update.betrayedID);

    // Only trigger alert if the current player is the betrayed one
    if (betrayed === myPlayer) {
      this.activateAlert();
    }
  }

  private activateAlert() {
    if (this.userSettings.alertFrame()) {
      this.isActive = true;
      this.requestUpdate();
    }
  }

  public dismissAlert() {
    this.isActive = false;
    if (this.animationTimeout) {
      clearTimeout(this.animationTimeout);
      this.animationTimeout = null;
    }
    this.requestUpdate();
  }

  render() {
    if (!this.isActive) {
      return html``;
    }

    return html`
      <div
        class="alert-border animate"
        @animationend=${() => this.dismissAlert()}
      ></div>
    `;
  }
}
