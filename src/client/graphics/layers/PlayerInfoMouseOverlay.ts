import { html, LitElement, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { ForcePlayerInfoMouseOverlayEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
import { PlayerInfoManager } from "./PlayerInfoManager";
import { HoverInfo, OVERLAY_CONFIG } from "./PlayerInfoService";

@customElement("mouse-hud")
export class PlayerInfoMouseOverlay extends LitElement implements Layer {
  @property({ type: Object })
  public game!: GameView;

  @property({ type: Object })
  public eventBus!: EventBus;

  @property({ type: Object })
  public transform!: TransformHandler;

  @property({ type: Object })
  public userSettings!: UserSettings;

  @state()
  private mouseX = 0;

  @state()
  private mouseY = 0;

  @state()
  private isDragging = false;

  @state()
  private player: PlayerView | null = null;

  @state()
  private unit: UnitView | null = null;

  @state()
  private hasInfo = false;

  @state()
  private forcePlayerInfoMouseOverlay = false;

  private playerInfoManager!: PlayerInfoManager;
  private _isActive = false;
  private canvas: HTMLCanvasElement | null = null;
  private handleMouseDown = () => (this.isDragging = true);
  private handleMouseUp = () => (this.isDragging = false);
  private handleMouseLeave = () => (this.isDragging = false);
  private hoverCallback = (hoverInfo: HoverInfo) =>
    this.onHoverInfoUpdate(hoverInfo);
  private mouseCallback = (x: number, y: number) =>
    this.onMousePositionUpdate(x, y);
  private forceOverlayEventHandler = (
    event: ForcePlayerInfoMouseOverlayEvent,
  ) => this.onForcePlayerInfoMouseOverlayEvent(event);

  init() {
    if (this._isActive) return;

    this.playerInfoManager = PlayerInfoManager.getInstance(
      this.game,
      this.transform,
      this.eventBus,
    );

    this.playerInfoManager.init();
    this.playerInfoManager.subscribeToData(this.hoverCallback);
    this.playerInfoManager.subscribeToMouse(this.mouseCallback);
    this.setupEventListeners();
    this._isActive = true;
  }

  destroy() {
    this.playerInfoManager?.unsubscribeFromData(this.hoverCallback);
    this.playerInfoManager?.unsubscribeFromMouse(this.mouseCallback);
    this.eventBus.off(
      ForcePlayerInfoMouseOverlayEvent,
      this.forceOverlayEventHandler,
    );
    this.removeCanvasEventListeners();
    this._isActive = false;
  }

  private onMousePositionUpdate(x: number, y: number) {
    this.mouseX = x;
    this.mouseY = y;
    this.requestUpdate();
  }

  private onHoverInfoUpdate(hoverInfo: HoverInfo) {
    this.player = hoverInfo.player;
    this.unit = hoverInfo.unit;
    this.hasInfo = !!(this.player ?? this.unit);
    this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    this.setupCanvasEventListeners();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeCanvasEventListeners();
    if (this.eventBus) {
      this.eventBus.off(
        ForcePlayerInfoMouseOverlayEvent,
        this.forceOverlayEventHandler,
      );
    }
  }

  protected setupEventListeners() {
    this.eventBus.on(
      ForcePlayerInfoMouseOverlayEvent,
      this.forceOverlayEventHandler,
    );
  }

  private setupCanvasEventListeners() {
    this.canvas = document.querySelector("canvas");
    if (this.canvas) {
      this.canvas.addEventListener("mousedown", this.handleMouseDown);
      this.canvas.addEventListener("mouseup", this.handleMouseUp);
      this.canvas.addEventListener("mouseleave", this.handleMouseLeave);
    }
  }

  private removeCanvasEventListeners() {
    if (this.canvas) {
      this.canvas.removeEventListener("mousedown", this.handleMouseDown);
      this.canvas.removeEventListener("mouseup", this.handleMouseUp);
      this.canvas.removeEventListener("mouseleave", this.handleMouseLeave);
      this.canvas = null;
    }
  }

  protected shouldRender(): boolean {
    return (
      this._isActive &&
      (this.userSettings?.showPlayerInfoMouseOverlay() ||
        this.forcePlayerInfoMouseOverlay) &&
      this.hasInfo &&
      !this.isDragging
    );
  }

  private getHudElement(): HTMLElement | null {
    return this.querySelector(".mouse-hud") as HTMLElement;
  }

  private getHUDPosition(): { x: number; y: number } {
    const hudElement = this.getHudElement();
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
    if (y < OVERLAY_CONFIG.margin) y = OVERLAY_CONFIG.margin;

    return { x, y };
  }

  private renderPlayerInfo(player: PlayerView): TemplateResult {
    const playerInfoService = this.playerInfoManager.getPlayerInfoService();
    const { row1, row2 } = playerInfoService.formatStats(player);
    const displayName = playerInfoService.getShortDisplayName(player);
    const relation = playerInfoService.getRelation(player);
    const relationClass = playerInfoService.getRelationClass(relation);

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

  private onForcePlayerInfoMouseOverlayEvent(
    event: ForcePlayerInfoMouseOverlayEvent,
  ) {
    this.forcePlayerInfoMouseOverlay = event.forcePlayerInfoMouseOverlay;

    this.requestUpdate();
  }

  private renderUnitInfo(unit: UnitView): TemplateResult {
    const playerInfoService = this.playerInfoManager.getPlayerInfoService();
    const relation = playerInfoService.getRelation(unit.owner());
    const relationClass = playerInfoService.getRelationClass(relation);

    return html`
      <div class="p-2">
        <div class="font-bold mb-1 ${relationClass}">
          ${playerInfoService.getShortDisplayName(unit.owner())}
        </div>
        <div class="mt-1">
          <div class="text-sm opacity-80">${unit.type()}</div>
          ${unit.hasHealth()
            ? html`
                <div class="text-sm opacity-80">Health: ${unit.health()}</div>
              `
            : ""}
        </div>
      </div>
    `;
  }

  tick() {
    this.requestUpdate();
  }

  renderLayer(context: CanvasRenderingContext2D) {}

  shouldTransform(): boolean {
    return false;
  }

  createRenderRoot() {
    return this;
  }

  render() {
    if (!this.shouldRender()) {
      return html``;
    }

    const position = this.getHUDPosition();
    const opacity =
      this.isDragging || this.getHudElement() === null ? "0" : "1";

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
