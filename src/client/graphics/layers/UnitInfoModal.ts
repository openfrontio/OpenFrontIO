import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { GameView, UnitView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

@customElement("unit-info-modal")
export class UnitInfoModal extends LitElement implements Layer {
  @property({ type: Boolean }) open = false;
  @property({ type: Number }) x = 0;
  @property({ type: Number }) y = 0;
  @property({ type: Object }) unit: UnitView | null = null;

  public game: GameView;

  constructor() {
    super();
  }

  init() {}

  tick() {
    if (this.unit) {
      this.requestUpdate();
    }
  }

  private onOpenStructureModal = (event: Event) => {
    if (!this.game) return;
    const customEvent = event as CustomEvent<{
      x: number;
      y: number;
      unit: UnitView;
      tileX: number;
      tileY: number;
    }>;
    const { x, y, tileX, tileY } = customEvent.detail;
    this.x = x;
    this.y = y;
    const targetRef = this.game.ref(tileX, tileY);

    let closest: UnitView | null = null;
    let minDistance = Infinity;

    for (const unit of this.game.units()) {
      if (!unit.isActive()) continue;

      const unitRef = unit.tile();
      const distance = this.game.manhattanDist(unitRef, targetRef);

      if (distance <= 10 && distance < minDistance) {
        minDistance = distance;
        closest = unit;
      }
    }

    this.unit = closest;
    this.open = this.unit !== null;
  };

  private onDocumentClick = (event: MouseEvent) => {
    const path = event.composedPath();
    if (!path.includes(this)) {
      this.open = false;
      this.unit = null;
      window.dispatchEvent(new CustomEvent("structure-modal-closed"));
    }
  };

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("open-structure-modal", this.onOpenStructureModal);
    document.addEventListener("mousedown", this.onDocumentClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(
      "open-structure-modal",
      this.onOpenStructureModal,
    );
    document.removeEventListener("mousedown", this.onDocumentClick);
  }

  static styles = css`
    :host {
      position: fixed;
      pointer-events: none;
      z-index: 1000;
    }

    .modal {
      pointer-events: auto;
      background: rgba(30, 30, 30, 0.95);
      color: #f8f8f8;
      border: 1px solid #555;
      padding: 12px 18px;
      border-radius: 8px;
      min-width: 220px;
      max-width: 300px;
      box-shadow: 0 6px 12px rgba(0, 0, 0, 0.5);
      font-family: "Segoe UI", sans-serif;
      font-size: 15px;
      line-height: 1.6;
      backdrop-filter: blur(6px);
    }

    .modal strong {
      color: #e0e0e0;
    }
  `;

  render() {
    if (!this.unit) return null;

    const cooldown = this.unit.ticksLeftInCooldown() ?? 0;
    const secondsLeft = Math.ceil(cooldown / 10);

    return html`
      <div
        class="modal"
        style="display: ${this.open ? "block" : "none"}; left: ${this
          .x}px; top: ${this.y}px; position: absolute;"
      >
        <div style="margin-bottom: 8px; font-size: 16px; font-weight: bold;">
          Structure Info
        </div>
        <div style="margin-bottom: 4px;">
          <strong>Type:</strong> ${this.unit.type?.() ?? "Unknown"}
        </div>
        ${secondsLeft > 0
          ? html`<div style="margin-bottom: 4px;">
              <strong>Cooldown:</strong> ${secondsLeft}s
            </div>`
          : ""}
      </div>
    `;
  }
}
