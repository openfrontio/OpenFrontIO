import { colord, Colord } from "colord";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

import cityIcon from "../../../../resources/non-commercial/images/buildings/cityAlt1.png";
import factoryIcon from "../../../../resources/non-commercial/images/buildings/factoryAlt1.png";
import shieldIcon from "../../../../resources/non-commercial/images/buildings/fortAlt3.png";
import anchorIcon from "../../../../resources/non-commercial/images/buildings/port1.png";
import missileSiloIcon from "../../../../resources/non-commercial/images/buildings/silo1.png";
import SAMMissileIcon from "../../../../resources/non-commercial/images/buildings/silo4.png";
import { Cell, UnitType } from "../../../core/game/Game";
import { euclDistFN, isometricDistFN } from "../../../core/game/GameMap";
import { GameView, UnitView } from "../../../core/game/GameView";

const underConstructionColor = colord({ r: 150, g: 150, b: 150 });

// Base radius values and scaling factor for unit borders and territories
const BASE_BORDER_RADIUS = 16.5;
const BASE_TERRITORY_RADIUS = 13.5;
const RADIUS_SCALE_FACTOR = 0.5;
const ZOOM_THRESHOLD = 3.5; // below this zoom level, structures are not rendered

// SAM launcher visual constants
const SAM_PROTECTION_RADIUS = 50; // MIRVWarheadProtectionRadius from game logic
const SAM_CIRCLE_COLOR = "#ff00ff"; // Magenta for high visibility
const SAM_DASH_PATTERN = [6, 6];
const SAM_LINE_WIDTH = 2;

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
      this.loadIcon(unitType, config as UnitRenderConfig);
    });
  }

  shouldTransform(): boolean {
    return true;
  }

  // ------------------
  // NEW: ensure outdated visuals (e.g., SAM radius) are cleared every tick
  //       by wiping the canvas first, then redrawing all current units.
  // ------------------
  tick() {
    // Clear everything previously rendered so stale graphics disappear
    if (this.context) {
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // Draw a fresh frame with the current game state
    this.game.units().forEach((u) => this.handleUnitRendering(u));
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
    this.game.units().forEach((u) => this.handleUnitRendering(u));
  }

  structureSamRadiusColor(): string {
    return SAM_CIRCLE_COLOR;
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (this.transformHandler.scale <= ZOOM_THRESHOLD) {
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
          : this.theme.territoryColor(unit.owner()),
        130,
      );
    }
  }

  private drawSamRadius(unit: UnitView) {
    const ctx = this.context;
    const centerX = this.game.x(unit.tile()) * 2 + 1;
    const centerY = this.game.y(unit.tile()) * 2 + 1;
    const tileToPx = 2;
    const radius = SAM_PROTECTION_RADIUS * tileToPx; // 50 is MIRVWarheadProtectionRadius

    ctx.save();
    ctx.setLineDash(SAM_DASH_PATTERN);
    ctx.lineWidth = SAM_LINE_WIDTH;
    ctx.strokeStyle = SAM_CIRCLE_COLOR;

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  // ------------------
  // NEW: centralized toggle helper to decide whether to show SAM radius
  // ------------------
  private shouldDrawSamRadius(unit: UnitView): boolean {
    return (
      unit.type() === UnitType.SAMLauncher &&
      unit.isActive() &&
      this.transformHandler.scale >= ZOOM_THRESHOLD
    );
  }

  private handleUnitRendering(unit: UnitView) {
    const unitType = unit.constructionType() ?? unit.type();
    const iconType = unitType;
    if (!this.isUnitTypeSupported(unitType)) return;

    const config = this.unitConfigs[unitType] as UnitRenderConfig;
    let icon: HTMLImageElement | undefined;
    let borderColor = this.theme.borderColor(unit.owner());

    if (unit.type() === UnitType.Construction) {
      icon = this.unitIcons.get(iconType);
      borderColor = underConstructionColor;
    } else {
      icon = this.unitIcons.get(iconType);
    }

    if (!config || !icon) return;

    // Always clear the border area for this unit
    for (const tile of this.game.bfs(
      unit.tile(),
      euclDistFN(unit.tile(), config.borderRadius + 1, true),
    )) {
      this.clearCell(new Cell(this.game.x(tile), this.game.y(tile)));
    }

    if (!unit.isActive()) return;

    this.drawBorder(unit, borderColor, config);

    // Draw magenta radius for active SAMLauncher when appropriate
    if (this.shouldDrawSamRadius(unit)) {
      this.drawSamRadius(unit);
    }

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
    let color = this.theme.borderColor(unit.owner());
    if (unit.type() === UnitType.Construction) {
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
