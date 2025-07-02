import * as PIXI from "pixi.js";
import bitmapFont from "../../../../resources/fonts/round_6x6_modified.xml";
import anchorIcon from "../../../../resources/images/AnchorIcon.png";
import cityIcon from "../../../../resources/images/CityIcon.png";
import factoryIcon from "../../../../resources/images/FactoryUnit.png";
import missileSiloIcon from "../../../../resources/images/MissileSiloUnit.png";
import SAMMissileIcon from "../../../../resources/images/SamLauncherUnit.png";
import shieldIcon from "../../../../resources/images/ShieldIcon.png";
import { Theme } from "../../../core/configuration/Config";
import { Cell, PlayerID, UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

class StructureRenderInfo {
  public isOnScreen: boolean = false;
  constructor(
    public unit: UnitView,
    public owner: PlayerID,
    public pixiContainer: PIXI.Container,
    public level: number = 0,
    public underConstruction: boolean = true,
  ) {}
}
const ZOOM_THRESHOLD = 2.5;
const ICON_SIZE = 24;
const OFFSET_ZOOM_Y = 12; // offset for the y position of the icon to avoid hiding the structure beneath

export class StructureIconsLayer implements Layer {
  private pixicanvas: HTMLCanvasElement;
  private stage: PIXI.Container;
  private shouldRedraw: boolean = true;
  private textureCache: Map<string, PIXI.Texture> = new Map();
  private theme: Theme;
  private renderer: PIXI.Renderer;
  private renders: StructureRenderInfo[] = [];
  private seenUnits: Set<UnitView> = new Set();
  private structures: Map<
    UnitType,
    { iconPath: string; image: HTMLImageElement | null }
  > = new Map([
    [UnitType.City, { iconPath: cityIcon, image: null }],
    [UnitType.Factory, { iconPath: factoryIcon, image: null }],
    [UnitType.DefensePost, { iconPath: shieldIcon, image: null }],
    [UnitType.Port, { iconPath: anchorIcon, image: null }],
    [UnitType.MissileSilo, { iconPath: missileSiloIcon, image: null }],
    [UnitType.SAMLauncher, { iconPath: SAMMissileIcon, image: null }],
  ]);

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
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
    this.stage = new PIXI.Container();
    this.stage.position.set(0, 0);
    this.stage.width = this.pixicanvas.width;
    this.stage.height = this.pixicanvas.height;
    await this.renderer.init({
      canvas: this.pixicanvas,
      resolution: 1,
      width: this.pixicanvas.width,
      height: this.pixicanvas.height,
      clearBeforeRender: true,
      backgroundAlpha: 0,
      backgroundColor: 0x00000000,
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
    window.addEventListener("resize", () => this.resizeCanvas());
    await this.setupRenderer();
    this.redraw();
  }

  resizeCanvas() {
    if (this.renderer) {
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

  private checkForConstructionState(
    render: StructureRenderInfo,
    unit: UnitView,
  ) {
    if (
      render.underConstruction &&
      render.unit.type() !== UnitType.Construction
    ) {
      render.underConstruction = false;
      render.pixiContainer?.destroy();
      render.pixiContainer = this.createPixiSprite(unit);
      this.shouldRedraw = true;
    }
  }

  private checkForOwnershipChange(render: StructureRenderInfo, unit: UnitView) {
    if (render.owner !== unit.owner().id()) {
      render.owner = unit.owner().id();
      render.pixiContainer?.destroy();
      render.pixiContainer = this.createPixiSprite(unit);
      this.shouldRedraw = true;
    }
  }

  private checkForLevelChange(render: StructureRenderInfo, unit: UnitView) {
    if (render.level !== unit.level()) {
      render.level = unit.level();
      render.pixiContainer?.destroy();
      render.pixiContainer = this.createPixiSprite(unit);
      this.shouldRedraw = true;
    }
  }

  redraw() {
    this.resizeCanvas();
  }

  renderLayer(mainContext: CanvasRenderingContext2D) {
    if (!this.renderer || this.transformHandler.scale > ZOOM_THRESHOLD) {
      return;
    }

    if (this.transformHandler.hasChanged()) {
      for (const render of this.renders) {
        this.computeNewLocation(render);
      }
    }

    if (this.transformHandler.hasChanged() || this.shouldRedraw) {
      this.renderer.render(this.stage);
      this.shouldRedraw = false;
    }
    mainContext.drawImage(this.renderer.canvas, 0, 0);
  }

  private createTexture(unit: UnitView): PIXI.Texture {
    const isConstruction = unit.type() === UnitType.Construction;
    const constructionType = unit.constructionType();
    if (isConstruction && constructionType === undefined) {
      console.warn(
        `Unit ${unit.id()} is a construction but has no construction type.`,
      );
      return PIXI.Texture.EMPTY;
    }
    const structureType = isConstruction ? constructionType! : unit.type();
    const cacheKey = isConstruction
      ? `construction-${structureType}`
      : `${unit.owner().id()}-${structureType}`;
    if (this.textureCache.has(cacheKey)) {
      return this.textureCache.get(cacheKey)!;
    }

    const structureCanvas = document.createElement("canvas");
    structureCanvas.width = ICON_SIZE;
    structureCanvas.height = ICON_SIZE;
    const context = structureCanvas.getContext("2d")!;

    let borderColor: string;
    if (isConstruction) {
      context.fillStyle = "rgb(198, 198, 198)";
      borderColor = "rgb(128, 127, 127)";
    } else {
      context.fillStyle = this.theme
        .territoryColor(unit.owner())
        .lighten(0.06)
        .toRgbString();
      borderColor = this.theme
        .borderColor(unit.owner())
        .darken(0.08)
        .toRgbString();
    }
    context.strokeStyle = borderColor;
    context.beginPath();
    context.arc(
      ICON_SIZE / 2,
      ICON_SIZE / 2,
      ICON_SIZE / 2 - 1,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.lineWidth = 1;
    context.stroke();
    const structureInfo = this.structures.get(structureType);
    if (!structureInfo?.image) {
      console.warn(`Image not loaded for unit type: ${structureType}`);
      return PIXI.Texture.from(structureCanvas);
    }
    context.drawImage(
      this.getImageColored(structureInfo.image, borderColor),
      4,
      4,
    );
    const texture = PIXI.Texture.from(structureCanvas);
    this.textureCache.set(cacheKey, texture);
    return texture;
  }

  private createPixiSprite(unit: UnitView): PIXI.Container {
    const parentContainer = new PIXI.Container();
    const sprite = new PIXI.Sprite(this.createTexture(unit));
    sprite.anchor.set(0.5, 0.5);
    const tile = unit.tile();
    const worldX = this.game.x(tile);
    const worldY = this.game.y(tile);
    const screenPos = this.transformHandler.worldToScreenCoordinates(
      new Cell(worldX, worldY),
    );
    parentContainer.addChild(sprite);
    if (unit.level() > 1) {
      const text = new PIXI.BitmapText({
        text: unit.level().toString(),
        style: {
          fontFamily: "round_6x6_modified",
          fontSize: 12,
        },
      });
      text.anchor.set(0.5, 0.5);
      text.position.y = -ICON_SIZE / 2 - 2;
      parentContainer.addChild(text);
    }
    const posX = Math.round(screenPos.x);
    let posY = Math.round(screenPos.y);
    if (this.transformHandler.scale >= ZOOM_THRESHOLD) {
      // Adjust the y position based on zoom level to avoid hiding the structure beneath
      posY = Math.round(
        screenPos.y - this.transformHandler.scale * OFFSET_ZOOM_Y,
      );
    } else {
      posY = Math.round(screenPos.y);
    }
    parentContainer.position.set(posX, posY);
    parentContainer.scale.set(Math.min(1, this.transformHandler.scale));
    this.stage.addChild(parentContainer);
    return parentContainer;
  }

  private getImageColored(
    image: HTMLImageElement,
    color: string,
  ): HTMLCanvasElement {
    const imageCanvas = document.createElement("canvas");
    imageCanvas.width = image.width;
    imageCanvas.height = image.height;
    const ctx = imageCanvas.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(image, 0, 0);
    return imageCanvas;
  }

  private computeNewLocation(render: StructureRenderInfo) {
    const tile = render.unit.tile();
    const worldX = this.game.x(tile);
    const worldY = this.game.y(tile);
    const screenPos = this.transformHandler.worldToScreenCoordinates(
      new Cell(worldX, worldY),
    );
    screenPos.x = Math.round(screenPos.x);
    if (this.transformHandler.scale >= ZOOM_THRESHOLD) {
      // Adjust the y position based on zoom level to avoid hiding the structure beneath
      screenPos.y = Math.round(
        screenPos.y - this.transformHandler.scale * OFFSET_ZOOM_Y,
      );
    } else {
      screenPos.y = Math.round(screenPos.y);
    }

    // Check if the sprite is on screen (with margin for partial visibility)
    const margin = ICON_SIZE;
    const onScreen =
      screenPos.x + margin > 0 &&
      screenPos.x - margin < this.pixicanvas.width &&
      screenPos.y + margin > 0 &&
      screenPos.y - margin < this.pixicanvas.height;

    if (onScreen) {
      render.pixiContainer.x = screenPos.x;
      render.pixiContainer.y = screenPos.y;
      render.pixiContainer.scale.set(Math.min(1, this.transformHandler.scale));
    }
    if (render.isOnScreen !== onScreen) {
      // prevent unnecessary updates
      render.isOnScreen = onScreen;
      render.pixiContainer.visible = onScreen;
    }
  }

  private addNewStructure(unitView: UnitView) {
    this.seenUnits.add(unitView);
    const render = new StructureRenderInfo(
      unitView,
      unitView.owner().id(),
      this.createPixiSprite(unitView),
      unitView.level(),
      unitView.type() === UnitType.Construction,
    );
    this.renders.push(render);
    this.computeNewLocation(render);
    this.shouldRedraw = true;
  }

  private deleteStructure(render: StructureRenderInfo) {
    render.pixiContainer?.destroy();
    this.renders = this.renders.filter((r) => r.unit !== render.unit);
    this.seenUnits.delete(render.unit);
  }
}
