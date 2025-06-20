import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  BrokeAllianceUpdate,
  GameUpdateType,
} from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { Layer } from "./Layer";

/**
 * Ease in out function
 * @param t - The time value
 * @returns The eased value
 */
export function easeInOut(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

@customElement("alert-frame")
export class AlertFrame extends LitElement implements Layer {
  public game: GameView;
  private userSettings: UserSettings = new UserSettings();

  @state()
  private isActive = false;

  @state()
  private opacity = 0;

  private startTimestamp = 0;
  private animTime = 0;
  private animationId: number | null = null;

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
        transition: opacity 0.1s ease-in-out;
      }
    `;
    document.head.appendChild(styleEl);
  }

  createRenderRoot() {
    return this;
  }

  tick() {
    if (!this.game) {
      return; // Game not initialized yet
    }

    if (this.userSettings.alertFrame() && this.startTimestamp > 0) {
      this.animTime = this.animTime + 1;
      this.updateAnimation();
    }

    // Check for BrokeAllianceUpdate events
    const updates = this.game.updatesSinceLastTick();
    if (updates && updates[GameUpdateType.BrokeAlliance]) {
      updates[GameUpdateType.BrokeAlliance].forEach((update) => {
        this.onBrokeAllianceUpdate(update as BrokeAllianceUpdate);
      });
    }
  }

  renderLayer() {
    // No canvas rendering needed for this Lit Element
  }

  shouldTransform(): boolean {
    return false;
  }

  private onBrokeAllianceUpdate(update: BrokeAllianceUpdate) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const betrayed = this.game.playerBySmallID(update.betrayedID);
    const traitor = this.game.playerBySmallID(update.traitorID);

    // Only trigger alert if the current player is the betrayed one
    if (betrayed === myPlayer) {
      this.activateAlert();
    }
  }

  private activateAlert() {
    if (this.userSettings.alertFrame()) {
      this.startTimestamp = Date.now();
      this.opacity = 0;
      this.isActive = true;
      this.animTime = 0;
      this.requestUpdate();
    }
  }

  public dismissAlert() {
    this.isActive = false;
    this.opacity = 0;
    this.startTimestamp = 0;
    this.animTime = 0;
    this.requestUpdate();
  }

  private updateAnimation() {
    const now = Date.now();
    const duration = 10000;

    // Stop the blink loop if the duration has passed and the opacity is 0
    // in order to avoid flickering and keep the border hidden on timeout
    if (this.opacity === 0 && now - this.startTimestamp > duration) {
      this.opacity = 0;
      this.startTimestamp = 0;
      this.animTime = 0;
      this.isActive = false;
      this.requestUpdate();
      return;
    }

    const progress = this.animTime / 8;
    this.opacity = easeInOut(progress);
    this.requestUpdate();
  }

  render() {
    if (!this.isActive) {
      return html``;
    }

    return html`
      <div class="alert-border" style="opacity: ${this.opacity}"></div>
    `;
  }
}
