import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import { MouseOverEvent } from "../../InputHandler";
import { translateText } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
import { TargetSelectionMode } from "./TargetSelectionMode";

/**
 * While in target-selection mode, renders a small badge that follows the
 * cursor and sets a pointer cursor on document.body.
 */
@customElement("target-selection-layer")
export class TargetSelectionLayer extends LitElement implements Layer {
  @state() private isActive = false;
  @state() private cursorX = 0;
  @state() private cursorY = 0;

  eventBus!: EventBus;
  game!: GameView;
  transformHandler!: TransformHandler;

  private _mouseHandler: ((e: MouseOverEvent) => void) | null = null;

  createRenderRoot() {
    return this;
  }

  init() {}

  tick() {
    const mode = TargetSelectionMode.getInstance();
    const wasActive = this.isActive;
    this.isActive = mode.active;

    if (this.isActive && !wasActive) {
      this._mouseHandler = (e: MouseOverEvent) => {
        this.cursorX = e.x;
        this.cursorY = e.y;
        this.requestUpdate();
      };
      this.eventBus.on(MouseOverEvent, this._mouseHandler);
      document.body.style.cursor = "pointer";
      this.requestUpdate();
    } else if (!this.isActive && wasActive) {
      if (this._mouseHandler) {
        this.eventBus.off(MouseOverEvent, this._mouseHandler);
        this._mouseHandler = null;
      }
      document.body.style.cursor = "";
      this.requestUpdate();
    }
  }

  render() {
    if (!this.isActive) return html``;

    // Offset badge slightly so it doesn't sit under the cursor tip
    const x = this.cursorX + 14;
    const y = this.cursorY - 10;

    return html`
      <div
        style="
          position: fixed;
          left: ${x}px;
          top: ${y}px;
          pointer-events: none;
          z-index: 9999;
          background: rgba(17,24,39,0.85);
          border: 1px solid rgba(99,102,241,0.7);
          border-radius: 6px;
          padding: 3px 9px;
          font-size: 12px;
          color: #fff;
          white-space: nowrap;
          backdrop-filter: blur(4px);
          user-select: none;
        "
      >
        ${translateText("quick_chat.select_target")}
      </div>
    `;
  }
}
