import * as PIXI from "pixi.js";
import { OutlineFilter } from "pixi-filters";
import bitmapFont from "../../../../resources/fonts/round_6x6_modified.xml";
import anchorIcon from "../../../../resources/images/AnchorIcon.png";
import cityIcon from "../../../../resources/images/CityIcon.png";
import factoryIcon from "../../../../resources/images/FactoryUnit.png";
import missileSiloIcon from "../../../../resources/images/MissileSiloUnit.png";
import SAMMissileIcon from "../../../../resources/images/SamLauncherUnit.png";
import shieldIcon from "../../../../resources/images/ShieldIcon.png";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { Cell, PlayerID, UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { ToggleStructureEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

type ShapeType = "triangle" | "square" | "pentagon" | "octagon" | "circle";

class StructureRenderInfo {
  public isOnScreen = false;
  constructor(
    public unit: UnitView,
    public owner: PlayerID,
    public iconContainer: PIXI.Container,
    public levelContainer: PIXI.Container,
    public dotContainer: PIXI.Container,
    public level = 0,
    public underConstruction = true,
  ) {}
}

const STRUCTURE_SHAPES: Partial<Record<UnitType, ShapeType>> = {
  [UnitType.City]: "circle",
  [UnitType.Port]: "pentagon",
  [UnitType.Factory]: "circle",
  [UnitType.DefensePost]: "octagon",
  [UnitType.SAMLauncher]: "square",
  [UnitType.MissileSilo]: "triangle",
};
const LEVEL_SCALE_FACTOR = 3;
const ICON_SCALE_FACTOR_ZOOMED_IN = 3.5;
const ICON_SCALE_FACTOR_ZOOMED_OUT = 1.4;
const DOTS_ZOOM_THRESHOLD = 0.5;
const ZOOM_THRESHOLD = 4.3;
const ICON_SIZE = {
  circle: 28,
  octagon: 28,
  pentagon: 30,
  square: 28,
  triangle: 28,
};
const OFFSET_ZOOM_Y = 4; // offset for the y position of the level over the sprite

export class StructureIconsLayer implements Layer {
  private pixicanvas: HTMLCanvasElement | undefined;
  private iconsStage: PIXI.Container | undefined;
  private levelsStage: PIXI.Container | undefined;
  private dotsStage: PIXI.Container | undefined;
  private shouldRedraw = true;
  private readonly textureCache: Map<string, PIXI.Texture> = new Map();
  private readonly theme: Theme;
  private renderer: PIXI.Renderer | undefined;
  private renders: StructureRenderInfo[] = [];
  private readonly seenUnits: Set<UnitView> = new Set();
  private readonly structures: Map<
    UnitType,
    { visible: boolean; iconPath: string; image: HTMLImageElement | null }
  > = new Map([
    [UnitType.City, { iconPath: cityIcon, image: null, visible: true }],
    [UnitType.Factory, { iconPath: factoryIcon, image: null, visible: true }],
    [
      UnitType.DefensePost,
      { iconPath: shieldIcon, image: null, visible: true },
    ],
    [UnitType.Port, { iconPath: anchorIcon, image: null, visible: true }],
    [
      UnitType.MissileSilo,
      { iconPath: missileSiloIcon, image: null, visible: true },
    ],
    [
      UnitType.SAMLauncher,
      { iconPath: SAMMissileIcon, image: null, visible: true },
    ],
  ]);
  private renderSprites = true;

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
    this.structures.forEach((u, unitType) => this.loadIcon(u, unitType));
  }

  async setupRenderer() {
    try {
      await PIXI.Assets.load(bitmapFont);
    } catch (error) {
      console.error("Failed to load bitmap font:", error);
    }
    this.renderer = new PIXI.WebGLRenderer();
    this.pixicanvas = document.createElement("canvas");
    this.pixicanvas.width = window.innerWidth;
    this.pixicanvas.height = window.innerHeight;

    this.iconsStage = new PIXI.Container();
    this.iconsStage.position.set(0, 0);
    this.iconsStage.setSize(this.pixicanvas.width, this.pixicanvas.height);

    this.levelsStage = new PIXI.Container();
    this.levelsStage.position.set(0, 0);
    this.levelsStage.setSize(this.pixicanvas.width, this.pixicanvas.height);

    this.dotsStage = new PIXI.Container();
    this.dotsStage.position.set(0, 0);
    this.dotsStage.setSize(this.pixicanvas.width, this.pixicanvas.height);

    await this.renderer.init({
      antialias: false,
      backgroundAlpha: 0,
      backgroundColor: 0x00000000,
      canvas: this.pixicanvas,
      clearBeforeRender: true,
      height: this.pixicanvas.height,
      resolution: 1,
      width: this.pixicanvas.width,
    });
  }

  private loadIcon(
    unitInfo: {
      iconPath: string;
      image: HTMLImageElement | null;
    },
    unitType: UnitType,
  ) {
    const image = new Image();
    image.src = unitInfo.iconPath;
    image.onload = () => {
      unitInfo.image = image;
    };
    image.onerror = () => {
      console.error(
        `Failed to load icon for ${unitType}: ${unitInfo.iconPath}`,
      );
    };
  }

  shouldTransform(): boolean {
    return false;
  }

  async init() {
    this.eventBus.on(ToggleStructureEvent, (e) =>
      this.toggleStructure(e.structureType),
    );
    window.addEventListener("resize", () => this.resizeCanvas());
    await this.setupRenderer();
    this.redraw();
  }

  resizeCanvas() {
    if (this.renderer && this.pixicanvas) {
      this.pixicanvas.width = window.innerWidth;
      this.pixicanvas.height = window.innerHeight;
      this.renderer.resize(innerWidth, innerHeight, 1);
      this.shouldRedraw = true;
    }
  }

  public tick() {
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

  private toggleStructure(toggleStructureType: UnitType | null): void {
    for (const [structureType, infos] of this.structures) {
      infos.visible =
        structureType === toggleStructureType || toggleStructureType === null;
    }
    for (const render of this.renders) {
      this.modifyVisibility(render);
    }
    this.shouldRedraw = true;
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
        this.checkForOwnershipChange(render, unitView);
        this.checkForLevelChange(render, unitView);
      }
    } else if (
      this.structures.has(unitView.type()) ||
      unitView.type() === UnitType.Construction
    ) {
      this.addNewStructure(unitView);
    }
  }

  private handleInactiveUnit(unitView: UnitView) {
    const render = this.findRenderByUnit(unitView);
    if (render) {
      this.deleteStructure(render);
      this.shouldRedraw = true;
    }
  }

  private modifyVisibility(render: StructureRenderInfo) {
    const structureType =
      render.unit.type() === UnitType.Construction
        ? render.unit.constructionType()
        : render.unit.type();
    if (structureType === undefined) return;
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
          new OutlineFilter({ color: "rgb(255, 255, 255)", thickness: 2 }),
        ];
        render.dotContainer.filters = [
          new OutlineFilter({ color: "rgb(255, 255, 255)", thickness: 2 }),
        ];
      } else {
        render.iconContainer.filters = [];
        render.dotContainer.filters = [];
      }
    }
  }

  private checkForConstructionState(
    render: StructureRenderInfo,
    unit: UnitView,
  ) {
    if (
      render.underConstruction &&
      render.unit.type() !== UnitType.Construction
    ) {
      render.underConstruction = false;
      render.iconContainer?.destroy();
      render.dotContainer?.destroy();
      render.iconContainer = this.createIconSprite(unit);
      render.dotContainer = this.createDotSprite(unit);
      this.modifyVisibility(render);
      this.shouldRedraw = true;
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
      this.shouldRedraw = true;
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
      this.shouldRedraw = true;
    }
  }

  redraw() {
    this.resizeCanvas();
  }

  renderLayer(mainContext: CanvasRenderingContext2D) {
    if (!this.renderer) {
      return;
    }

    if (this.transformHandler.hasChanged()) {
      for (const render of this.renders) {
        this.computeNewLocation(render);
      }
    }

    if (this.transformHandler.hasChanged() || this.shouldRedraw) {
      if (this.transformHandler.scale > ZOOM_THRESHOLD && this.renderSprites) {
        if (this.levelsStage === undefined) throw new Error("Not initialized");
        this.renderer.render(this.levelsStage);
      } else if (this.transformHandler.scale > DOTS_ZOOM_THRESHOLD) {
        if (this.iconsStage === undefined) throw new Error("Not initialized");
        this.renderer.render(this.iconsStage);
      } else {
        if (this.dotsStage === undefined) throw new Error("Not initialized");
        this.renderer.render(this.dotsStage);
      }
      this.shouldRedraw = false;
    }
    mainContext.drawImage(this.renderer.canvas, 0, 0);
  }

  private createTexture(unit: UnitView, renderIcon: boolean): PIXI.Texture {
    const isConstruction = unit.type() === UnitType.Construction;
    const constructionType = unit.constructionType();
    if (isConstruction && constructionType === undefined) {
      console.warn(
        `Unit ${unit.id()} is a construction but has no construction type.`,
      );
      return PIXI.Texture.EMPTY;
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const structureType = isConstruction ? constructionType! : unit.type();
    const cacheKey = isConstruction
      ? `construction-${structureType}` + (renderIcon ? "-icon" : "")
      : `${this.theme.territoryColor(unit.owner()).toRgbString()}-${structureType}` +
        (renderIcon ? "-icon" : "");
    const cached = this.textureCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const shape = STRUCTURE_SHAPES[structureType];
    const texture = shape
      ? this.createIcon(
          unit.owner(),
          structureType,
          isConstruction,
          shape,
          renderIcon,
        )
      : PIXI.Texture.EMPTY;

    this.textureCache.set(cacheKey, texture);
    return texture;
  }

  private createIcon(
    owner: PlayerView,
    structureType: UnitType,
    isConstruction: boolean,
    shape: ShapeType,
    renderIcon: boolean,
  ): PIXI.Texture {
    const structureCanvas = document.createElement("canvas");
    let iconSize = ICON_SIZE[shape];
    if (!renderIcon) {
      iconSize /= 2.5;
    }
    structureCanvas.width = Math.ceil(iconSize);
    structureCanvas.height = Math.ceil(iconSize);
    const context = structureCanvas.getContext("2d");
    if (!context) throw new Error("2D context not supported");

    let borderColor: string;
    if (isConstruction) {
      context.fillStyle = "rgb(198, 198, 198)";
      borderColor = "rgb(128, 127, 127)";
    } else {
      context.fillStyle = this.theme
        .territoryColor(owner)
        .lighten(0.13)
        .alpha(renderIcon ? 0.65 : 1)
        .toRgbString();
      const darken = this.theme.borderColor(owner).isLight() ? 0.17 : 0.15;
      borderColor = this.theme.borderColor(owner).darken(darken).toRgbString();
    }

    context.strokeStyle = borderColor;
    context.lineWidth = 1;
    const halfIconSize = iconSize / 2;
    switch (shape) {
      case "triangle":
        context.beginPath();
        context.moveTo(halfIconSize, 1); // Top
        context.lineTo(iconSize - 1, iconSize - 1); // Bottom right
        context.lineTo(0, iconSize - 1); // Bottom left
        context.closePath();
        context.fill();
        context.stroke();
        break;

      case "square":
        context.fillRect(1, 1, iconSize - 2, iconSize - 2);
        context.strokeRect(1, 1, iconSize - 3, iconSize - 3);
        break;

      case "octagon":
        {
          const cx = halfIconSize;
          const cy = halfIconSize;
          const r = halfIconSize - 1;
          const step = (Math.PI * 2) / 8;

          context.beginPath();
          for (let i = 0; i < 8; i++) {
            const angle = step * i - Math.PI / 8; // slight rotation for flat top
            const x = cx + r * Math.cos(angle);
            const y = cy + r * Math.sin(angle);
            if (i === 0) {
              context.moveTo(x, y);
            } else {
              context.lineTo(x, y);
            }
          }
          context.closePath();
          context.fill();
          context.stroke();
        }
        break;
      case "pentagon":
        {
          const cx = halfIconSize;
          const cy = halfIconSize;
          const r = halfIconSize - 1;
          const step = (Math.PI * 2) / 5;

          context.beginPath();
          for (let i = 0; i < 5; i++) {
            const angle = step * i - Math.PI / 2; // rotate to have flat base or point up
            const x = cx + r * Math.cos(angle);
            const y = cy + r * Math.sin(angle);
            if (i === 0) {
              context.moveTo(x, y);
            } else {
              context.lineTo(x, y);
            }
          }
          context.closePath();
          context.fill();
          context.stroke();
        }
        break;
      case "circle":
        context.beginPath();
        context.arc(
          halfIconSize,
          halfIconSize,
          halfIconSize - 1,
          0,
          Math.PI * 2,
        );
        context.fill();
        context.stroke();
        break;

      default:
        throw new Error(`Unknown shape: ${shape}`);
    }

    const structureInfo = this.structures.get(structureType);
    if (!structureInfo?.image) {
      console.warn(`Image not loaded for unit type: ${structureType}`);
      return PIXI.Texture.from(structureCanvas);
    }

    if (renderIcon) {
      const SHAPE_OFFSETS = {
        circle: [6, 6],
        octagon: [6, 6],
        pentagon: [7, 7],
        square: [5, 5],
        triangle: [6, 11],
      };
      const [offsetX, offsetY] = SHAPE_OFFSETS[shape] || [0, 0];
      context.drawImage(
        this.getImageColored(structureInfo.image, borderColor),
        offsetX,
        offsetY,
      );
    }
    return PIXI.Texture.from(structureCanvas);
  }

  private createLevelSprite(unit: UnitView): PIXI.Container {
    if (this.levelsStage === undefined) throw new Error("Not initialized");
    return this.createUnitContainer(unit, {
      stage: this.levelsStage,
      type: "level",
    });
  }

  private createDotSprite(unit: UnitView): PIXI.Container {
    if (this.dotsStage === undefined) throw new Error("Not initialized");
    return this.createUnitContainer(unit, {
      stage: this.dotsStage,
      type: "dot",
    });
  }

  private createIconSprite(unit: UnitView): PIXI.Container {
    if (this.iconsStage === undefined) throw new Error("Not initialized");
    return this.createUnitContainer(unit, {
      stage: this.iconsStage,
      type: "icon",
    });
  }

  private createUnitContainer(
    unit: UnitView,
    options: { type?: "icon" | "dot" | "level"; stage: PIXI.Container },
  ): PIXI.Container {
    const parentContainer = new PIXI.Container();
    const tile = unit.tile();
    const worldPos = new Cell(this.game.x(tile), this.game.y(tile));
    const screenPos = this.transformHandler.worldToScreenCoordinates(worldPos);

    const { type, stage } = options;
    const { scale } = this.transformHandler;
    const spritesEnabled = this.game
      .config()
      .userSettings()
      ?.structureSprites?.();

    // Add sprite if needed
    if (type === "icon" || type === "dot") {
      const texture = this.createTexture(unit, type === "icon");
      const sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(0.5);
      parentContainer.addChild(sprite);
    }

    // Add level text if needed
    if ((type === "icon" || type === "level") && unit.level() > 1) {
      const text = new PIXI.BitmapText({
        style: {
          fontFamily: "round_6x6_modified",
          fontSize: 14,
        },
        text: unit.level().toString(),
      });
      text.anchor.set(0.5);

      const unitType =
        unit.type() === UnitType.Construction
          ? unit.constructionType()
          : unit.type();
      const shape =
        unitType !== undefined ? STRUCTURE_SHAPES[unitType] : undefined;
      if (shape !== undefined) {
        text.position.y = Math.round(-ICON_SIZE[shape] / 2 - 2);
      }
      parentContainer.addChild(text);
    }

    // Positioning
    const posX = Math.round(screenPos.x);
    let posY = Math.round(screenPos.y);
    if (type === "level" && scale >= ZOOM_THRESHOLD && spritesEnabled) {
      posY = Math.round(screenPos.y - scale * OFFSET_ZOOM_Y);
    }
    parentContainer.position.set(posX, posY);

    // Scaling
    if (type === "icon") {
      const s =
        scale >= ZOOM_THRESHOLD && !spritesEnabled
          ? Math.max(1, scale / ICON_SCALE_FACTOR_ZOOMED_IN)
          : Math.min(1, scale / ICON_SCALE_FACTOR_ZOOMED_OUT);
      parentContainer.scale.set(s);
    } else if (type === "level") {
      parentContainer.scale.set(Math.max(1, scale / LEVEL_SCALE_FACTOR));
    }

    stage.addChild(parentContainer);
    return parentContainer;
  }

  private getImageColored(
    image: HTMLImageElement,
    color: string,
  ): HTMLCanvasElement {
    const imageCanvas = document.createElement("canvas");
    imageCanvas.width = image.width;
    imageCanvas.height = image.height;
    const ctx = imageCanvas.getContext("2d");
    if (!ctx) throw new Error("2D context not supported");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(image, 0, 0);
    return imageCanvas;
  }

  private computeNewLocation(render: StructureRenderInfo) {
    const tile = render.unit.tile();
    const worldPos = new Cell(this.game.x(tile), this.game.y(tile));
    const screenPos = this.transformHandler.worldToScreenCoordinates(worldPos);
    screenPos.x = Math.round(screenPos.x);

    const { scale } = this.transformHandler;
    screenPos.y = Math.round(
      scale >= ZOOM_THRESHOLD &&
        this.game.config().userSettings()?.structureSprites()
        ? screenPos.y - scale * OFFSET_ZOOM_Y
        : screenPos.y,
    );

    const type =
      render.unit.type() === UnitType.Construction
        ? render.unit.constructionType()
        : render.unit.type();
    const margin =
      type !== undefined && STRUCTURE_SHAPES[type] !== undefined
        ? ICON_SIZE[STRUCTURE_SHAPES[type]]
        : 28;

    if (this.pixicanvas === undefined) throw new Error("Not initialized");
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
      unitView.type() === UnitType.Construction,
    );
    this.renders.push(render);
    this.computeNewLocation(render);
    this.modifyVisibility(render);
    this.shouldRedraw = true;
  }

  private deleteStructure(render: StructureRenderInfo) {
    render.iconContainer?.destroy();
    render.levelContainer?.destroy();
    render.dotContainer?.destroy();
    this.renders = this.renders.filter((r) => r.unit !== render.unit);
    this.seenUnits.delete(render.unit);
  }
}
