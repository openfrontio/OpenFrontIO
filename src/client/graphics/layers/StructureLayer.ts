import { colord, Colord } from "colord";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

import cityIcon from "../../../../resources/images/buildings/cityAlt1.png";
import factoryIcon from "../../../../resources/images/buildings/factoryAlt1.png";
import shieldIcon from "../../../../resources/images/buildings/fortAlt3.png";
import anchorIcon from "../../../../resources/images/buildings/port1.png";
import missileSiloIcon from "../../../../resources/images/buildings/silo1.png";
import SAMMissileIcon from "../../../../resources/images/buildings/silo4.png";
import { Cell, UnitType } from "../../../core/game/Game";
import { euclDistFN, isometricDistFN } from "../../../core/game/GameMap";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";

const underConstructionColor = colord({ r: 150, g: 150, b: 150 });

// Base radius values and scaling factor for unit borders and territories
const BASE_BORDER_RADIUS = 16.5;
const BASE_TERRITORY_RADIUS = 13.5;
const RADIUS_SCALE_FACTOR = 0.5;
const ZOOM_THRESHOLD = 4.3; // below this zoom level, structures are not rendered

interface UnitRenderConfig {
  icon: string;
  borderRadius: number;
  territoryRadius: number;
}

export class StructureLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private unitIcons: Map<string, HTMLImageElement> = new Map();
  private theme: Theme;
  private tempCanvas: HTMLCanvasElement;
  private tempContext: CanvasRenderingContext2D;

  // Configuration for supported unit types only
  private readonly unitConfigs: Partial<Record<UnitType, UnitRenderConfig>> = {
    [UnitType.Port]: {
      icon: anchorIcon,
      borderRadius: BASE_BORDER_RADIUS * RADIUS_SCALE_FACTOR,
      territoryRadius: BASE_TERRITORY_RADIUS * RADIUS_SCALE_FACTOR,
    },
    [UnitType.City]: {
      icon: cityIcon,
      borderRadius: BASE_BORDER_RADIUS * RADIUS_SCALE_FACTOR,
      territoryRadius: BASE_TERRITORY_RADIUS * RADIUS_SCALE_FACTOR,
    },
    [UnitType.Factory]: {
      icon: factoryIcon,
      borderRadius: BASE_BORDER_RADIUS * RADIUS_SCALE_FACTOR,
      territoryRadius: BASE_TERRITORY_RADIUS * RADIUS_SCALE_FACTOR,
    },
    [UnitType.MissileSilo]: {
      icon: missileSiloIcon,
      borderRadius: BASE_BORDER_RADIUS * RADIUS_SCALE_FACTOR,
      territoryRadius: BASE_TERRITORY_RADIUS * RADIUS_SCALE_FACTOR,
    },
    [UnitType.DefensePost]: {
      icon: shieldIcon,
      borderRadius: BASE_BORDER_RADIUS * RADIUS_SCALE_FACTOR,
      territoryRadius: BASE_TERRITORY_RADIUS * RADIUS_SCALE_FACTOR,
    },
    [UnitType.SAMLauncher]: {
      icon: SAMMissileIcon,
      borderRadius: BASE_BORDER_RADIUS * RADIUS_SCALE_FACTOR,
      territoryRadius: BASE_TERRITORY_RADIUS * RADIUS_SCALE_FACTOR,
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

  private loadIcon(unitType: string, config: UnitRenderConfig) {
    const image = new Image();
    image.src = config.icon;
    image.onload = () => {
      this.unitIcons.set(unitType, image);
      console.log(
        `icon loaded: ${unitType}, size: ${image.width}x${image.height}`,
      );
    };
    image.onerror = () => {
      console.error(`Failed to load icon for ${unitType}: ${config.icon}`);
    };
  }

  private loadIconData() {
    Object.entries(this.unitConfigs).forEach(([unitType, config]) => {
      this.loadIcon(unitType, config);
    });
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    const updates = this.game.updatesSinceLastTick();
    const unitUpdates = updates !== null ? updates[GameUpdateType.Unit] : [];
    for (const u of unitUpdates) {
      const unit = this.game.unit(u.id);
      if (unit === undefined) continue;
      this.handleUnitRendering(unit);
    }
  }

  init() {
    this.redraw();
  }

  redraw() {
    console.log("structure layer redrawing");
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext("2d", { alpha: true });
    if (context === null) throw new Error("2d context not supported");
    this.context = context;

    // Enable smooth scaling
    this.context.imageSmoothingEnabled = true;
    this.context.imageSmoothingQuality = "high";

    this.canvas.width = this.game.width() * 2;
    this.canvas.height = this.game.height() * 2;

    Promise.all(
      Array.from(this.unitIcons.values()).map((img) =>
        img.decode?.().catch((err) => {
          console.warn("Failed to decode unit icon image:", err);
        }),
      ),
    ).finally(() => {
      this.game.units().forEach((u) => this.handleUnitRendering(u));
    });
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (
      this.transformHandler.scale <= ZOOM_THRESHOLD ||
      !this.game.config().userSettings()?.structureSprites()
    ) {
      return;
    }
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }

  private isUnitTypeSupported(unitType: UnitType): boolean {
    return unitType in this.unitConfigs;
  }

  private drawBorder(
    unit: UnitView,
    borderColor: Colord,
    config: UnitRenderConfig,
  ) {
    // Draw border and territory
    for (const tile of this.game.bfs(
      unit.tile(),
      isometricDistFN(unit.tile(), config.borderRadius, true),
    )) {
      this.paintCell(
        new Cell(this.game.x(tile), this.game.y(tile)),
        borderColor,
        255,
      );
    }

    for (const tile of this.game.bfs(
      unit.tile(),
      isometricDistFN(unit.tile(), config.territoryRadius, true),
    )) {
      this.paintCell(
        new Cell(this.game.x(tile), this.game.y(tile)),
        unit.type() === UnitType.Construction
          ? underConstructionColor
          : unit.owner().territoryColor(),
        130,
      );
    }
  }

  private handleUnitRendering(unit: UnitView) {
    const unitType = unit.constructionType() ?? unit.type();
    const iconType = unitType;
    if (!this.isUnitTypeSupported(unitType)) return;

    const config = this.unitConfigs[unitType];
    let icon: HTMLImageElement | undefined;
    let borderColor = unit.owner().borderColor();

    // Handle cooldown states and special icons
    if (unit.type() === UnitType.Construction) {
      icon = this.unitIcons.get(iconType);
      borderColor = underConstructionColor;
    } else {
      icon = this.unitIcons.get(iconType);
    }

    if (!config || !icon) return;

    // Clear previous rendering
    for (const tile of this.game.bfs(
      unit.tile(),
      euclDistFN(unit.tile(), config.borderRadius + 1, true),
    )) {
      this.clearCell(new Cell(this.game.x(tile), this.game.y(tile)));
    }

    if (!unit.isActive()) return;

    this.drawBorder(unit, borderColor, config);

    // Render icon at 1/2 scale for better quality
    const scaledWidth = icon.width >> 1;
    const scaledHeight = icon.height >> 1;
    const startX = this.game.x(unit.tile()) - (scaledWidth >> 1);
    const startY = this.game.y(unit.tile()) - (scaledHeight >> 1);

    this.renderIcon(icon, startX, startY - 4, scaledWidth, scaledHeight, unit);
  }

  private renderIcon(
    image: HTMLImageElement,
    startX: number,
    startY: number,
    width: number,
    height: number,
    unit: UnitView,
  ) {
    let color = unit.owner().borderColor();
    if (unit.type() === UnitType.Construction) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      color = underConstructionColor;
    }

    // Make temp canvas at the final render size (2x scale)
    this.tempCanvas.width = width * 2;
    this.tempCanvas.height = height * 2;

    // Enable smooth scaling
    this.tempContext.imageSmoothingEnabled = true;
    this.tempContext.imageSmoothingQuality = "high";

    // Draw the image at final size with high quality scaling
    this.tempContext.drawImage(image, 0, 0, width * 2, height * 2);

    // Restore the alpha channel
    this.tempContext.globalCompositeOperation = "destination-in";
    this.tempContext.drawImage(image, 0, 0, width * 2, height * 2);

    // Draw the final result to the main canvas
    this.context.drawImage(this.tempCanvas, startX * 2, startY * 2);
  }

  paintCell(cell: Cell, color: Colord, alpha: number) {
    this.clearCell(cell);
    this.context.fillStyle = color.alpha(alpha / 255).toRgbString();
    this.context.fillRect(cell.x * 2, cell.y * 2, 2, 2);
  }

  clearCell(cell: Cell) {
    this.context.clearRect(cell.x * 2, cell.y * 2, 2, 2);
  }
}
