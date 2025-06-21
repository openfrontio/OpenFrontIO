import { Theme } from "../../../core/configuration/Config";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

import anchorIcon from "../../../../resources/images/AnchorIcon.png";
import cityIcon from "../../../../resources/images/CityIcon.png";
import missileSiloIcon from "../../../../resources/images/MissileSiloUnit.png";
import shieldIcon from "../../../../resources/images/ShieldIcon.png";
import SAMMissileIcon from "../../../../resources/images/SwordIconWhite.png";
import { Cell, PlayerID, UnitType } from "../../../core/game/Game";
import { GameView, UnitView } from "../../../core/game/GameView";

class StructureRenderInfo {
  constructor(
    public unit: UnitView,
    public oldLocation: Cell | null,
    public location: Cell | null,
    public owner: PlayerID,
    public imageData: HTMLCanvasElement,
    public shouldRedraw: boolean = true,
  ) {}
}

const ICON_SIZE = 22;

export class StructureIconsLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private nodeCache: Map<{ owner: string; type: UnitType }, HTMLCanvasElement> =
    new Map();
  private context: CanvasRenderingContext2D;
  private theme: Theme;
  private renders: StructureRenderInfo[] = [];
  public scale: number = 1.8;
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
    this.redraw();
  }

  public tick() {
    for (const unit of this.game.units()) {
      if (
        unit.isActive() &&
        this.structures.has(unit.type()) &&
        !this.seenUnits.has(unit)
      ) {
        this.seenUnits.add(unit);
        this.renders.push(
          new StructureRenderInfo(
            unit,
            null,
            null,
            unit.owner().id(),
            this.createUnitElement(unit),
          ),
        );
      }
    }
  }

  redraw() {
    console.log("structureIcons layer redrawing");
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext("2d", { alpha: true });
    if (context === null) throw new Error("2d context not supported");
    this.context = context;
    // Enable smooth scaling
    this.context.imageSmoothingEnabled = false;

    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
  }

  public renderLayer(mainContext: CanvasRenderingContext2D) {
    if (this.transformHandler.scale > 2) {
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    for (const render of this.renders) {
      this.computeRenderInfos(render);
    }

    // clear first
    for (const render of this.renders) {
      if (render.shouldRedraw) {
        this.clearStructure(render);
      }
    }

    // draw after
    for (const render of this.renders) {
      if (render.shouldRedraw) {
        const canvasRect = this.transformHandler.boundingRect();
        if (
          !render.location ||
          render.location.x < canvasRect.left ||
          render.location.y < canvasRect.top ||
          render.location.x > canvasRect.right ||
          render.location.y > canvasRect.bottom
        ) {
          continue;
        }
        this.renderStructure(render);
      }
    }
    mainContext.drawImage(this.canvas, 0, 0);
  }

  private createUnitElement(unit: UnitView): HTMLCanvasElement {
    if (this.nodeCache.has({ owner: unit.owner().id(), type: unit.type() })) {
      return this.nodeCache
        .get({ owner: unit.owner().id(), type: unit.type() })
        ?.cloneNode() as HTMLCanvasElement;
    }
    const structureCanvas = document.createElement("canvas");
    structureCanvas.width = ICON_SIZE;
    structureCanvas.height = ICON_SIZE;
    const context = structureCanvas.getContext("2d")!;
    context.imageSmoothingEnabled = false;
    context.fillStyle = this.theme
      .territoryColor(unit.owner())
      .lighten(0.1)
      .toRgbString();
    context.strokeStyle = this.theme
      .borderColor(unit.owner())
      .darken(0.1)
      .toRgbString();
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
      console.warn(`SVG not loaded for unit type: ${unit.type()}`);
      return structureCanvas;
    }
    context.drawImage(structureInfo.image, ICON_SIZE / 3, ICON_SIZE / 3);
    this.nodeCache.set(
      { owner: unit.owner().id(), type: unit.type() },
      structureCanvas,
    );
    return structureCanvas;
  }

  clearStructure(render: StructureRenderInfo) {
    if (render.oldLocation) {
      this.context.clearRect(
        render.oldLocation.x - 1 - render.imageData.width / 2,
        render.oldLocation.y - 1 - render.imageData.height / 2,
        ICON_SIZE + 1,
        ICON_SIZE + 1,
      );
    }
  }

  computeRenderInfos(render: StructureRenderInfo) {
    const unit = render.unit;

    if (!unit.isActive()) {
      this.renders = this.renders.filter((r) => r !== render);
      this.seenUnits.delete(unit);
      this.clearStructure(render);
      return;
    }

    const tile = unit.tile();
    const screenPos = this.transformHandler.worldToScreenCoordinates(
      new Cell(this.game.x(tile), this.game.y(tile)),
    );
    const oldScale = this.scale;
    this.scale = this.transformHandler.scale;
    screenPos.y -= this.scale * 8;

    const oldLocation = render.location;
    const ownerId = unit.owner().id();

    const hasMoved =
      !oldLocation ||
      oldLocation.x !== screenPos.x ||
      oldLocation.y !== screenPos.y;

    if (render.location) {
      render.oldLocation = new Cell(render.location.x, render.location.y);
    } else {
      // first pass
      render.oldLocation = new Cell(screenPos.x, screenPos.y);
    }

    const hasScaleChanged = this.scale !== oldScale;
    const hasOwnerChanged = render.owner !== ownerId;

    const shouldRedraw = hasMoved || hasScaleChanged || hasOwnerChanged;
    render.shouldRedraw = shouldRedraw;

    if (!shouldRedraw) return;

    if (hasOwnerChanged) {
      render.owner = ownerId;
      render.imageData = this.createUnitElement(unit);
    }

    render.location = new Cell(screenPos.x, screenPos.y);
  }

  renderStructure(render: StructureRenderInfo) {
    if (render.location) {
      const scaleCapped = Math.min(1, this.scale * 1.3);
      this.context.save();
      this.context.scale(scaleCapped, scaleCapped);
      this.context.drawImage(
        render.imageData,
        Math.round(
          render.location.x * (1 / scaleCapped) - render.imageData.width / 2,
        ),
        Math.round(
          render.location.y * (1 / scaleCapped) - render.imageData.height / 2,
        ),
      );
      this.context.restore();
    }
  }
}
