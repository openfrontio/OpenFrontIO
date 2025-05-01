import { colord, Colord } from "colord";
import { EventBus } from "../../../core/EventBus";
import { ClientID } from "../../../core/Schemas";
import { Theme } from "../../../core/configuration/Config";
import { UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import {
  AlternateViewEvent,
  MouseUpEvent,
  UnitSelectionEvent,
} from "../../InputHandler";
import { MoveWarshipIntentEvent } from "../../Transport";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

import { getColoredSprite, loadAllSprites } from "../SpriteLoader";

enum Relationship {
  Self,
  Ally,
  Enemy,
}

export class UnitLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private transportShipTrailCanvas: HTMLCanvasElement;
  private transportShipTrailContext: CanvasRenderingContext2D;

  private boatToTrail = new Map<UnitView, TileRef[]>();

  private theme: Theme = null;

  private alternateView = false;

  private myPlayer: PlayerView | null = null;

  private oldShellTile = new Map<UnitView, TileRef>();

  private transformHandler: TransformHandler;

  // Selected unit property as suggested in the review comment
  private selectedUnit: UnitView | null = null;

  // Configuration for unit selection
  private readonly WARSHIP_SELECTION_RADIUS = 10; // Radius in game cells for warship selection hit zone

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private clientID: ClientID,
    transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
    this.transformHandler = transformHandler;
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    if (this.myPlayer == null) {
      this.myPlayer = this.game.playerByClientID(this.clientID);
    }
    this.game.updatesSinceLastTick()?.[GameUpdateType.Unit]?.forEach((unit) => {
      this.onUnitEvent(this.game.unit(unit.id));
    });
  }

  init() {
    this.eventBus.on(AlternateViewEvent, (e) => this.onAlternativeViewEvent(e));
    this.eventBus.on(MouseUpEvent, (e) => this.onMouseUp(e));
    this.eventBus.on(UnitSelectionEvent, (e) => this.onUnitSelectionChange(e));
    this.redraw();

    loadAllSprites();
  }

  /**
   * Find player-owned warships near the given cell within a configurable radius
   * @param cell The cell to check
   * @returns Array of player's warships in range, sorted by distance (closest first)
   */
  private findWarshipsNearCell(cell: { x: number; y: number }): UnitView[] {
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      // The cell coordinate were invalid (user probably clicked outside the map), therefore no warships can be found
      return [];
    }
    const clickRef = this.game.ref(cell.x, cell.y);

    // Make sure we have the current player
    if (this.myPlayer == null) {
      this.myPlayer = this.game.playerByClientID(this.clientID);
    }

    // Only select warships owned by the player
    return this.game
      .units(UnitType.Warship)
      .filter(
        (unit) =>
          unit.isActive() &&
          unit.owner() === this.myPlayer && // Only allow selecting own warships
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

  private onMouseUp(event: MouseUpEvent) {
    // Convert screen coordinates to world coordinates
    const cell = this.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );

    // Find warships near this cell, sorted by distance
    const nearbyWarships = this.findWarshipsNearCell(cell);

    if (this.selectedUnit) {
      const clickRef = this.game.ref(cell.x, cell.y);
      if (this.game.isOcean(clickRef)) {
        this.eventBus.emit(
          new MoveWarshipIntentEvent(this.selectedUnit.id(), clickRef),
        );
      }
      // Deselect
      this.eventBus.emit(new UnitSelectionEvent(this.selectedUnit, false));
    } else if (nearbyWarships.length > 0) {
      // Toggle selection of the closest warship
      const clickedUnit = nearbyWarships[0];
      this.eventBus.emit(new UnitSelectionEvent(clickedUnit, true));
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
    this.context = this.canvas.getContext("2d");
    this.transportShipTrailCanvas = document.createElement("canvas");
    this.transportShipTrailContext =
      this.transportShipTrailCanvas.getContext("2d");

    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
    this.transportShipTrailCanvas.width = this.game.width();
    this.transportShipTrailCanvas.height = this.game.height();
    this.game
      ?.updatesSinceLastTick()
      ?.[GameUpdateType.Unit]?.forEach((unit) => {
        this.onUnitEvent(this.game.unit(unit.id));
      });
    this.boatToTrail.forEach((trail, unit) => {
      for (const t of trail) {
        this.paintCell(
          this.game.x(t),
          this.game.y(t),
          this.relationship(unit),
          this.theme.territoryColor(unit.owner()),
          150,
          this.transportShipTrailContext,
        );
      }
    });
  }

  private relationship(unit: UnitView): Relationship {
    if (this.myPlayer == null) {
      return Relationship.Enemy;
    }
    if (this.myPlayer == unit.owner()) {
      return Relationship.Self;
    }
    if (this.myPlayer.isFriendly(unit.owner())) {
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
    if (unit.warshipTargetId()) {
      this.drawSprite(unit, colord({ r: 200, b: 0, g: 0 }));
    } else {
      this.drawSprite(unit);
    }
  }

  private handleShellEvent(unit: UnitView) {
    const rel = this.relationship(unit);

    // Clear current and previous positions
    this.clearCell(this.game.x(unit.lastTile()), this.game.y(unit.lastTile()));
    if (this.oldShellTile.has(unit)) {
      const oldTile = this.oldShellTile.get(unit);
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
      this.theme.borderColor(unit.owner()),
      255,
    );
    this.paintCell(
      this.game.x(unit.lastTile()),
      this.game.y(unit.lastTile()),
      rel,
      this.theme.borderColor(unit.owner()),
      255,
    );
  }

  // interception missle from SAM
  private handleMissileEvent(unit: UnitView) {
    this.drawSprite(unit);
  }

  private handleNuke(unit: UnitView) {
    this.drawSprite(unit);
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
        this.theme.borderColor(unit.owner()),
        255,
      );
    }
  }

  private handleTradeShipEvent(unit: UnitView) {
    this.drawSprite(unit);
  }

  private handleBoatEvent(unit: UnitView) {
    const rel = this.relationship(unit);

    if (!this.boatToTrail.has(unit)) {
      this.boatToTrail.set(unit, []);
    }
    const trail = this.boatToTrail.get(unit);
    trail.push(unit.lastTile());

    // Paint trail
    for (const t of trail.slice(-1)) {
      this.paintCell(
        this.game.x(t),
        this.game.y(t),
        rel,
        this.theme.territoryColor(unit.owner()),
        150,
        this.transportShipTrailContext,
      );
    }

    this.drawSprite(unit);

    if (!unit.isActive()) {
      for (const t of trail) {
        this.clearCell(
          this.game.x(t),
          this.game.y(t),
          this.transportShipTrailContext,
        );
      }
      this.boatToTrail.delete(unit);

      // Repaint overlapping trails
      const trailSet = new Set(trail);
      for (const [other, trail] of this.boatToTrail) {
        for (const t of trail) {
          if (trailSet.has(t)) {
            this.paintCell(
              this.game.x(t),
              this.game.y(t),
              rel,
              this.theme.territoryColor(other.owner()),
              150,
              this.transportShipTrailContext,
            );
          }
        }
      }
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
    const lastX = this.game.x(unit.lastTile());
    const lastY = this.game.y(unit.lastTile());

    let alternateViewColor = null;

    if (this.alternateView) {
      let rel = this.relationship(unit);
      if (unit.type() == UnitType.TradeShip && unit.dstPortId() != null) {
        const target = this.game.unit(unit.dstPortId())?.owner();
        const myPlayer = this.game.myPlayer();
        if (myPlayer != null && target != null) {
          if (myPlayer == target) {
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
      alternateViewColor,
    );

    const clearsize = sprite.width + 1;

    this.context.clearRect(
      lastX - clearsize / 2,
      lastY - clearsize / 2,
      clearsize,
      clearsize,
    );

    if (unit.isActive()) {
      this.context.drawImage(
        sprite,
        Math.round(x - sprite.width / 2),
        Math.round(y - sprite.height / 2),
        sprite.width,
        sprite.width,
      );
    }
  }
}
