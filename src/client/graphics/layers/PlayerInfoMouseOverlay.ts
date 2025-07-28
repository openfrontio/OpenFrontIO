import { TemplateResult, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { PlayerView } from "../../../core/game/GameView";
import { MouseMoveEvent } from "../../InputHandler";
import { BasePlayerInfoOverlay, OVERLAY_CONFIG } from "./BasePlayerInfoOverlay";

@customElement("mouse-hud")
export class PlayerInfoMouseOverlay extends BasePlayerInfoOverlay {
  @state()
  private mouseX = 0;

  @state()
  private mouseY = 0;

  @state()
  private isDragging = false;

  protected setupEventListeners() {
    const canvas = document.querySelector("canvas");
    if (canvas) {
      canvas.addEventListener("mousedown", () => (this.isDragging = true));
      canvas.addEventListener("mouseup", () => (this.isDragging = false));
      canvas.addEventListener("mouseleave", () => (this.isDragging = false));
    }
  }

  protected onMouseMove(event: MouseMoveEvent) {
    this.mouseX = event.x;
    this.mouseY = event.y;

    const now = Date.now();
    if (now - this.lastUpdate < OVERLAY_CONFIG.updateThrottleMs) {
      return;
    }
    this.lastUpdate = now;

    this.updateHoverInfo(event.x, event.y);
  }

  protected shouldRender(): boolean {
    return (
      this._isActive &&
      this.userSettings?.showPlayerInfoMouseOverlay() &&
      this.isVisible &&
      !this.isDragging
    );
  }

  private getHUDPosition(): { x: number; y: number } {
    const hudElement = this.shadowRoot?.querySelector(
      ".mouse-hud",
    ) as HTMLElement;
    if (!hudElement) return { x: this.mouseX, y: this.mouseY };

    const w = hudElement.offsetWidth || OVERLAY_CONFIG.defaultWidth;
    const h = hudElement.offsetHeight || OVERLAY_CONFIG.defaultHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = this.mouseX - w / 2;
    let y = this.mouseY + OVERLAY_CONFIG.mouseOffset;

    if (x < 0) x = OVERLAY_CONFIG.margin;
    if (x + w > vw) x = vw - w - OVERLAY_CONFIG.margin;
    if (y + h > vh) y = this.mouseY - h - OVERLAY_CONFIG.margin;

    return { x, y };
  }

  private renderPlayerInfo(player: PlayerView): TemplateResult {
    const { row1, row2 } = this.formatStats(player);
    const displayName = this.getShortDisplayName(player);
    const relation = this.getRelation(player);
    const relationClass = this.getRelationClass(relation);

    if (row1.length === 0 && row2.length === 0) {
      return html`
        <div class="p-2">
          <div class="font-bold mb-1 ${relationClass}">${displayName}</div>
        </div>
      `;
    }

    return html`
      <div class="p-2">
        <div class="font-bold mb-1 text-center ${relationClass}">
          ${displayName}
        </div>
        <div class="mt-1">
          ${row1.length > 0
            ? html`<div class="text-sm opacity-80">${row1.join(" ")}</div>`
            : ""}
          ${row2.length > 0
            ? html`<div class="text-sm opacity-80">${row2.join(" ")}</div>`
            : ""}
        </div>
      </div>
    `;
  }

  render() {
    if (!this.shouldRender()) {
      return html``;
    }

    const position = this.getHUDPosition();
    const opacity = this.isDragging ? "0" : "1";

    return html`
      <div
        class="mouse-hud fixed pointer-events-none z-50 px-3 py-2 bg-gray-800/70 backdrop-blur-sm shadow-lg rounded-lg text-white max-w-[90%] whitespace-nowrap transition-opacity duration-200"
        style="left: ${position.x}px; top: ${position.y}px; opacity: ${opacity};"
      >
        ${this.player ? this.renderPlayerInfo(this.player) : ""}
        ${this.unit ? this.renderUnitInfo(this.unit) : ""}
      </div>
    `;
  }
}
