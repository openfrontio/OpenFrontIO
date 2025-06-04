import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { UnitType } from "../../../core/game/Game";
import { GameView, UnitView } from "../../../core/game/GameView";
import { Layer } from "./Layer";
import { StructureLayer } from "./StructureLayer";

@customElement("unit-info-modal")
export class UnitInfoModal extends LitElement implements Layer {
  @property({ type: Boolean }) open = false;
  @property({ type: Number }) x = 0;
  @property({ type: Number }) y = 0;
  @property({ type: Object }) unit: UnitView | null = null;

  public game: GameView;
  public structureLayer: StructureLayer | null = null;

  constructor() {
    super();
  }

  init() {}

  tick() {
    if (this.unit) {
      this.requestUpdate();
    }
  }

  public onOpenStructureModal = ({
    unit,
    x,
    y,
    tileX,
    tileY,
  }: {
    unit: UnitView;
    x: number;
    y: number;
    tileX: number;
    tileY: number;
  }) => {
    if (!this.game) return;
    this.x = x;
    this.y = y;
    const targetRef = this.game.ref(tileX, tileY);

    const allUnitTypes = Object.values(UnitType);
    const matchingUnits = this.game
      .nearbyUnits(targetRef, 10, allUnitTypes)
      .filter(({ unit }) => unit.isActive());

    if (matchingUnits.length > 0) {
      matchingUnits.sort((a, b) => a.distSquared - b.distSquared);
      this.unit = matchingUnits[0].unit;
    } else {
      this.unit = null;
    }
    this.open = this.unit !== null;
  };

  public onCloseStructureModal = () => {
    this.open = false;
    this.unit = null;
  };

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
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
      position: relative;
    }

    .modal strong {
      color: #e0e0e0;
    }

    .close-button {
      background: #d00;
      color: #fff;
      border: none;
      border-radius: 4px;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      padding: 6px 12px;
    }

    .close-button:hover {
      background: #a00;
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
        <div style="margin-top: 14px; display: flex; justify-content: center;">
          <button
            @click=${() => {
              this.onCloseStructureModal();
              if (this.structureLayer) {
                this.structureLayer.unSelectStructureUnit();
              }
            }}
            class="close-button"
            title="Close"
            style="width: 100px; height: 32px;"
          >
            CLOSE
          </button>
        </div>
      </div>
    `;
  }
}
