import { Colord } from "colord";
import { EventBus } from "../../../core/EventBus";
import { ClientID } from "../../../core/Schemas";
import { Theme } from "../../../core/configuration/Config";
import { UnitType } from "../../../core/game/Game";
import {
  euclDistFN,
  manhattanDistFN,
  TileRef,
} from "../../../core/game/GameMap";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { AlternateViewEvent } from "../../InputHandler";
import { Layer } from "./Layer";

enum Relationship {
  Self,
  Ally,
  Enemy,
}

export class UnitLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;

  private boatToTrail = new Map<UnitView, Set<TileRef>>();

  private theme: Theme = null;

  private alternateView = false;

  private myPlayer: PlayerView | null = null;

  private oldShellTile = new Map<UnitView, TileRef>();

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private clientID: ClientID,
  ) {
    this.theme = game.config().theme();
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
    this.redraw();
  }

  renderLayer(context: CanvasRenderingContext2D) {
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

    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
    this.game
      ?.updatesSinceLastTick()
      ?.[GameUpdateType.Unit]?.forEach((unit) => {
        this.onUnitEvent(this.game.unit(unit.id));
      });
  }

  private relationship(unit: UnitView): Relationship {
    if (this.myPlayer == null) {
      return Relationship.Enemy;
    }
    if (this.myPlayer == unit.owner()) {
      return Relationship.Self;
    }
    if (this.myPlayer.isAlliedWith(unit.owner())) {
      return Relationship.Ally;
    }
    return Relationship.Enemy;
  }

  onUnitEvent(unit: UnitView) {
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
    const rel = this.relationship(unit);

    // Clear previous area
    for (const t of this.game.bfs(
      unit.lastTile(),
      euclDistFN(unit.lastTile(), 6),
    )) {
      this.clearCell(this.game.x(t), this.game.y(t));
    }

    if (!unit.isActive()) {
      return;
    }

    // Paint outer territory
    for (const t of this.game.bfs(unit.tile(), euclDistFN(unit.tile(), 5))) {
      this.paintCell(
        this.game.x(t),
        this.game.y(t),
        rel,
        this.theme.territoryColor(unit.owner().info()),
        255,
      );
    }

    // Paint border
    for (const t of this.game.bfs(
      unit.tile(),
      manhattanDistFN(unit.tile(), 4),
    )) {
      this.paintCell(
        this.game.x(t),
        this.game.y(t),
        rel,
        this.theme.borderColor(unit.owner().info()),
        255,
      );
    }

    // Paint inner territory
    for (const t of this.game.bfs(unit.tile(), euclDistFN(unit.tile(), 1))) {
      this.paintCell(
        this.game.x(t),
        this.game.y(t),
        rel,
        this.theme.territoryColor(unit.owner().info()),
        255,
      );
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
      this.theme.borderColor(unit.owner().info()),
      255,
    );
    this.paintCell(
      this.game.x(unit.lastTile()),
      this.game.y(unit.lastTile()),
      rel,
      this.theme.borderColor(unit.owner().info()),
      255,
    );
  }

  private handleNuke(unit: UnitView) {
    const rel = this.relationship(unit);
    let range = 0;
    switch (unit.type()) {
      case UnitType.AtomBomb:
        range = 4;
        break;
      case UnitType.HydrogenBomb:
        range = 6;
        break;
      case UnitType.MIRV:
        range = 9;
        break;
    }

    // Clear previous area
    for (const t of this.game.bfs(
      unit.lastTile(),
      euclDistFN(unit.lastTile(), range),
    )) {
      this.clearCell(this.game.x(t), this.game.y(t));
    }

    if (unit.isActive()) {
      for (const t of this.game.bfs(
        unit.tile(),
        euclDistFN(unit.tile(), range),
      )) {
        this.paintCell(
          this.game.x(t),
          this.game.y(t),
          rel,
          this.theme.spawnHighlightColor(),
          255,
        );
      }
      for (const t of this.game.bfs(unit.tile(), euclDistFN(unit.tile(), 2))) {
        this.paintCell(
          this.game.x(t),
          this.game.y(t),
          rel,
          this.theme.borderColor(unit.owner().info()),
          255,
        );
      }
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
        this.theme.borderColor(unit.owner().info()),
        255,
      );
    }
  }

  private handleTradeShipEvent(unit: UnitView) {
    const rel = this.relationship(unit);

    // Clear previous area
    for (const t of this.game.bfs(
      unit.lastTile(),
      euclDistFN(unit.lastTile(), 3),
    )) {
      this.clearCell(this.game.x(t), this.game.y(t));
    }

    if (unit.isActive()) {
      // Paint territory
      for (const t of this.game.bfs(
        unit.tile(),
        manhattanDistFN(unit.tile(), 2),
      )) {
        this.paintCell(
          this.game.x(t),
          this.game.y(t),
          rel,
          this.theme.territoryColor(unit.owner().info()),
          255,
        );
      }

      // Paint border
      for (const t of this.game.bfs(
        unit.tile(),
        manhattanDistFN(unit.tile(), 1),
      )) {
        this.paintCell(
          this.game.x(t),
          this.game.y(t),
          rel,
          this.theme.borderColor(unit.owner().info()),
          255,
        );
      }
    }
  }

  private handleBoatEvent(unit: UnitView) {
    const rel = this.relationship(unit);

    if (!this.boatToTrail.has(unit)) {
      this.boatToTrail.set(unit, new Set<TileRef>());
    }
    const trail = this.boatToTrail.get(unit);
    trail.add(unit.lastTile());

    // Clear previous area
    for (const t of this.game.bfs(
      unit.lastTile(),
      manhattanDistFN(unit.lastTile(), 3),
    )) {
      this.clearCell(this.game.x(t), this.game.y(t));
    }

    if (unit.isActive()) {
      // Paint trail
      for (const t of trail) {
        this.paintCell(
          this.game.x(t),
          this.game.y(t),
          rel,
          this.theme.territoryColor(unit.owner().info()),
          150,
        );
      }

      // Paint border
      for (const t of this.game.bfs(
        unit.tile(),
        manhattanDistFN(unit.tile(), 2),
      )) {
        this.paintCell(
          this.game.x(t),
          this.game.y(t),
          rel,
          this.theme.borderColor(unit.owner().info()),
          255,
        );
      }

      // Paint territory
      for (const t of this.game.bfs(
        unit.tile(),
        manhattanDistFN(unit.tile(), 1),
      )) {
        this.paintCell(
          this.game.x(t),
          this.game.y(t),
          rel,
          this.theme.territoryColor(unit.owner().info()),
          255,
        );
      }
    } else {
      for (const t of trail) {
        this.clearCell(this.game.x(t), this.game.y(t));
      }
      this.boatToTrail.delete(unit);
    }
  }

  paintCell(
    x: number,
    y: number,
    relationship: Relationship,
    color: Colord,
    alpha: number,
  ) {
    this.clearCell(x, y);
    if (this.alternateView) {
      switch (relationship) {
        case Relationship.Self:
          this.context.fillStyle = this.theme.selfColor().toRgbString();
          break;
        case Relationship.Ally:
          this.context.fillStyle = this.theme.allyColor().toRgbString();
          break;
        case Relationship.Enemy:
          this.context.fillStyle = this.theme.enemyColor().toRgbString();
          break;
      }
    } else {
      this.context.fillStyle = color.alpha(alpha / 255).toRgbString();
    }
    this.context.fillRect(x, y, 1, 1);
  }

  clearCell(x: number, y: number) {
    this.context.clearRect(x, y, 1, 1);
  }
}
