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
  PlayerID,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import {
  GhostStructureChangedEvent,
  MouseMoveEvent,
  MouseUpEvent,
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
  private dotsStage: PIXI.Container;
  private readonly theme: Theme;
  private renderer: PIXI.Renderer | null = null;
  private rendererInitialized: boolean = false;
  private readonly rendersByUnitId: Map<number, StructureRenderInfo> =
    new Map();
  private readonly seenUnitIds: Set<number> = new Set();
  private readonly connectedAllySmallIds: Set<number> = new Set();
  private readonly mousePos = { x: 0, y: 0 };
  private renderSprites = true;
  private factory: SpriteFactory;
  private readonly structures: Map<UnitType, { visible: boolean }> = new Map([
    [UnitType.City, { visible: true }],
    [UnitType.Factory, { visible: true }],
    [UnitType.DefensePost, { visible: true }],
    [UnitType.Port, { visible: true }],
    [UnitType.MissileSilo, { visible: true }],
    [UnitType.SAMLauncher, { visible: true }],
  ]);
  private lastGhostQueryAt: number;
  private visibilityStateDirty = true;
  private hasHiddenStructure = false;
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
    const unitUpdates = this.game.updatesSinceLastTick()?.[GameUpdateType.Unit];
    if (unitUpdates) {
      for (let i = 0; i < unitUpdates.length; i++) {
        const unitView = this.game.unit(unitUpdates[i].id);
        if (unitView === undefined) {
          continue;
        }

        const unitId = unitView.id();
        if (unitView.isActive()) {
          this.handleActiveUnit(unitView);
        } else if (this.seenUnitIds.has(unitId)) {
          this.handleInactiveUnit(unitView);
        }
      }
    }
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
      for (const render of this.rendersByUnitId.values()) {
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

    const now = performance.now();
    if (now - this.lastGhostQueryAt < 50) {
      return;
    }
    const rect = this.transformHandler.boundingRect();
    if (!rect) return;

    const localX = this.mousePos.x - rect.left;
    const localY = this.mousePos.y - rect.top;
    this.lastGhostQueryAt = now;
    let tileRef: TileRef | undefined;
    const tile = this.transformHandler.screenToWorldCoordinates(localX, localY);
    if (this.game.isValidCoord(tile.x, tile.y)) {
      tileRef = this.game.ref(tile.x, tile.y);
    }

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
      // Only check connected allies - nuking disconnected allies doesn't cause a traitor debuff
      this.connectedAllySmallIds.clear();
      const allies = myPlayer.allies();
      for (let i = 0; i < allies.length; i++) {
        const ally = allies[i];
        if (!ally.isDisconnected()) {
          this.connectedAllySmallIds.add(ally.smallID());
        }
      }

      if (this.connectedAllySmallIds.size > 0) {
        targetingAlly = wouldNukeBreakAlliance({
          game: this.game,
          targetTile: tileRef,
          magnitude: this.game.config().nukeMagnitudes(nukeType),
          allySmallIds: this.connectedAllySmallIds,
          threshold: this.game.config().nukeAllianceBreakThreshold(),
        });
      }
    }

    this.game
      ?.myPlayer()
      ?.actions(tileRef, [this.ghostUnit?.buildableUnit.type])
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
          this.potentialUpgrade = this.rendersByUnitId.get(unit.canUpgrade);
          if (
            this.potentialUpgrade &&
            this.potentialUpgrade.unit.owner().id() !==
              this.game.myPlayer()?.id()
          ) {
            this.potentialUpgrade = undefined;
          }
          if (this.potentialUpgrade) {
            this.potentialUpgrade.iconContainer.filters = [
              new OutlineFilter({ thickness: 2, color: "rgba(0, 255, 0, 1)" }),
            ];
            this.potentialUpgrade.dotContainer.filters = [
              new OutlineFilter({ thickness: 2, color: "rgba(0, 255, 0, 1)" }),
            ];
          }
          // No overlapping when a structure is upgradable
          this.uiState.overlappingRailroads = [];
          this.uiState.ghostRailPaths = [];
        } else if (unit.canBuild === false) {
          this.ghostUnit.container.filters = [
            new OutlineFilter({ thickness: 2, color: "rgba(255, 0, 0, 1)" }),
          ];
          this.uiState.overlappingRailroads = [];
          this.uiState.ghostRailPaths = [];
        } else {
          this.uiState.overlappingRailroads = unit.overlappingRailroads;
          this.uiState.ghostRailPaths = unit.ghostRailPaths;
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
    if (!this.ghostUnit) return;
    if (
      this.ghostUnit.buildableUnit.canBuild === false &&
      this.ghostUnit.buildableUnit.canUpgrade === false
    ) {
      this.removeGhostStructure();
      return;
    }
    const rect = this.transformHandler.boundingRect();
    if (!rect) return;
    const x = e.x - rect.left;
    const y = e.y - rect.top;
    const tile = this.transformHandler.screenToWorldCoordinates(x, y);
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
        new BuildUnitIntentEvent(
          unitType,
          this.game.ref(tile.x, tile.y),
          rocketDirectionUp,
        ),
      );
    }
    this.removeGhostStructure();
  }

  private moveGhost(e: MouseMoveEvent) {
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
    const rect = this.transformHandler.boundingRect();
    const localX = this.mousePos.x - rect.left;
    const localY = this.mousePos.y - rect.top;
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
      buildableUnit: {
        type,
        canBuild: false,
        canUpgrade: false,
        cost: 0n,
        overlappingRailroads: [],
        ghostRailPaths: [],
      },
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
    if (this.potentialUpgrade) {
      this.potentialUpgrade.iconContainer.filters = [];
      this.potentialUpgrade.dotContainer.filters = [];
      this.potentialUpgrade = undefined;
    }
    this.uiState.ghostRailPaths = [];
  }

  private removeGhostStructure() {
    this.clearGhostStructure();
    this.uiState.ghostStructure = null;
    this.eventBus.emit(new GhostStructureChangedEvent(null));
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
    this.visibilityStateDirty = true;
    for (const render of this.rendersByUnitId.values()) {
      this.modifyVisibility(render);
    }
  }

  private refreshVisibilityStateCache() {
    if (!this.visibilityStateDirty) {
      return;
    }

    this.hasHiddenStructure = false;
    for (const infos of this.structures.values()) {
      if (infos.visible === false) {
        this.hasHiddenStructure = true;
        break;
      }
    }

    this.visibilityStateDirty = false;
  }

  private findRenderByUnit(
    unitView: UnitView,
  ): StructureRenderInfo | undefined {
    return this.rendersByUnitId.get(unitView.id());
  }

  private handleActiveUnit(unitView: UnitView) {
    if (this.seenUnitIds.has(unitView.id())) {
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
    if (!this.seenUnitIds.has(unitView.id())) {
      return;
    }

    const render = this.findRenderByUnit(unitView);
    if (render) {
      this.deleteStructure(render);
    }
  }

  private modifyVisibility(render: StructureRenderInfo) {
    this.refreshVisibilityStateCache();

    const structureType = render.unit.type();
    const structureInfos = this.structures.get(structureType);

    if (structureInfos) {
      render.iconContainer.alpha = structureInfos.visible ? 1 : 0.3;
      render.dotContainer.alpha = structureInfos.visible ? 1 : 0.3;
      if (structureInfos.visible && this.hasHiddenStructure) {
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
    this.seenUnitIds.add(unitView.id());
    const render = new StructureRenderInfo(
      unitView,
      unitView.owner().id(),
      this.createIconSprite(unitView),
      this.createLevelSprite(unitView),
      this.createDotSprite(unitView),
      unitView.level(),
      unitView.isUnderConstruction(),
    );
    this.rendersByUnitId.set(unitView.id(), render);
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
    const unitId = render.unit.id();
    this.rendersByUnitId.delete(unitId);
    this.seenUnitIds.delete(unitId);
    if (this.potentialUpgrade?.unit.id() === unitId) {
      this.potentialUpgrade = undefined;
    }
  }
}
