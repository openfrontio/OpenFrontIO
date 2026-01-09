import { extend } from "colord";
import a11yPlugin from "colord/plugins/a11y";
import { OutlineFilter } from "pixi-filters";
import * as PIXI from "pixi.js";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import {
  Cell,
  PlayerActions,
  PlayerID,
  UnitType,
} from "../../../core/game/Game";
import {
  GameUpdateType,
} from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import {
  ToggleStructureEvent as ToggleStructuresEvent,
} from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { Layer } from "./Layer";
import { GhostStructureManager } from "./GhostStructureManager";
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
  private ghostManager: GhostStructureManager | null = null;
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
  private potentialUpgrade: StructureRenderInfo | undefined;

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

    this.ghostManager = new GhostStructureManager(
      this.game,
      this.eventBus,
      this.uiState,
      this.transformHandler,
      this.ghostStage,
      this.factory,
      (unitId) => this.onHighlightUpgrade(unitId),
    );
  }

  shouldTransform(): boolean {
    return false;
  }

  async init() {
    this.eventBus.on(ToggleStructuresEvent, (e) =>
      this.toggleStructures(e.structureTypes),
    );

    window.addEventListener("resize", () => this.resizeCanvas());
    await this.setupRenderer();
    this.ghostManager?.init();
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

    if (this.ghostManager) {
      this.ghostManager.renderGhost(this.pixicanvas);
    }

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

  /*
   * Highlight an existing structure when the ghost is hovered over it for an upgrade.
   */
  private onHighlightUpgrade(unitId: number | null) {
    if (this.potentialUpgrade) {
      this.potentialUpgrade.iconContainer.filters = [];
      this.potentialUpgrade.dotContainer.filters = [];
      this.potentialUpgrade = undefined;
    }

    if (unitId !== null) {
      this.potentialUpgrade = this.renders.find(
        (r) =>
          r.unit.id() === unitId &&
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
