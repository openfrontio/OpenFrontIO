import { OutlineFilter } from "pixi-filters";
import { BitmapText, Container, Graphics } from "pixi.js";
import { EventBus } from "../../../core/EventBus";
import { wouldNukeBreakAlliance } from "../../../core/execution/Util";
import {
  BuildableUnit,
  Cell,
  PlayerActions,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../../core/game/GameView";
import {
  ContextMenuEvent,
  GhostStructureChangedEvent,
  MouseMoveEvent,
  MouseUpEvent,
  SwapRocketDirectionEvent,
} from "../../InputHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../../Transport";
import { renderNumber } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import {
  ICON_SCALE_FACTOR_ZOOMED_IN,
  ICON_SCALE_FACTOR_ZOOMED_OUT,
  SpriteFactory,
  ZOOM_THRESHOLD,
} from "./StructureDrawingUtils";

export interface GhostUnit {
  container: Container;
  priceText: BitmapText;
  priceBg: Graphics;
  priceGroup: Container;
  priceBox: { height: number; y: number; paddingX: number; minWidth: number };
  range: Container | null;
  rangeLevel?: number;
  targetingAlly?: boolean;
  buildableUnit: BuildableUnit;
}

export class GhostStructureManager {
  private ghostUnit: GhostUnit | null = null;
  private ghostControls: {
    container: HTMLDivElement;
    confirm: HTMLButtonElement;
    cancel: HTMLButtonElement;
    flip: HTMLButtonElement;
  } | null = null;
  private ghostControlsStyle: {
    left: number;
    top: number;
    scale: number;
  } | null = null;
  private lastGhostQueryAt: number = 0;
  private readonly mousePos = { x: 0, y: 0 };
  private onHighlightUpgrade: (unitId: number | null) => void;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private uiState: UIState,
    private transformHandler: TransformHandler,
    private ghostStage: Container,
    private factory: SpriteFactory,
    onHighlightUpgrade: (unitId: number | null) => void,
  ) {
    this.onHighlightUpgrade = onHighlightUpgrade;
  }

  init() {
    this.eventBus.on(MouseMoveEvent, (e) => this.moveGhost(e));
    this.eventBus.on(MouseUpEvent, (e) => this.createStructure(e));
    this.eventBus.on(ContextMenuEvent, (e) => this.updateLockedBombTarget(e));
  }

  destroy() {
    this.removeGhostStructure();
  }

  renderGhost(rendererCanvas: HTMLCanvasElement) {
    if (!this.ghostUnit) {
      if (this.uiState.ghostStructure !== null) {
        this.createGhostStructure(this.uiState.ghostStructure);
      }
      return;
    }

    if (this.uiState.ghostStructure === null) {
      this.removeGhostStructure();
      return;
    } else if (
      this.uiState.ghostStructure !== this.ghostUnit.buildableUnit.type
    ) {
      this.clearGhostStructure();
      // It will be recreated next frame or we can recreate now
      this.createGhostStructure(this.uiState.ghostStructure);
    }

    const rect = this.transformHandler.boundingRect();
    if (!rect) return;

    let localX = this.mousePos.x - rect.left;
    let localY = this.mousePos.y - rect.top;
    let tileRef: TileRef | undefined;

    // Always reposition locked ghost every frame (smooth when panning)
    if (
      this.uiState.lockedGhostTile &&
      this.isLockableGhost(this.ghostUnit.buildableUnit.type)
    ) {
      tileRef = this.uiState.lockedGhostTile;
      const screen = this.transformHandler.worldToScreenCoordinates(
        new Cell(this.game.x(tileRef), this.game.y(tileRef)),
      );
      localX = screen.x - rect.left;
      localY = screen.y - rect.top;
      this.ghostUnit.container.position.set(localX, localY);
      this.ghostUnit.range?.position.set(localX, localY);
      this.updateGhostControls(localX, localY, rect);
    } else {
      this.destroyGhostControls();
      const tile = this.transformHandler.screenToWorldCoordinates(
        localX,
        localY,
      );
      if (this.game.isValidCoord(tile.x, tile.y)) {
        tileRef = this.game.ref(tile.x, tile.y);
      }
    }

    // Throttle expensive tile action queries
    const now = performance.now();
    if (now - this.lastGhostQueryAt < 50) {
      return;
    }
    this.lastGhostQueryAt = now;

    // Check if targeting an ally (for nuke warning visual)
    let targetingAlly = false;
    const myPlayer = this.game.myPlayer();
    const nukeType = this.ghostUnit.buildableUnit.type;
    if (
      tileRef &&
      myPlayer &&
      (nukeType === UnitType.AtomBomb || nukeType === UnitType.HydrogenBomb)
    ) {
      const allies = myPlayer.allies();
      if (allies.length > 0) {
        targetingAlly = wouldNukeBreakAlliance({
          gm: this.game,
          targetTile: tileRef,
          magnitude: this.game.config().nukeMagnitudes(nukeType),
          allySmallIds: new Set(allies.map((a) => a.smallID())),
          threshold: this.game.config().nukeAllianceBreakThreshold(),
        });
      }
    }

    this.game
      ?.myPlayer()
      ?.actions(tileRef)
      .then((actions) => {
        // Clear previous highlights/filters
        this.onHighlightUpgrade(null);
        if (this.ghostUnit?.container) {
          this.ghostUnit.container.filters = [];
        }

        if (!this.ghostUnit) return;

        const unit = actions.buildableUnits.find(
          (u) => u.type === this.ghostUnit!.buildableUnit.type,
        );
        const showPrice = this.game.config().userSettings().cursorCostLabel();
        if (!unit) {
          Object.assign(this.ghostUnit.buildableUnit, {
            canBuild: false,
            canUpgrade: false,
          });
          this.updateGhostPrice(0, showPrice);
          this.ghostUnit.container.filters = [
            new OutlineFilter({ thickness: 2, color: "rgba(255, 0, 0, 1)" }),
          ];
          return;
        }

        this.ghostUnit.buildableUnit = unit;
        this.updateGhostPrice(unit.cost ?? 0, showPrice);

        const targetLevel = this.resolveGhostRangeLevel(unit);
        this.updateGhostRange(targetLevel, targetingAlly);

        if (unit.canUpgrade) {
          this.onHighlightUpgrade(unit.canUpgrade);
        } else if (unit.canBuild === false) {
          this.ghostUnit.container.filters = [
            new OutlineFilter({ thickness: 2, color: "rgba(255, 0, 0, 1)" }),
          ];
        }

        const scale = this.transformHandler.scale;
        const s =
          scale >= ZOOM_THRESHOLD
            ? Math.max(1, scale / ICON_SCALE_FACTOR_ZOOMED_IN)
            : Math.min(1, scale / ICON_SCALE_FACTOR_ZOOMED_OUT);
        this.ghostUnit.container.scale.set(s);
        this.ghostUnit.range?.scale.set(this.transformHandler.scale);
      });
  }

  private updateGhostPrice(cost: bigint | number, showPrice: boolean) {
    if (!this.ghostUnit) return;
    const { priceText, priceBg, priceBox, priceGroup } = this.ghostUnit;
    priceGroup.visible = showPrice;
    if (!showPrice) return;

    priceText.text = renderNumber(cost);
    priceText.position.set(0, priceBox.y);

    const textWidth = priceText.width;
    const boxWidth = Math.max(
      priceBox.minWidth,
      textWidth + priceBox.paddingX * 2,
    );

    priceBg.clear();
    priceBg
      .roundRect(
        -boxWidth / 2,
        priceBox.y - priceBox.height / 2,
        boxWidth,
        priceBox.height,
        4,
      )
      .fill({ color: 0x000000, alpha: 0.65 });
  }

  private createStructure(e: MouseUpEvent) {
    if (
      this.uiState.lockedGhostTile &&
      this.isLockableGhost(this.ghostUnit?.buildableUnit.type ?? null)
    ) {
      return;
    }

    if (!this.ghostUnit) return;
    if (this.isGhostBuildBlocked()) {
      this.removeGhostStructure();
      return;
    }
    const tileRef = this.resolveTargetTileFromEvent(e);
    if (!tileRef) {
      this.removeGhostStructure();
      return;
    }
    this.commitStructure(tileRef);
  }

  private updateLockedBombTarget(e: ContextMenuEvent) {
    if (
      !this.uiState.lockedGhostTile ||
      !this.isLockableGhost(this.ghostUnit?.buildableUnit.type ?? null)
    ) {
      return;
    }
    const newTile = this.getTileFromContextMenuEvent(e);
    if (newTile) {
      this.uiState.lockedGhostTile = newTile;
      this.eventBus.emit(
        new GhostStructureChangedEvent(this.uiState.ghostStructure),
      );
    }
  }

  private moveGhost(e: MouseMoveEvent) {
    if (
      this.uiState.lockedGhostTile &&
      this.isLockableGhost(this.ghostUnit?.buildableUnit.type ?? null)
    ) {
      return;
    }
    this.mousePos.x = e.x;
    this.mousePos.y = e.y;

    if (!this.ghostUnit) return;
    const rect = this.transformHandler.boundingRect();
    if (!rect) return;

    const localX = e.x - rect.left;
    const localY = e.y - rect.top;
    this.ghostUnit.container.position.set(localX, localY);
    this.ghostUnit.range?.position.set(localX, localY);
  }

  private createGhostStructure(type: UnitType | null) {
    const player = this.game.myPlayer();
    if (!player) return;
    if (type === null) {
      return;
    }
    if (!this.isLockableGhost(type)) {
      this.uiState.lockedGhostTile = null;
    }
    const rect = this.transformHandler.boundingRect();
    let localX = this.mousePos.x - rect.left;
    let localY = this.mousePos.y - rect.top;
    if (this.uiState.lockedGhostTile && this.isLockableGhost(type)) {
      const screen = this.transformHandler.worldToScreenCoordinates(
        new Cell(
          this.game.x(this.uiState.lockedGhostTile),
          this.game.y(this.uiState.lockedGhostTile),
        ),
      );
      localX = screen.x - rect.left;
      localY = screen.y - rect.top;
    }
    const ghost = this.factory.createGhostContainer(
      player,
      this.ghostStage,
      { x: localX, y: localY },
      type,
    );
    this.ghostUnit = {
      container: ghost.container,
      priceText: ghost.priceText,
      priceBg: ghost.priceBg,
      priceGroup: ghost.priceGroup,
      priceBox: ghost.priceBox,
      range: null,
      buildableUnit: { type, canBuild: false, canUpgrade: false, cost: 0n },
    };
    const showPrice = this.game.config().userSettings().cursorCostLabel();
    this.updateGhostPrice(0, showPrice);
    const baseLevel = this.resolveGhostRangeLevel(this.ghostUnit.buildableUnit);
    this.updateGhostRange(baseLevel);
  }

  private clearGhostStructure() {
    if (this.ghostUnit) {
      this.ghostUnit.container.destroy();
      this.ghostUnit.range?.destroy();
      this.ghostUnit = null;
    }
    this.destroyGhostControls();
    this.onHighlightUpgrade(null);
  }

  private removeGhostStructure() {
    this.clearGhostStructure();
    this.uiState.ghostStructure = null;
    this.uiState.lockedGhostTile = null;
    this.eventBus.emit(new GhostStructureChangedEvent(null));
  }

  private emitBuildIntent(tileRef: TileRef) {
    if (!this.ghostUnit) return;
    if (this.ghostUnit.buildableUnit.canUpgrade !== false) {
      this.eventBus.emit(
        new SendUpgradeStructureIntentEvent(
          this.ghostUnit.buildableUnit.canUpgrade,
          this.ghostUnit.buildableUnit.type,
        ),
      );
    } else if (this.ghostUnit.buildableUnit.canBuild) {
      const unitType = this.ghostUnit.buildableUnit.type;
      const rocketDirectionUp =
        unitType === UnitType.AtomBomb || unitType === UnitType.HydrogenBomb
          ? this.uiState.rocketDirectionUp
          : undefined;
      this.eventBus.emit(
        new BuildUnitIntentEvent(unitType, tileRef, rocketDirectionUp),
      );
    }
  }

  private commitStructure(tileRef: TileRef) {
    this.emitBuildIntent(tileRef);
    this.removeGhostStructure();
  }

  private getTileFromScreenCoords(x: number, y: number): TileRef | null {
    const rect = this.transformHandler.boundingRect();
    if (!rect) return null;
    const localX = x - rect.left;
    const localY = y - rect.top;
    const tile = this.transformHandler.screenToWorldCoordinates(localX, localY);
    if (!this.game.isValidCoord(tile.x, tile.y)) return null;
    return this.game.ref(tile.x, tile.y);
  }

  private getTileFromContextMenuEvent(e: ContextMenuEvent): TileRef | null {
    return this.getTileFromScreenCoords(e.x, e.y);
  }

  private getTileFromMouseEvent(e: MouseUpEvent): TileRef | null {
    return this.getTileFromScreenCoords(e.x, e.y);
  }

  private resolveTargetTileFromEvent(e: MouseUpEvent): TileRef | null {
    if (
      this.uiState.lockedGhostTile &&
      this.isLockableGhost(this.ghostUnit?.buildableUnit.type ?? null)
    ) {
      return this.uiState.lockedGhostTile;
    }
    return this.getTileFromMouseEvent(e);
  }

  private isGhostBuildBlocked(): boolean {
    return (
      !this.ghostUnit ||
      (this.ghostUnit.buildableUnit.canBuild === false &&
        this.ghostUnit.buildableUnit.canUpgrade === false)
    );
  }

  private isLockableGhost(type: UnitType | null): boolean {
    return type === UnitType.AtomBomb || type === UnitType.HydrogenBomb;
  }

  private ensureGhostControls() {
    if (this.ghostControls) return;

    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.display = "flex";
    container.style.gap = "8px";
    container.style.transform = "translate(-50%, 0)";
    container.style.pointerEvents = "auto";
    container.style.zIndex = "5";

    const makeButton = (
      label: string,
      background: string,
      ariaLabel: string,
      onClick: () => void,
    ): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-label", ariaLabel);
      button.style.minHeight = "48px";
      button.style.minWidth = "48px";
      button.style.height = "48px";
      button.style.width = "48px";
      button.style.padding = "0";
      button.style.display = "flex";
      button.style.alignItems = "center";
      button.style.justifyContent = "center";
      button.style.borderRadius = "6px";
      button.style.border = "none";
      button.style.fontWeight = "700";
      button.style.fontSize = "26px";
      button.style.lineHeight = "1";
      button.style.color = "#ffffff";
      button.style.background = background;
      button.style.cursor = "pointer";
      button.style.boxShadow = "0 2px 6px rgba(0,0,0,0.25)";
      button.style.whiteSpace = "nowrap";
      button.addEventListener("click", onClick);
      return button;
    };

    const confirm = makeButton("✓", "#2e7d32", "Confirm bomb placement", () => {
      if (this.uiState.lockedGhostTile) {
        this.emitBuildIntent(this.uiState.lockedGhostTile);
      }
    });

    const flip = makeButton("↕", "#1565c0", "Flip rocket direction", () => {
      const next = !this.uiState.rocketDirectionUp;
      this.eventBus.emit(new SwapRocketDirectionEvent(next));
    });

    const cancel = makeButton("✕", "#b71c1c", "Cancel bomb placement", () =>
      this.removeGhostStructure(),
    );

    container.append(confirm, flip, cancel);
    document.body.appendChild(container);

    this.ghostControls = { container, confirm, cancel, flip };
  }

  private destroyGhostControls() {
    if (!this.ghostControls) return;
    this.ghostControls.container.remove();
    this.ghostControls = null;
    this.ghostControlsStyle = null;
  }

  private updateGhostControls(localX: number, localY: number, rect: DOMRect) {
    if (
      !this.ghostUnit ||
      !this.uiState.lockedGhostTile ||
      !this.isLockableGhost(this.ghostUnit.buildableUnit.type)
    ) {
      this.destroyGhostControls();
      return;
    }
    this.ensureGhostControls();
    const nukeType = this.ghostUnit.buildableUnit.type;
    const magnitude =
      nukeType === UnitType.AtomBomb
        ? this.game.config().nukeMagnitudes(UnitType.AtomBomb).outer
        : this.game.config().nukeMagnitudes(UnitType.HydrogenBomb).outer;
    const radiusPixels = magnitude * this.transformHandler.scale;
    const offsetY = radiusPixels + 1;
    const scale = Math.max(
      0.75,
      Math.min(1.4, this.transformHandler.scale / 2),
    );
    const left = rect.left + localX;
    const top = rect.top + localY + offsetY;

    const cached = this.ghostControlsStyle;
    if (
      !cached ||
      cached.left !== left ||
      cached.top !== top ||
      cached.scale !== scale
    ) {
      this.ghostControls!.container.style.left = `${left}px`;
      this.ghostControls!.container.style.top = `${top}px`;
      this.ghostControls!.container.style.transform = `translate(-50%, 0) scale(${scale})`;
      this.ghostControlsStyle = { left, top, scale };
    }
  }

  private resolveGhostRangeLevel(
    buildableUnit: BuildableUnit,
  ): number | undefined {
    if (buildableUnit.type !== UnitType.SAMLauncher) {
      return undefined;
    }
    if (buildableUnit.canUpgrade !== false) {
      const existing = this.game.unit(buildableUnit.canUpgrade);
      if (existing) {
        return existing.level() + 1;
      } else {
        console.error("Failed to find existing SAMLauncher for upgrade");
      }
    }

    return 1;
  }

  private updateGhostRange(level?: number, targetingAlly: boolean = false) {
    if (!this.ghostUnit) {
      return;
    }

    if (
      this.ghostUnit.range &&
      this.ghostUnit.rangeLevel === level &&
      this.ghostUnit.targetingAlly === targetingAlly
    ) {
      return;
    }

    this.ghostUnit.range?.destroy();
    this.ghostUnit.range = null;
    this.ghostUnit.rangeLevel = level;
    this.ghostUnit.targetingAlly = targetingAlly;

    const position = this.ghostUnit.container.position;
    const range = this.factory.createRange(
      this.ghostUnit.buildableUnit.type,
      this.ghostStage,
      { x: position.x, y: position.y },
      level,
      targetingAlly,
    );
    if (range) {
      this.ghostUnit.range = range;
    }
  }
}
