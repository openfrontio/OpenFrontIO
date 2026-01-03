import { extend } from "colord";
import a11yPlugin from "colord/plugins/a11y";
import { OutlineFilter } from "pixi-filters";
import * as PIXI from "pixi.js";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { wouldNukeBreakAlliance } from "../../../core/execution/Util";
import {
  BuildableUnit,
  Cell,
  PlayerActions,
  PlayerID,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import {
  ContextMenuEvent,
  GhostStructureChangedEvent,
  MouseMoveEvent,
  MouseUpEvent,
  SwapRocketDirectionEvent,
  ToggleStructureEvent as ToggleStructuresEvent,
} from "../../InputHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../../Transport";
import { renderNumber } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { Layer } from "./Layer";
import {
  DOTS_ZOOM_THRESHOLD,
  ICON_SCALE_FACTOR_ZOOMED_IN,
  ICON_SCALE_FACTOR_ZOOMED_OUT,
  ICON_SIZE,
  LEVEL_SCALE_FACTOR,
  OFFSET_ZOOM_Y,
  SpriteFactory,
  STRUCTURE_SHAPES,
  ZOOM_THRESHOLD,
} from "./StructureDrawingUtils";
import bitmapFont from "/fonts/round_6x6_modified.xml?url";

extend([a11yPlugin]);

class StructureRenderInfo {
  public isOnScreen: boolean = false;
  constructor(
    public unit: UnitView,
    public owner: PlayerID,
    public iconContainer: PIXI.Container,
    public levelContainer: PIXI.Container,
    public dotContainer: PIXI.Container,
    public level: number = 0,
    public underConstruction: boolean = true,
  ) {}
}

export class StructureIconsLayer implements Layer {
  private ghostUnit: {
    container: PIXI.Container;
    priceText: PIXI.BitmapText;
    priceBg: PIXI.Graphics;
    priceGroup: PIXI.Container;
    priceBox: { height: number; y: number; paddingX: number; minWidth: number };
    range: PIXI.Container | null;
    rangeLevel?: number;
    targetingAlly?: boolean;
    buildableUnit: BuildableUnit;
  } | null = null;
  private pixicanvas: HTMLCanvasElement;
  private iconsStage: PIXI.Container;
  private ghostStage: PIXI.Container;
  private levelsStage: PIXI.Container;
  private rootStage: PIXI.Container = new PIXI.Container();
  public playerActions: PlayerActions | null = null;
  private dotsStage: PIXI.Container;
  private readonly theme: Theme;
  private renderer: PIXI.Renderer | null = null;
  private rendererInitialized: boolean = false;
  private renders: StructureRenderInfo[] = [];
  private readonly seenUnits: Set<UnitView> = new Set();
  private readonly mousePos = { x: 0, y: 0 };
  private renderSprites = true;
  private factory: SpriteFactory;
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
  private readonly structures: Map<UnitType, { visible: boolean }> = new Map([
    [UnitType.City, { visible: true }],
    [UnitType.Factory, { visible: true }],
    [UnitType.DefensePost, { visible: true }],
    [UnitType.Port, { visible: true }],
    [UnitType.MissileSilo, { visible: true }],
    [UnitType.SAMLauncher, { visible: true }],
  ]);
  private lastGhostQueryAt: number;
  potentialUpgrade: StructureRenderInfo | undefined;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    public uiState: UIState,
    private transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
    this.factory = new SpriteFactory(
      this.theme,
      game,
      transformHandler,
      this.renderSprites,
    );
  }

  async setupRenderer() {
    try {
      await PIXI.Assets.load(bitmapFont);
    } catch (error) {
      console.error("Failed to load bitmap font:", error);
    }
    const renderer = new PIXI.WebGLRenderer();
    this.pixicanvas = document.createElement("canvas");
    this.pixicanvas.width = window.innerWidth;
    this.pixicanvas.height = window.innerHeight;

    this.iconsStage = new PIXI.Container();
    this.iconsStage.position.set(0, 0);
    this.iconsStage.setSize(this.pixicanvas.width, this.pixicanvas.height);

    this.ghostStage = new PIXI.Container();
    this.ghostStage.position.set(0, 0);
    this.ghostStage.setSize(this.pixicanvas.width, this.pixicanvas.height);

    this.levelsStage = new PIXI.Container();
    this.levelsStage.position.set(0, 0);
    this.levelsStage.setSize(this.pixicanvas.width, this.pixicanvas.height);

    this.dotsStage = new PIXI.Container();
    this.dotsStage.position.set(0, 0);
    this.dotsStage.setSize(this.pixicanvas.width, this.pixicanvas.height);

    this.rootStage.addChild(
      this.dotsStage,
      this.iconsStage,
      this.levelsStage,
      this.ghostStage,
    );
    this.rootStage.position.set(0, 0);
    this.rootStage.setSize(this.pixicanvas.width, this.pixicanvas.height);

    await renderer.init({
      canvas: this.pixicanvas,
      resolution: 1,
      width: this.pixicanvas.width,
      height: this.pixicanvas.height,
      antialias: false,
      clearBeforeRender: true,
      backgroundAlpha: 0,
      backgroundColor: 0x00000000,
    });

    this.renderer = renderer;
    this.rendererInitialized = true;
  }

  shouldTransform(): boolean {
    return false;
  }

  async init() {
    this.eventBus.on(ToggleStructuresEvent, (e) =>
      this.toggleStructures(e.structureTypes),
    );
    this.eventBus.on(MouseMoveEvent, (e) => this.moveGhost(e));

    this.eventBus.on(MouseUpEvent, (e) => this.createStructure(e));
    this.eventBus.on(ContextMenuEvent, (e) => this.updateLockedBombTarget(e));

    window.addEventListener("resize", () => this.resizeCanvas());
    await this.setupRenderer();
    this.redraw();
  }

  resizeCanvas() {
    if (this.renderer) {
      this.pixicanvas.width = window.innerWidth;
      this.pixicanvas.height = window.innerHeight;
      this.renderer.resize(innerWidth, innerHeight, 1);
    }
  }

  tick() {
    this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.Unit]?.map((unit) => this.game.unit(unit.id))
      ?.forEach((unitView) => {
        if (unitView === undefined) return;

        if (unitView.isActive()) {
          this.handleActiveUnit(unitView);
        } else if (this.seenUnits.has(unitView)) {
          this.handleInactiveUnit(unitView);
        }
      });
    this.renderSprites =
      this.game.config().userSettings()?.structureSprites() ?? true;
  }

  redraw() {
    this.resizeCanvas();
  }

  renderLayer(mainContext: CanvasRenderingContext2D) {
    if (!this.renderer || !this.rendererInitialized) {
      return;
    }

    if (this.ghostUnit) {
      if (this.uiState.ghostStructure === null) {
        this.removeGhostStructure();
      } else if (
        this.uiState.ghostStructure !== this.ghostUnit.buildableUnit.type
      ) {
        this.clearGhostStructure();
      }
    } else if (this.uiState.ghostStructure !== null) {
      this.createGhostStructure(this.uiState.ghostStructure);
    }
    this.renderGhost();

    if (this.transformHandler.hasChanged()) {
      for (const render of this.renders) {
        this.computeNewLocation(render);
      }
    }
    const scale = this.transformHandler.scale;

    this.dotsStage!.visible = scale <= DOTS_ZOOM_THRESHOLD;
    this.iconsStage!.visible =
      scale > DOTS_ZOOM_THRESHOLD &&
      (scale <= ZOOM_THRESHOLD || !this.renderSprites);
    this.levelsStage!.visible = scale > ZOOM_THRESHOLD && this.renderSprites;
    this.renderer.render(this.rootStage);
    mainContext.drawImage(this.renderer.canvas, 0, 0);
  }

  renderGhost() {
    if (!this.ghostUnit) return;

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
    // Uses shared logic with NukeExecution.maybeBreakAlliances()
    let targetingAlly = false;
    const myPlayer = this.game.myPlayer();
    const nukeType = this.ghostUnit.buildableUnit.type;
    if (
      tileRef &&
      myPlayer &&
      (nukeType === UnitType.AtomBomb || nukeType === UnitType.HydrogenBomb)
    ) {
      // Only check if player has allies
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
        if (this.potentialUpgrade) {
          this.potentialUpgrade.iconContainer.filters = [];
          this.potentialUpgrade.dotContainer.filters = [];
        }
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
          this.potentialUpgrade = this.renders.find(
            (r) =>
              r.unit.id() === unit.canUpgrade &&
              r.unit.owner().id() === this.game.myPlayer()?.id(),
          );
          if (this.potentialUpgrade) {
            this.potentialUpgrade.iconContainer.filters = [
              new OutlineFilter({ thickness: 2, color: "rgba(0, 255, 0, 1)" }),
            ];
            this.potentialUpgrade.dotContainer.filters = [
              new OutlineFilter({ thickness: 2, color: "rgba(0, 255, 0, 1)" }),
            ];
          }
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
    // Ignore left clicks when locked bomb is active (use right-click instead)
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
    // Only allow right-click to change bomb target when locked
    if (
      !this.uiState.lockedGhostTile ||
      !this.isLockableGhost(this.ghostUnit?.buildableUnit.type ?? null)
    ) {
      return;
    }
    const newTile = this.getTileFromContextMenuEvent(e);
    if (newTile) {
      this.uiState.lockedGhostTile = newTile;
      // Force trajectory recalculation
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
    if (this.potentialUpgrade) {
      this.potentialUpgrade.iconContainer.filters = [];
      this.potentialUpgrade.dotContainer.filters = [];
      this.potentialUpgrade = undefined;
    }
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
    // Fixed positioning keeps controls anchored to the viewport even if the page scrolls
    container.style.position = "fixed";
    container.style.display = "flex";
    container.style.gap = "8px";
    container.style.transform = "translate(-50%, 0)";
    container.style.pointerEvents = "auto";
    container.style.zIndex = "5";

    const makeButton = (
      label: string,
      background: string,
      onClick: () => void,
    ): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
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

    const confirm = makeButton("✓", "#2e7d32", () => {
      if (this.uiState.lockedGhostTile) {
        this.emitBuildIntent(this.uiState.lockedGhostTile);
      }
    });

    const flip = makeButton("↕", "#1565c0", () => {
      const next = !this.uiState.rocketDirectionUp;
      this.eventBus.emit(new SwapRocketDirectionEvent(next));
    });

    const cancel = makeButton("✕", "#b71c1c", () =>
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
    // Get the nuke radius and add 1px below it
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

  private toggleStructures(toggleStructureType: UnitType[] | null): void {
    for (const [structureType, infos] of this.structures) {
      infos.visible =
        toggleStructureType?.indexOf(structureType) !== -1 ||
        toggleStructureType === null;
    }
    for (const render of this.renders) {
      this.modifyVisibility(render);
    }
  }

  private findRenderByUnit(
    unitView: UnitView,
  ): StructureRenderInfo | undefined {
    return this.renders.find((render) => render.unit.id() === unitView.id());
  }

  private handleActiveUnit(unitView: UnitView) {
    if (this.seenUnits.has(unitView)) {
      const render = this.findRenderByUnit(unitView);
      if (render) {
        this.checkForConstructionState(render, unitView);
        this.checkForDeletionState(render, unitView);
        this.checkForOwnershipChange(render, unitView);
        this.checkForLevelChange(render, unitView);
      }
    } else if (this.structures.has(unitView.type())) {
      this.addNewStructure(unitView);
    }
  }

  private handleInactiveUnit(unitView: UnitView) {
    const render = this.findRenderByUnit(unitView);
    if (render) {
      this.deleteStructure(render);
    }
  }

  private modifyVisibility(render: StructureRenderInfo) {
    const structureType = render.unit.type();
    const structureInfos = this.structures.get(structureType);

    let focusStructure = false;
    for (const infos of this.structures.values()) {
      if (infos.visible === false) {
        focusStructure = true;
        break;
      }
    }
    if (structureInfos) {
      render.iconContainer.alpha = structureInfos.visible ? 1 : 0.3;
      render.dotContainer.alpha = structureInfos.visible ? 1 : 0.3;
      if (structureInfos.visible && focusStructure) {
        render.iconContainer.filters = [
          new OutlineFilter({ thickness: 2, color: "rgb(255, 255, 255)" }),
        ];
        render.dotContainer.filters = [
          new OutlineFilter({ thickness: 2, color: "rgb(255, 255, 255)" }),
        ];
      } else {
        render.iconContainer.filters = [];
        render.dotContainer.filters = [];
      }
    }
  }

  private checkForDeletionState(render: StructureRenderInfo, unit: UnitView) {
    if (unit.markedForDeletion() !== false) {
      render.iconContainer?.destroy();
      render.dotContainer?.destroy();
      render.iconContainer = this.createIconSprite(unit);
      render.dotContainer = this.createDotSprite(unit);
      this.modifyVisibility(render);
    }
  }

  private checkForConstructionState(
    render: StructureRenderInfo,
    unit: UnitView,
  ) {
    if (render.underConstruction && !unit.isUnderConstruction()) {
      render.underConstruction = false;
      render.iconContainer?.destroy();
      render.dotContainer?.destroy();
      render.iconContainer = this.createIconSprite(unit);
      render.dotContainer = this.createDotSprite(unit);
      this.modifyVisibility(render);
    }
  }

  private checkForOwnershipChange(render: StructureRenderInfo, unit: UnitView) {
    if (render.owner !== unit.owner().id()) {
      render.owner = unit.owner().id();
      render.iconContainer?.destroy();
      render.dotContainer?.destroy();
      render.iconContainer = this.createIconSprite(unit);
      render.dotContainer = this.createDotSprite(unit);
      this.modifyVisibility(render);
    }
  }

  private checkForLevelChange(render: StructureRenderInfo, unit: UnitView) {
    if (render.level !== unit.level()) {
      render.level = unit.level();
      render.iconContainer?.destroy();
      render.levelContainer?.destroy();
      render.dotContainer?.destroy();
      render.iconContainer = this.createIconSprite(unit);
      render.levelContainer = this.createLevelSprite(unit);
      render.dotContainer = this.createDotSprite(unit);
      this.modifyVisibility(render);
    }
  }

  private computeNewLocation(render: StructureRenderInfo) {
    const tile = render.unit.tile();
    const worldPos = new Cell(this.game.x(tile), this.game.y(tile));
    const screenPos = this.transformHandler.worldToScreenCoordinates(worldPos);
    screenPos.x = Math.round(screenPos.x);

    const scale = this.transformHandler.scale;
    screenPos.y = Math.round(
      scale >= ZOOM_THRESHOLD &&
        this.game.config().userSettings()?.structureSprites()
        ? screenPos.y - scale * OFFSET_ZOOM_Y
        : screenPos.y,
    );

    const type = render.unit.type();
    const margin =
      type !== undefined && STRUCTURE_SHAPES[type] !== undefined
        ? ICON_SIZE[STRUCTURE_SHAPES[type]]
        : 28;

    const onScreen =
      screenPos.x + margin > 0 &&
      screenPos.x - margin < this.pixicanvas.width &&
      screenPos.y + margin > 0 &&
      screenPos.y - margin < this.pixicanvas.height;

    if (onScreen) {
      if (scale > ZOOM_THRESHOLD) {
        const target = this.game.config().userSettings()?.structureSprites()
          ? render.levelContainer
          : render.iconContainer;
        target.position.set(screenPos.x, screenPos.y);
        target.scale.set(
          Math.max(
            1,
            scale /
              (target === render.levelContainer
                ? LEVEL_SCALE_FACTOR
                : ICON_SCALE_FACTOR_ZOOMED_IN),
          ),
        );
      } else if (scale > DOTS_ZOOM_THRESHOLD) {
        render.iconContainer.position.set(screenPos.x, screenPos.y);
        render.iconContainer.scale.set(
          Math.min(1, scale / ICON_SCALE_FACTOR_ZOOMED_OUT),
        );
      } else {
        render.dotContainer.position.set(screenPos.x, screenPos.y);
      }
    }

    if (render.isOnScreen !== onScreen) {
      render.isOnScreen = onScreen;
      render.iconContainer.visible = onScreen;
      render.dotContainer.visible = onScreen;
      render.levelContainer.visible = onScreen;
    }
  }

  private addNewStructure(unitView: UnitView) {
    this.seenUnits.add(unitView);
    const render = new StructureRenderInfo(
      unitView,
      unitView.owner().id(),
      this.createIconSprite(unitView),
      this.createLevelSprite(unitView),
      this.createDotSprite(unitView),
      unitView.level(),
      unitView.isUnderConstruction(),
    );
    this.renders.push(render);
    this.computeNewLocation(render);
    this.modifyVisibility(render);
  }

  private createLevelSprite(unit: UnitView): PIXI.Container {
    return this.factory.createUnitContainer(unit, {
      type: "level",
      stage: this.levelsStage,
    });
  }

  private createDotSprite(unit: UnitView): PIXI.Container {
    return this.factory.createUnitContainer(unit, {
      type: "dot",
      stage: this.dotsStage,
    });
  }

  private createIconSprite(unit: UnitView): PIXI.Container {
    return this.factory.createUnitContainer(unit, {
      type: "icon",
      stage: this.iconsStage,
    });
  }

  private deleteStructure(render: StructureRenderInfo) {
    render.iconContainer?.destroy();
    render.levelContainer?.destroy();
    render.dotContainer?.destroy();
    this.renders = this.renders.filter((r) => r.unit !== render.unit);
    this.seenUnits.delete(render.unit);
  }
}
