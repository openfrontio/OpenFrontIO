import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { UserSettings } from "../../../core/game/UserSettings";
import {
  TerritoryWebGLStatusEvent,
  ToggleTerritoryWebGLEvent,
} from "../../InputHandler";
import { Layer } from "./Layer";

@customElement("territory-webgl-status")
export class TerritoryWebGLStatus extends LitElement implements Layer {
  @property({ attribute: false })
  public eventBus!: EventBus;

  @property({ attribute: false })
  public userSettings!: UserSettings;

  @state()
  private enabled = true;

  @state()
  private active = false;

  @state()
  private supported = true;

  @state()
  private lastMessage: string | null = null;

  static styles = css`
    :host {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 9998;
      pointer-events: none;
    }

    .panel {
      background: rgba(15, 23, 42, 0.85);
      color: white;
      border-radius: 8px;
      padding: 10px 14px;
      min-width: 220px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      font-family:
        "Inter",
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
      font-size: 12px;
      pointer-events: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .status-line {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .label {
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.08em;
      opacity: 0.7;
    }

    .value {
      font-weight: 600;
    }

    .status-active {
      color: #4ade80;
    }

    .status-fallback {
      color: #fbbf24;
    }

    .status-disabled {
      color: #f87171;
    }

    .message {
      font-size: 11px;
      line-height: 1.3;
      opacity: 0.85;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
    }

    button {
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: white;
      font-size: 11px;
      border-radius: 4px;
      padding: 4px 10px;
      cursor: pointer;
    }

    button:hover {
      background: #334155;
    }
  `;

  init() {
    this.enabled = this.userSettings?.territoryWebGL() ?? true;
    if (this.eventBus) {
      this.eventBus.on(TerritoryWebGLStatusEvent, (event) => {
        this.enabled = event.enabled;
        this.active = event.active;
        this.supported = event.supported;
        this.lastMessage = event.message ?? null;
        this.requestUpdate();
      });
    }
  }

  shouldTransform(): boolean {
    return false;
  }

  private handleToggle() {
    if (!this.eventBus) return;
    this.eventBus.emit(new ToggleTerritoryWebGLEvent());
  }

  private statusClass(): string {
    if (!this.enabled) return "status-disabled";
    if (this.enabled && this.active) return "status-active";
    if (!this.supported) return "status-disabled";
    return "status-fallback";
  }

  private statusText(): string {
    if (!this.enabled) {
      return "WebGL borders hidden";
    }
    if (!this.supported) {
      return "WebGL unsupported (fallback)";
    }
    if (this.active) {
      return "WebGL borders active";
    }
    return "WebGL enabled (fallback)";
  }

  render() {
    return html`
      <div class="panel">
        <div class="status-line">
          <span class="label">Territory Renderer</span>
          <span class="value ${this.statusClass()}">${this.statusText()}</span>
        </div>
        ${this.lastMessage
          ? html`<div class="message">${this.lastMessage}</div>`
          : html``}
        <div class="actions">
          <button type="button" @click=${this.handleToggle}>
            ${this.enabled ? "Hide WebGL layer" : "Show WebGL layer"}
          </button>
        </div>
      </div>
    `;
  }
}
