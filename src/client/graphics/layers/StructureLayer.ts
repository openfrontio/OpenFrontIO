import { colord } from "colord";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

import { Cell, UnitType } from "../../../core/game/Game";
import { isometricDistFN } from "../../../core/game/GameMap";
import { GameView, UnitView } from "../../../core/game/GameView";
import cityIcon from "/images/buildings/cityAlt1.png?url";
import factoryIcon from "/images/buildings/factoryAlt1.png?url";
import shieldIcon from "/images/buildings/fortAlt3.png?url";
import anchorIcon from "/images/buildings/port1.png?url";
import missileSiloIcon from "/images/buildings/silo1.png?url";
import SAMMissileIcon from "/images/buildings/silo4.png?url";

const underConstructionColor = colord("rgb(150,150,150)");

const RADIUS_SCALE_FACTOR = 0.5;
const ZOOM_THRESHOLD = 4.3;

interface UnitRenderConfig {
  icon: string;
  borderRadius: number;
  territoryRadius: number;
}

interface CachedStructureTiles {
  border: Cell[];
  territory: Cell[];
}

export class StructureLayer implements Layer {
  private unitIcons: Map<string, HTMLImageElement> = new Map();
  private theme: Theme;
  private tempCanvas: HTMLCanvasElement;
  private tempContext: CanvasRenderingContext2D;

  // Cache the computed tiles for each structure
  private tileCache = new Map<number, CachedStructureTiles>();

  private readonly unitConfigs: Partial<Record<UnitType, UnitRenderConfig>> = {
    [UnitType.Port]: {
      icon: anchorIcon,
      borderRadius: 16.5 * RADIUS_SCALE_FACTOR,
      territoryRadius: 13.5 * RADIUS_SCALE_FACTOR,
    },
    [UnitType.City]: {
      icon: cityIcon,
      borderRadius: 16.5 * RADIUS_SCALE_FACTOR,
      territoryRadius: 13.5 * RADIUS_SCALE_FACTOR,
    },
    [UnitType.Factory]: {
      icon: factoryIcon,
      borderRadius: 16.5 * RADIUS_SCALE_FACTOR,
      territoryRadius: 13.5 * RADIUS_SCALE_FACTOR,
    },
    [UnitType.MissileSilo]: {
      icon: missileSiloIcon,
      borderRadius: 16.5 * RADIUS_SCALE_FACTOR,
      territoryRadius: 13.5 * RADIUS_SCALE_FACTOR,
    },
    [UnitType.DefensePost]: {
      icon: shieldIcon,
      borderRadius: 16.5 * RADIUS_SCALE_FACTOR,
      territoryRadius: 13.5 * RADIUS_SCALE_FACTOR,
    },
    [UnitType.SAMLauncher]: {
      icon: SAMMissileIcon,
      borderRadius: 16.5 * RADIUS_SCALE_FACTOR,
      territoryRadius: 13.5 * RADIUS_SCALE_FACTOR,
    },
  };

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
    this.tempCanvas = document.createElement("canvas");
    const tempContext = this.tempCanvas.getContext("2d");
    if (tempContext === null) throw new Error("2d context not supported");
    this.tempContext = tempContext;
    this.loadIconData();
  }

  private loadIconData() {
    Object.entries(this.unitConfigs).forEach(([unitType, config]) => {
      const image = new Image();
      image.src = config.icon;
      image.onload = () => this.unitIcons.set(unitType, image);
    });
  }

  shouldTransform(): boolean {
    return true;
  }
  tick() {
    // Clear cache for units that are no longer in the game or inactive
    for (const id of this.tileCache.keys()) {
      const unit = this.game.unit(id);
      if (!unit || !unit.isActive()) {
        this.tileCache.delete(id);
      }
    }
  }
  init() {}
  redraw() {
    this.tileCache.clear();
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (
      this.transformHandler.scale <= ZOOM_THRESHOLD ||
      !this.game.config().userSettings()?.structureSprites()
    ) {
      return;
    }

    const [topLeft, bottomRight] = this.transformHandler.screenBoundingRect();
    const visLeft = topLeft.x - 30;
    const visTop = topLeft.y - 30;
    const visRight = bottomRight.x + 30;
    const visBottom = bottomRight.y + 30;

    const offsetX = -this.game.width() / 2;
    const offsetY = -this.game.height() / 2;

    for (const unit of this.game.units()) {
      if (!this.isUnitTypeSupported(unit.type()) || !unit.isActive()) continue;

      const ux = this.game.x(unit.tile());
      const uy = this.game.y(unit.tile());

      if (ux < visLeft || ux > visRight || uy < visTop || uy > visBottom)
        continue;

      this.renderStructure(context, unit, offsetX, offsetY);
    }
  }

  private isUnitTypeSupported(unitType: UnitType): boolean {
    return unitType in this.unitConfigs;
  }

  private getCachedTiles(
    unit: UnitView,
    config: UnitRenderConfig,
  ): CachedStructureTiles {
    if (this.tileCache.has(unit.id())) {
      return this.tileCache.get(unit.id())!;
    }

    const border: Cell[] = [];
    const territory: Cell[] = [];

    this.game
      .bfs(unit.tile(), isometricDistFN(unit.tile(), config.borderRadius, true))
      .forEach((t) => border.push(new Cell(this.game.x(t), this.game.y(t))));

    this.game
      .bfs(
        unit.tile(),
        isometricDistFN(unit.tile(), config.territoryRadius, true),
      )
      .forEach((t) => territory.push(new Cell(this.game.x(t), this.game.y(t))));

    const cache = { border, territory };
    this.tileCache.set(unit.id(), cache);
    return cache;
  }

  private renderStructure(
    context: CanvasRenderingContext2D,
    unit: UnitView,
    offsetX: number,
    offsetY: number,
  ) {
    const config = this.unitConfigs[unit.type()]!;
    const icon = this.unitIcons.get(unit.type());
    if (!icon) return;

    const tiles = this.getCachedTiles(unit, config);
    const borderColor = unit.isUnderConstruction()
      ? underConstructionColor
      : unit.owner().borderColor();
    const territoryColor = unit.isUnderConstruction()
      ? underConstructionColor
      : unit.owner().territoryColor();

    context.save();
    context.scale(0.5, 0.5);

    // Draw cached border
    context.fillStyle = borderColor.toRgbString();
    for (const cell of tiles.border) {
      context.fillRect((cell.x + offsetX) * 2, (cell.y + offsetY) * 2, 2, 2);
    }

    // Draw cached territory
    context.fillStyle = territoryColor.alpha(130 / 255).toRgbString();
    for (const cell of tiles.territory) {
      context.fillRect((cell.x + offsetX) * 2, (cell.y + offsetY) * 2, 2, 2);
    }

    // Render icon
    const scaledWidth = icon.width >> 1;
    const scaledHeight = icon.height >> 1;
    const startX = this.game.x(unit.tile()) - (scaledWidth >> 1) + offsetX;
    const startY = this.game.y(unit.tile()) - (scaledHeight >> 1) + offsetY;

    this.drawIconToContext(
      context,
      icon,
      startX,
      startY - 4,
      scaledWidth,
      scaledHeight,
    );

    context.restore();
  }

  private drawIconToContext(
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement,
    startX: number,
    startY: number,
    width: number,
    height: number,
  ) {
    if (
      this.tempCanvas.width !== width * 2 ||
      this.tempCanvas.height !== height * 2
    ) {
      this.tempCanvas.width = width * 2;
      this.tempCanvas.height = height * 2;
    }
    this.tempContext.clearRect(0, 0, width * 2, height * 2);
    this.tempContext.drawImage(image, 0, 0, width * 2, height * 2);
    this.tempContext.globalCompositeOperation = "destination-in";
    this.tempContext.drawImage(image, 0, 0, width * 2, height * 2);
    this.tempContext.globalCompositeOperation = "source-over";

    ctx.drawImage(this.tempCanvas, startX * 2, startY * 2);
  }
}
