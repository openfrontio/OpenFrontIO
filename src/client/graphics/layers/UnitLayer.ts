import { colord, Colord } from "colord";
import { EventBus } from "../../../core/EventBus";
import { Theme } from "../../../core/configuration/Config";
import { UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, UnitView } from "../../../core/game/GameView";
import { BezenhamLine } from "../../../core/utilities/Line";
import {
  AlternateViewEvent,
  ContextMenuEvent,
  MouseUpEvent,
  TouchEvent,
  UnitSelectionEvent,
} from "../../InputHandler";
import { MoveWarshipIntentEvent } from "../../Transport";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

import { GameUpdateType } from "../../../core/game/GameUpdates";
import {
  getColoredSprite,
  isSpriteReady,
  loadAllSprites,
} from "../SpriteLoader";

enum Relationship {
  Self,
  Ally,
  Enemy,
}

export class UnitLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private transportShipTrailCanvas: HTMLCanvasElement;
  private unitTrailContext: CanvasRenderingContext2D;

  private unitToTrail = new Map<UnitView, TileRef[]>();

  private theme: Theme;

  private alternateView = false;

  private oldShellTile = new Map<UnitView, TileRef>();

  private transformHandler: TransformHandler;

  private reindeerImage: ImageBitmap | null = null;
  private presentImage: ImageBitmap | null = null;
  private santaImage: ImageBitmap | null = null;

  // Selected unit property as suggested in the review comment
  private selectedUnit: UnitView | null = null;

  // Configuration for unit selection
  private readonly WARSHIP_SELECTION_RADIUS = 10; // Radius in game cells for warship selection hit zone

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
    this.transformHandler = transformHandler;
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    const unitIds = this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.Unit]?.map((unit) => unit.id);

    this.updateUnitsSprites(unitIds ?? []);
  }

  init() {
    this.eventBus.on(AlternateViewEvent, (e) => this.onAlternativeViewEvent(e));
    this.eventBus.on(MouseUpEvent, (e) => this.onMouseUp(e));
    this.eventBus.on(TouchEvent, (e) => this.onTouch(e));
    this.eventBus.on(UnitSelectionEvent, (e) => this.onUnitSelectionChange(e));
    this.initializeAssetsAndRedraw().catch((error) =>
      console.error("Error in async initialization:", error),
    ); // Call the async method without awaiting
  }

  /**
   * Find player-owned warships near the given cell within a configurable radius
   * @param clickRef The tile to check
   * @returns Array of player's warships in range, sorted by distance (closest first)
   */
  private findWarshipsNearCell(clickRef: TileRef): UnitView[] {
    // Only select warships owned by the player
    return this.game
      .units(UnitType.Warship)
      .filter(
        (unit) =>
          unit.isActive() &&
          unit.owner() === this.game.myPlayer() && // Only allow selecting own warships
          this.game.manhattanDist(unit.tile(), clickRef) <=
            this.WARSHIP_SELECTION_RADIUS,
      )
      .sort((a, b) => {
        // Sort by distance (closest first)
        const distA = this.game.manhattanDist(a.tile(), clickRef);
        const distB = this.game.manhattanDist(b.tile(), clickRef);
        return distA - distB;
      });
  }

  private onMouseUp(
    event: MouseUpEvent,
    clickRef?: TileRef,
    nearbyWarships?: UnitView[],
  ) {
    if (clickRef === undefined) {
      // Convert screen coordinates to world coordinates
      const cell = this.transformHandler.screenToWorldCoordinates(
        event.x,
        event.y,
      );
      if (!this.game.isValidCoord(cell.x, cell.y)) return;

      clickRef = this.game.ref(cell.x, cell.y);
    }
    if (!this.game.isOcean(clickRef)) return;

    if (this.selectedUnit) {
      this.eventBus.emit(
        new MoveWarshipIntentEvent(this.selectedUnit.id(), clickRef),
      );
      // Deselect
      this.eventBus.emit(new UnitSelectionEvent(this.selectedUnit, false));
      return;
    }

    // Find warships near this tile, sorted by distance
    nearbyWarships ??= this.findWarshipsNearCell(clickRef);
    if (nearbyWarships.length > 0) {
      // Toggle selection of the closest warship
      this.eventBus.emit(new UnitSelectionEvent(nearbyWarships[0], true));
    }
  }

  private onTouch(event: TouchEvent) {
    const cell = this.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );

    const clickRef = this.game.ref(cell.x, cell.y);
    if (!this.game.isOcean(clickRef)) {
      // No isValidCoord/Ref check yet, that is done for ContextMenuEvent later
      // No warship to find because no Ocean tile, open Radial Menu
      this.eventBus.emit(new ContextMenuEvent(event.x, event.y));
      return;
    }

    if (!this.game.isValidRef(clickRef)) {
      return;
    }

    if (this.selectedUnit) {
      // Reuse the mouse logic, send clickRef to avoid fetching it again
      this.onMouseUp(new MouseUpEvent(event.x, event.y), clickRef);
      return;
    }

    const nearbyWarships = this.findWarshipsNearCell(clickRef);

    if (nearbyWarships.length > 0) {
      this.onMouseUp(
        new MouseUpEvent(event.x, event.y),
        clickRef,
        nearbyWarships,
      );
    } else {
      // No warships selected or nearby, open Radial Menu
      this.eventBus.emit(new ContextMenuEvent(event.x, event.y));
    }
  }

  /**
   * Handle unit selection changes
   */
  private onUnitSelectionChange(event: UnitSelectionEvent) {
    if (event.isSelected) {
      this.selectedUnit = event.unit;
    } else if (this.selectedUnit === event.unit) {
      this.selectedUnit = null;
    }
  }

  /**
   * Handle unit deactivation or destruction
   * If the selected unit is removed from the game, deselect it
   */
  private handleUnitDeactivation(unit: UnitView) {
    if (this.selectedUnit === unit && !unit.isActive()) {
      this.eventBus.emit(new UnitSelectionEvent(unit, false));
    }
  }

  private async loadPngs() {
    const loadImage = async (url: string): Promise<ImageBitmap> => {
      const img = new Image();
      img.src = url;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (err) => reject(err);
      });
      return createImageBitmap(img);
    };

    try {
      this.reindeerImage = await loadImage(
        "../../../resources/sprites/reindeer.png",
      );
      this.presentImage = await loadImage(
        "../../../resources/sprites/present.png",
      );
      this.santaImage = await loadImage("../../../resources/sprites/santa.png");
      console.log("Custom PNGs loaded successfully.");
    } catch (error) {
      console.error("Failed to load custom PNGs:", error);
    }
  }

  private async initializeAssetsAndRedraw() {
    try {
      await this.loadPngs();
      await loadAllSprites();
      this.redraw();
    } catch (error) {
      console.error("Initialization of assets and redraw failed:", error);
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    context.drawImage(
      this.transportShipTrailCanvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }

  onAlternativeViewEvent(event: AlternateViewEvent) {
    this.alternateView = event.alternateView;
    this.redraw();
  }

  redraw() {
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext("2d");
    if (context === null) throw new Error("2d context not supported");
    this.context = context;
    this.transportShipTrailCanvas = document.createElement("canvas");
    const trailContext = this.transportShipTrailCanvas.getContext("2d");
    if (trailContext === null) throw new Error("2d context not supported");
    this.unitTrailContext = trailContext;

    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
    this.transportShipTrailCanvas.width = this.game.width();
    this.transportShipTrailCanvas.height = this.game.height();

    this.updateUnitsSprites(this.game.units().map((unit) => unit.id()));

    this.unitToTrail.forEach((trail, unit) => {
      for (const t of trail) {
        this.paintCell(
          this.game.x(t),
          this.game.y(t),
          this.relationship(unit),
          unit.owner().territoryColor(),
          150,
          this.unitTrailContext,
        );
      }
    });
  }

  private updateUnitsSprites(unitIds: number[]) {
    const unitsToUpdate = unitIds
      ?.map((id) => this.game.unit(id))
      .filter((unit) => unit !== undefined);

    if (unitsToUpdate) {
      // the clearing and drawing of unit sprites need to be done in 2 passes
      // otherwise the sprite of a unit can be drawn on top of another unit
      this.clearUnitsCells(unitsToUpdate);
      this.drawUnitsCells(unitsToUpdate);
    }
  }

  private clearUnitsCells(unitViews: UnitView[]) {
    unitViews
      .filter((unitView) => isSpriteReady(unitView))
      .forEach((unitView) => {
        const sprite = getColoredSprite(unitView, this.theme);
        const clearsize = sprite.width + 1;
        const lastX = this.game.x(unitView.lastTile());
        const lastY = this.game.y(unitView.lastTile());
        this.context.clearRect(
          lastX - clearsize / 2,
          lastY - clearsize / 2,
          clearsize,
          clearsize,
        );
      });
  }

  private drawUnitsCells(unitViews: UnitView[]) {
    unitViews.forEach((unitView) => this.onUnitEvent(unitView));
  }

  private relationship(unit: UnitView): Relationship {
    const myPlayer = this.game.myPlayer();
    if (myPlayer === null) {
      return Relationship.Enemy;
    }
    if (myPlayer === unit.owner()) {
      return Relationship.Self;
    }
    if (myPlayer.isFriendly(unit.owner())) {
      return Relationship.Ally;
    }
    return Relationship.Enemy;
  }

  onUnitEvent(unit: UnitView) {
    // Check if unit was deactivated
    if (!unit.isActive()) {
      this.handleUnitDeactivation(unit);
    }

    switch (unit.type()) {
      case UnitType.TransportShip:
        this.handleBoatEvent(unit);
        break;
      case UnitType.Warship:
        this.handleWarShipEvent(unit);
        break;
      case UnitType.Shell:
        this.handleShellEvent(unit);
        break;
      case UnitType.SAMMissile:
        this.handleMissileEvent(unit);
        break;
      case UnitType.TradeShip:
        this.handleTradeShipEvent(unit);
        break;
      case UnitType.Train:
        this.handleTrainEvent(unit);
        break;
      case UnitType.MIRVWarhead:
        this.handleMIRVWarhead(unit);
        break;
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
        this.handleNuke(unit);
        break;
    }
  }

  private handleWarShipEvent(unit: UnitView) {
    if (unit.targetUnitId()) {
      this.drawSprite(unit, colord("rgb(200,0,0)"));
    } else {
      this.drawSprite(unit);
    }
  }

  private handleShellEvent(unit: UnitView) {
    const rel = this.relationship(unit);

    // Clear current and previous positions
    this.clearCell(this.game.x(unit.lastTile()), this.game.y(unit.lastTile()));
    const oldTile = this.oldShellTile.get(unit);
    if (oldTile !== undefined) {
      this.clearCell(this.game.x(oldTile), this.game.y(oldTile));
    }

    this.oldShellTile.set(unit, unit.lastTile());
    if (!unit.isActive()) {
      return;
    }

    // Paint current and previous positions
    this.paintCell(
      this.game.x(unit.tile()),
      this.game.y(unit.tile()),
      rel,
      unit.owner().borderColor(),
      255,
    );
    this.paintCell(
      this.game.x(unit.lastTile()),
      this.game.y(unit.lastTile()),
      rel,
      unit.owner().borderColor(),
      255,
    );
  }

  // interception missle from SAM
  private handleMissileEvent(unit: UnitView) {
    this.drawSprite(unit);
  }

  private drawTrail(trail: number[], color: Colord, rel: Relationship) {
    // Paint new trail
    for (const t of trail) {
      this.paintCell(
        this.game.x(t),
        this.game.y(t),
        rel,
        color,
        150,
        this.unitTrailContext,
      );
    }
  }

  private clearTrail(unit: UnitView) {
    const trail = this.unitToTrail.get(unit) ?? [];
    const rel = this.relationship(unit);
    for (const t of trail) {
      this.clearCell(this.game.x(t), this.game.y(t), this.unitTrailContext);
    }
    this.unitToTrail.delete(unit);

    // Repaint overlapping trails
    const trailSet = new Set(trail);
    for (const [other, trail] of this.unitToTrail) {
      for (const t of trail) {
        if (trailSet.has(t)) {
          this.paintCell(
            this.game.x(t),
            this.game.y(t),
            rel,
            other.owner().territoryColor(),
            150,
            this.unitTrailContext,
          );
        }
      }
    }
  }

  private handleNuke(unit: UnitView) {
    const rel = this.relationship(unit);

    if (!this.unitToTrail.has(unit)) {
      this.unitToTrail.set(unit, []);
    }

    let newTrailSize = 1;
    const trail = this.unitToTrail.get(unit) ?? [];
    // It can move faster than 1 pixel, draw a line for the trail or else it will be dotted
    if (trail.length >= 1) {
      const cur = {
        x: this.game.x(unit.lastTile()),
        y: this.game.y(unit.lastTile()),
      };
      const prev = {
        x: this.game.x(trail[trail.length - 1]),
        y: this.game.y(trail[trail.length - 1]),
      };
      const line = new BezenhamLine(prev, cur);
      let point = line.increment();
      while (point !== true) {
        trail.push(this.game.ref(point.x, point.y));
        point = line.increment();
      }
      newTrailSize = line.size();
    } else {
      trail.push(unit.lastTile());
    }

    this.drawTrail(
      trail.slice(-newTrailSize),
      unit.owner().territoryColor(),
      rel,
    );

    const x = Math.round(this.game.x(unit.tile()));
    const y = Math.round(this.game.y(unit.tile()));
    const lastX = Math.round(this.game.x(unit.lastTile()));
    const lastY = Math.round(this.game.y(unit.lastTile()));
    this.context.clearRect(lastX - 12, lastY - 12, 24, 24);

    if (unit.isActive()) {
      const trail = this.unitToTrail.get(unit) ?? [];
      let angle = 0;
      if (trail.length > 1) {
        const prevX = this.game.x(trail[trail.length - 2]);
        const prevY = this.game.y(trail[trail.length - 2]);
        angle = Math.atan2(y - prevY, x - prevX);
      }

      this.context.save();
      this.context.translate(x, y);
      this.context.rotate(angle);

      switch (unit.type()) {
        case UnitType.AtomBomb: {
          if (this.reindeerImage) {
            const img = this.reindeerImage;
            this.context.drawImage(
              img,
              -img.width / 2,
              -img.height / 2,
              img.width,
              img.height,
            );

            // Glowing red nose
            this.context.fillStyle = "red";
            this.context.beginPath();
            this.context.arc(
              img.width / 2 - 10,
              img.height / 2 - 12,
              4,
              0,
              2 * Math.PI,
            ); // Adjust position relative to image
            this.context.shadowBlur = 15;
            this.context.shadowColor = "red";
            this.context.fill();
            this.context.shadowBlur = 0;

            // More defined antlers
            this.context.strokeStyle = "#A0522D"; // Sienna
            this.context.lineWidth = 2;
            this.context.beginPath();
            this.context.moveTo(img.width / 2 - 20, -img.height / 2 + 5);
            this.context.lineTo(img.width / 2 - 25, -img.height / 2 - 5);
            this.context.lineTo(img.width / 2 - 22, -img.height / 2 - 10);
            this.context.moveTo(img.width / 2 - 20, -img.height / 2 + 5);
            this.context.lineTo(img.width / 2 - 15, -img.height / 2 - 5);
            this.context.lineTo(img.width / 2 - 18, -img.height / 2 - 10);
            this.context.stroke();
          }
          break;
        }
        case UnitType.HydrogenBomb: {
          this.context.rotate(-angle); // Present should not rotate
          if (this.presentImage) {
            const img = this.presentImage;
            this.context.drawImage(
              img,
              -img.width / 2,
              -img.height / 2,
              img.width,
              img.height,
            );

            // Detailed ribbon and bow
            const ribbonGradient = this.context.createLinearGradient(
              -5,
              0,
              5,
              0,
            );
            ribbonGradient.addColorStop(0, "darkred");
            ribbonGradient.addColorStop(0.5, "red");
            ribbonGradient.addColorStop(1, "darkred");
            this.context.fillStyle = ribbonGradient;
            this.context.fillRect(-5, -img.height / 2, 10, img.height);
            this.context.fillRect(-img.width / 2, -5, img.width, 10);

            // More elaborate bow
            this.context.fillStyle = "goldenrod";
            this.context.beginPath();
            this.context.moveTo(0, -5);
            this.context.quadraticCurveTo(-10, -15, -20, -10);
            this.context.quadraticCurveTo(-10, -25, 0, -15);
            this.context.quadraticCurveTo(10, -25, 20, -10);
            this.context.quadraticCurveTo(10, -15, 0, -5);
            this.context.closePath();
            this.context.fill();

            // Gift tag
            this.context.fillStyle = "white";
            this.context.fillRect(
              img.width / 2 - 10,
              img.height / 2 - 20,
              15,
              10,
            );
            this.context.strokeStyle = "black";
            this.context.strokeRect(
              img.width / 2 - 10,
              img.height / 2 - 20,
              15,
              10,
            );
            this.context.fillStyle = "black";
            this.context.font = "8px Arial";
            this.context.fillText(
              "TO: U",
              img.width / 2 - 8,
              img.height / 2 - 12,
            );
          }
          break;
        }
        case UnitType.MIRV: {
          if (this.santaImage) {
            const img = this.santaImage;
            this.context.drawImage(
              img,
              -img.width / 2,
              -img.height / 2,
              img.width,
              img.height,
            );

            // Fluffy beard
            this.context.fillStyle = "white";
            this.context.beginPath();
            this.context.moveTo(0, img.height / 2 - 10);
            this.context.bezierCurveTo(
              -img.width / 2 + 5,
              img.height / 2 + 5,
              img.width / 2 - 5,
              img.height / 2 + 5,
              0,
              img.height / 2 - 10,
            );
            this.context.closePath();
            this.context.fill();

            // Hat trim and pom-pom
            this.context.fillStyle = "white";
            this.context.fillRect(
              -img.width / 2,
              -img.height / 2 + 5,
              img.width,
              5,
            ); // Hat trim
            this.context.beginPath();
            this.context.arc(0, -img.height / 2 - 5, 5, 0, 2 * Math.PI); // Pom-pom
            this.context.fill();

            // Defined eyes and mouth
            this.context.fillStyle = "black";
            this.context.beginPath();
            this.context.arc(-5, -5, 1.5, 0, 2 * Math.PI); // Left eye
            this.context.arc(5, -5, 1.5, 0, 2 * Math.PI); // Right eye
            this.context.fill();

            this.context.fillStyle = "red";
            this.context.beginPath();
            this.context.arc(0, img.height / 2 - 15, 3, 0, 2 * Math.PI); // Mouth
            this.context.fill();
          }
          break;
        }
        default:
          this.context.rotate(-angle); // Undo rotation if not a special nuke
          this.drawSprite(unit);
          break;
      }
      this.context.restore();
    }

    if (!unit.isActive()) {
      this.clearTrail(unit);
    }
  }

  private handleMIRVWarhead(unit: UnitView) {
    const rel = this.relationship(unit);

    this.clearCell(this.game.x(unit.lastTile()), this.game.y(unit.lastTile()));

    if (unit.isActive()) {
      // Paint area
      this.paintCell(
        this.game.x(unit.tile()),
        this.game.y(unit.tile()),
        rel,
        unit.owner().borderColor(),
        255,
      );
    }
  }

  private handleTradeShipEvent(unit: UnitView) {
    this.drawSprite(unit);
  }

  private handleTrainEvent(unit: UnitView) {
    this.drawSprite(unit);
  }

  private handleBoatEvent(unit: UnitView) {
    const rel = this.relationship(unit);

    if (!this.unitToTrail.has(unit)) {
      this.unitToTrail.set(unit, []);
    }
    const trail = this.unitToTrail.get(unit) ?? [];
    trail.push(unit.lastTile());

    // Paint trail
    this.drawTrail(trail.slice(-1), unit.owner().territoryColor(), rel);
    this.drawSprite(unit);

    if (!unit.isActive()) {
      this.clearTrail(unit);
    }
  }

  paintCell(
    x: number,
    y: number,
    relationship: Relationship,
    color: Colord,
    alpha: number,
    context: CanvasRenderingContext2D = this.context,
  ) {
    this.clearCell(x, y, context);
    if (this.alternateView) {
      switch (relationship) {
        case Relationship.Self:
          context.fillStyle = this.theme.selfColor().toRgbString();
          break;
        case Relationship.Ally:
          context.fillStyle = this.theme.allyColor().toRgbString();
          break;
        case Relationship.Enemy:
          context.fillStyle = this.theme.enemyColor().toRgbString();
          break;
      }
    } else {
      context.fillStyle = color.alpha(alpha / 255).toRgbString();
    }
    context.fillRect(x, y, 1, 1);
  }

  clearCell(
    x: number,
    y: number,
    context: CanvasRenderingContext2D = this.context,
  ) {
    context.clearRect(x, y, 1, 1);
  }

  drawSprite(unit: UnitView, customTerritoryColor?: Colord) {
    const x = this.game.x(unit.tile());
    const y = this.game.y(unit.tile());

    let alternateViewColor: Colord | null = null;

    if (this.alternateView) {
      let rel = this.relationship(unit);
      const dstPortId = unit.targetUnitId();
      if (unit.type() === UnitType.TradeShip && dstPortId !== undefined) {
        const target = this.game.unit(dstPortId)?.owner();
        const myPlayer = this.game.myPlayer();
        if (myPlayer !== null && target !== undefined) {
          if (myPlayer === target) {
            rel = Relationship.Self;
          } else if (myPlayer.isFriendly(target)) {
            rel = Relationship.Ally;
          }
        }
      }
      switch (rel) {
        case Relationship.Self:
          alternateViewColor = this.theme.selfColor();
          break;
        case Relationship.Ally:
          alternateViewColor = this.theme.allyColor();
          break;
        case Relationship.Enemy:
          alternateViewColor = this.theme.enemyColor();
          break;
      }
    }

    const sprite = getColoredSprite(
      unit,
      this.theme,
      alternateViewColor ?? customTerritoryColor,
      alternateViewColor ?? undefined,
    );

    if (unit.isActive()) {
      const targetable = unit.targetable();
      if (!targetable) {
        this.context.save();
        this.context.globalAlpha = 0.5;
      }
      this.context.drawImage(
        sprite,
        Math.round(x - sprite.width / 2),
        Math.round(y - sprite.height / 2),
        sprite.width,
        sprite.width,
      );
      if (!targetable) {
        this.context.restore();
      }
    }
  }
}
