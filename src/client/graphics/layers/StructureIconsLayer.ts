import * as PIXI from "pixi.js";
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
    public pixiSprite: PIXI.Sprite,
  ) {}
}
const ZOOM_THRESHOLD = 2.8; // below this zoom level, structures are not rendered
const ICON_SIZE = 24;
const OFFSET_ZOOM_Y = 15; // offset for the y position of the icon to avoid hiding the structure beneath

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
    if (this.renderer.view) {
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
          if (this.seenUnits.has(unitView)) {
            // check if owner has changed
            const render = this.renders.find(
              (r) => r.unit.id() === unitView.id(),
            );
            if (render) {
              this.ownerChangeCheck(render, unitView);
            }
          } else if (this.structures.has(unitView.type())) {
            // new unit, create render info
            this.seenUnits.add(unitView);
            const render = new StructureRenderInfo(
              unitView,
              unitView.owner().id(),
              this.createPixiSprite(unitView),
            );
            this.renders.push(render);
            this.computeNewLocation(render);
            this.shouldRedraw = true;
          }
        }

        if (!unitView.isActive() && this.seenUnits.has(unitView)) {
          const render = this.renders.find(
            (r) => r.unit.id() === unitView.id(),
          );
          if (render) {
            this.deleteStructure(render);
          }
          this.shouldRedraw = true;
          return;
        }
      });
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

  private ownerChangeCheck(render: StructureRenderInfo, unit: UnitView) {
    if (render.owner !== unit.owner().id()) {
      render.owner = unit.owner().id();
      render.pixiSprite?.destroy();
      render.pixiSprite = this.createPixiSprite(unit);
      this.shouldRedraw = true;
    }
  }

  private createTexture(unit: UnitView): PIXI.Texture {
    const cacheKey = `${unit.owner().id()}-${unit.type()}`;
    if (this.textureCache.has(cacheKey)) {
      return this.textureCache.get(cacheKey)!;
    }
    const structureCanvas = document.createElement("canvas");
    structureCanvas.width = ICON_SIZE;
    structureCanvas.height = ICON_SIZE;
    const context = structureCanvas.getContext("2d")!;
    context.fillStyle = this.theme
      .territoryColor(unit.owner())
      .lighten(0.1)
      .toRgbString();
    const borderColor = this.theme
      .borderColor(unit.owner())
      .darken(0.2)
      .toRgbString();
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
    const structureInfo = this.structures.get(unit.type());
    if (!structureInfo?.image) {
      console.warn(`Image not loaded for unit type: ${unit.type()}`);
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

  private createPixiSprite(unit: UnitView): PIXI.Sprite {
    const sprite = new PIXI.Sprite(this.createTexture(unit));
    sprite.anchor.set(0.5, 0.5);
    const tile = unit.tile();
    const worldX = this.game.x(tile);
    const worldY = this.game.y(tile);
    const screenPos = this.transformHandler.worldToScreenCoordinates(
      new Cell(worldX, worldY),
    );
    sprite.x = screenPos.x;
    sprite.y = screenPos.y - this.transformHandler.scale * OFFSET_ZOOM_Y;
    sprite.scale.set(Math.min(1, this.transformHandler.scale));
    this.stage.addChild(sprite);
    return sprite;
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
    screenPos.y = Math.round(
      screenPos.y - this.transformHandler.scale * OFFSET_ZOOM_Y,
    );

    // Check if the sprite is on screen (with margin for partial visibility)
    const margin = ICON_SIZE;
    const onScreen =
      screenPos.x + margin > 0 &&
      screenPos.x - margin < this.pixicanvas.width &&
      screenPos.y + margin > 0 &&
      screenPos.y - margin < this.pixicanvas.height;

    if (onScreen) {
      render.pixiSprite.x = screenPos.x;
      render.pixiSprite.y = screenPos.y;
      render.pixiSprite.scale.set(Math.min(1, this.transformHandler.scale));
    }
    if (render.isOnScreen !== onScreen) {
      // prevent unnecessary updates
      render.isOnScreen = onScreen;
      render.pixiSprite.visible = onScreen;
    }
  }

  private deleteStructure(render: StructureRenderInfo) {
    render.pixiSprite?.destroy();
    this.renders = this.renders.filter((r) => r.unit !== render.unit);
    this.seenUnits.delete(render.unit);
  }
}
