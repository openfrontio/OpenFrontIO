import { Theme } from "../../../core/configuration/Config";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

import anchorIcon from "../../../../resources/images/AnchorIcon.png";
import cityIcon from "../../../../resources/images/CityIcon.png";
import missileSiloIcon from "../../../../resources/images/MissileSiloUnit.png";
import SAMMissileIcon from "../../../../resources/images/SamLauncherUnit.png";
import shieldIcon from "../../../../resources/images/ShieldIcon.png";
import { Cell, PlayerID, UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";

class StructureRenderInfo {
  public firstDraw: boolean = true;
  public location: { x: number; y: number } | null = null;

  constructor(
    public unit: UnitView,
    public owner: PlayerID,
    public imageData: HTMLCanvasElement,
    public shouldRedraw: boolean = true,
  ) {}
}
const ZOOM_THRESHOLD = 2.8; // below this zoom level, structures are not rendered
const ICON_SIZE = 24;

export class StructureIconsLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private nodeCache: Map<string, HTMLCanvasElement> = new Map();
  private context: CanvasRenderingContext2D;
  private theme: Theme;
  private renders: StructureRenderInfo[] = [];
  private seenUnits: Set<UnitView> = new Set();
  private structures: Map<
    UnitType,
    { iconPath: string; image: HTMLImageElement | null }
  > = new Map([
    [UnitType.City, { iconPath: cityIcon, image: null }],
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
      console.log(
        `icon loaded: ${unitType}, size: ${image.width}x${image.height}`,
      );
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

  init() {
    window.addEventListener("resize", () => this.resizeCanvas());
    this.redraw();
  }

  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
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
            if (!render) {
              console.warn(`Render not found for unit ${unitView.id()}`);
              return;
            }
            this.checkOwner(render, unitView);
          } else if (this.structures.has(unitView.type())) {
            // new unit, create render info
            this.seenUnits.add(unitView);
            this.renders.push(
              new StructureRenderInfo(
                unitView,
                unitView.owner().id(),
                this.createUnitElement(unitView),
              ),
            );
          }
        }
        if (!unitView.isActive() && this.seenUnits.has(unitView)) {
          const render = this.renders.find(
            (r) => r.unit.id() === unitView.id(),
          );
          if (!render) {
            console.warn(`Render not found for unit ${unitView.id()}`);
            return;
          }
          this.deleteStructure(render);
          return;
        }
      });
  }

  redraw() {
    console.log("structureIcons layer redrawing");
    this.canvas = document.createElement("canvas");
    this.resizeCanvas();
    const context = this.canvas.getContext("2d", { alpha: true });
    if (context === null) throw new Error("2d context not supported");
    this.context = context;
  }

  renderLayer(mainContext: CanvasRenderingContext2D) {
    const hasChanged = this.transformHandler.hasChanged();
    const isZoomedOut = this.transformHandler.scale <= ZOOM_THRESHOLD;
    const scaleCapped = Math.min(1, this.transformHandler.scale * 1.3);
    if (hasChanged || !isZoomedOut) {
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (!isZoomedOut) {
      return;
    }

    if (!hasChanged) {
      for (const render of this.renders) {
        if (render.shouldRedraw) {
          this.clearStructure(render);
        }
      }
    }

    for (const render of this.renders) {
      if (hasChanged || render.firstDraw) {
        this.computeNewLocation(render);
      }
    }

    if (hasChanged) {
      this.context.save();
      this.context.scale(scaleCapped, scaleCapped);
    }

    for (const render of this.renders) {
      const shouldDraw = render.shouldRedraw || hasChanged || render.firstDraw;

      const loc = render.location;
      const isOnScreen =
        loc &&
        loc.x >= 0 &&
        loc.y >= 0 &&
        loc.x <= this.canvas.width &&
        loc.y <= this.canvas.height;

      if (shouldDraw && isOnScreen) {
        render.firstDraw = false;
        render.shouldRedraw = false;
        this.renderStructure(render, scaleCapped);
      }
    }

    if (hasChanged) {
      this.context.restore();
    }

    mainContext.drawImage(this.canvas, 0, 0);
  }

  private checkOwner(render: StructureRenderInfo, unit: UnitView) {
    if (render.owner !== unit.owner().id()) {
      render.shouldRedraw = true;
      render.owner = unit.owner().id();
      render.imageData = this.createUnitElement(unit);
    }
  }

  private createUnitElement(unit: UnitView): HTMLCanvasElement {
    const cacheKey = `${unit.owner().id()}-${unit.type()}`;
    if (this.nodeCache.has(cacheKey)) {
      const cachedCanvas = this.nodeCache.get(cacheKey)!;
      const clonedCanvas = document.createElement("canvas");
      clonedCanvas.width = cachedCanvas.width;
      clonedCanvas.height = cachedCanvas.height;
      clonedCanvas.getContext("2d")!.drawImage(cachedCanvas, 0, 0);
      return clonedCanvas;
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
      return structureCanvas;
    }
    context.drawImage(
      this.getImageColored(structureInfo.image, borderColor),
      4,
      4,
    );
    this.nodeCache.set(cacheKey, structureCanvas);
    return structureCanvas;
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

  private clearStructure(render: StructureRenderInfo) {
    if (render.location) {
      this.context.clearRect(
        render.location.x - 1 - render.imageData.width / 2,
        render.location.y - 1 - render.imageData.height / 2,
        render.imageData.width + 2,
        render.imageData.height + 2,
      );
    }
  }

  private computeNewLocation(render: StructureRenderInfo) {
    // Compute screen position with vertical offset
    const tile = render.unit.tile();
    const worldX = this.game.x(tile);
    const worldY = this.game.y(tile);
    const screenPos = this.transformHandler.worldToScreenCoordinates(
      new Cell(worldX, worldY),
    );
    screenPos.y -= this.transformHandler.scale * 8;
    render.location = { x: screenPos.x, y: screenPos.y };
  }

  private deleteStructure(render: StructureRenderInfo) {
    this.clearStructure(render);
    this.renders = this.renders.filter((r) => r.unit !== render.unit);
    this.seenUnits.delete(render.unit);
  }

  private renderStructure(render: StructureRenderInfo, scale: number) {
    if (render.location) {
      this.context.drawImage(
        render.imageData,
        Math.round(
          render.location.x * (1 / scale) - render.imageData.width / 2,
        ),
        Math.round(
          render.location.y * (1 / scale) - render.imageData.height / 2,
        ),
      );
    }
  }
}
