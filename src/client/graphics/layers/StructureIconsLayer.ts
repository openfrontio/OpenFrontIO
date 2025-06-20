import { Theme } from "../../../core/configuration/Config";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

import anchorIcon from "../../../../resources/images/AnchorIcon.png";
import cityIcon from "../../../../resources/images/CityIcon.png";
import missileSiloIcon from "../../../../resources/images/MissileSiloUnit.png";
import shieldIcon from "../../../../resources/images/ShieldIcon.png";
import SAMMissileIcon from "../../../../resources/images/SwordIconWhite.png";
import { Cell, UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";

class StructureRenderInfo {
  constructor(
    public unit: UnitView,
    public location: Cell | null,
    public imageData: HTMLCanvasElement,
  ) {}
}

const ICON_SIZE = 22;

export class StructureIconsLayer implements Layer {
  private canvas: HTMLCanvasElement;
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
          new StructureRenderInfo(unit, null, this.createUnitElement(unit)),
        );
      }
    }

    const updates = this.game.updatesSinceLastTick();
    const unitUpdates = updates !== null ? updates[GameUpdateType.Unit] : [];
    for (const u of unitUpdates) {
      const unit = this.game.unit(u.id);
      if (
        unit === undefined ||
        !this.seenUnits.has(unit) ||
        !this.structures.has(unit.type()) ||
        !unit.isActive()
      )
        continue;

      const render = this.renders.find((r) => r.unit === unit);
      if (render) {
        render.imageData = this.createUnitElement(unit);
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
      this.clearStructure(render);
    }
    for (const render of this.renders) {
      this.renderStructure(render, mainContext);
    }
    mainContext.save();
    mainContext.imageSmoothingEnabled = false;
    mainContext.drawImage(this.canvas, 0, 0);
    mainContext.restore();
  }

  private createUnitElement(unit: UnitView): HTMLCanvasElement {
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
    return structureCanvas;
  }

  clearStructure(render: StructureRenderInfo) {
    if (render.location) {
      this.context.clearRect(
        render.location.x - 1 - render.imageData.width / 2,
        render.location.y - 1 - render.imageData.height / 2,
        ICON_SIZE + 1,
        ICON_SIZE + 1,
      );
    }
  }

  renderStructure(render: StructureRenderInfo, ctx: CanvasRenderingContext2D) {
    if (!render.unit.isActive()) {
      this.renders = this.renders.filter((r) => r !== render);
      this.seenUnits.delete(render.unit);
      this.clearStructure(render);
      return;
    }

    const oldLocation = render.location;
    const loc = this.transformHandler.worldToScreenCoordinates(
      new Cell(
        this.game.x(render.unit.tile()),
        this.game.y(render.unit.tile()),
      ),
    );

    // Screen space calculations
    const size = this.transformHandler.scale;
    loc.y -= size * 7;

    render.location = new Cell(loc.x, loc.y);
    const canvasRect = this.transformHandler.boundingRect();
    if (
      render.location.x < canvasRect.left ||
      render.location.y < canvasRect.top ||
      render.location.x > canvasRect.right ||
      render.location.y > canvasRect.bottom
    ) {
      return;
    }

    if (
      render.location &&
      (!oldLocation ||
        render.location.x !== oldLocation.x ||
        render.location.y !== oldLocation.y)
    ) {
      const scale = Math.min(1, this.transformHandler.scale * 1.3);

      this.context.save();
      this.context.scale(scale, scale);
      this.context.drawImage(
        render.imageData,
        render.location.x * (1 / scale) - render.imageData.width / 2,
        render.location.y * (1 / scale) - render.imageData.height / 2,
      );
      this.context.restore();
    }
  }
}
