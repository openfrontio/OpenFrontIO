import { PriorityQueue } from "@datastructures-js/priority-queue";
import { Colord } from "colord";
import { Theme } from "../../../core/configuration/Config";
import { TileRef } from "../../../core/game/GameMap";
import {
  GameUpdateType,
  RailRoadUpdate,
  RailTile,
  RailType,
} from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { Layer } from "./Layer";
import { getRailRoadRects } from "./RailRoadSprites";

type RailRef = {
  tile: RailTile;
  numOccurence: number;
};

export class RailRoadLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private theme: Theme;
  // Save the number of railroads per tiles. Delete when it reaches 0
  private existingRailroads = new Map<TileRef, RailRef>();
  private tempCanvas: HTMLCanvasElement;

  private tileToCheckQueue: PriorityQueue<{
    tile: TileRef;
    lastUpdate: number;
  }> = new PriorityQueue((a, b) => {
    return a.lastUpdate - b.lastUpdate;
  });

  constructor(private game: GameView) {
    this.theme = game.config().theme();
    this.tempCanvas = document.createElement("canvas");
    const tempContext = this.tempCanvas.getContext("2d");
    if (tempContext === null) throw new Error("2d context not supported");
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    const updates = this.game.updatesSinceLastTick();
    this.game.recentlyUpdatedTiles().forEach((t) => this.enqueueTile(t));
    const railUpdates =
      updates !== null ? updates[GameUpdateType.RailRoadEvent] : [];
    for (const rail of railUpdates) {
      this.handleRailRoadRendering(rail);
    }
  }

  enqueueTile(tile: TileRef) {
    this.tileToCheckQueue.push({
      tile: tile,
      lastUpdate: this.game.ticks(),
    });
  }

  updateRailColors() {
    let numToCheck = Math.floor(this.tileToCheckQueue.size() / 10);
    if (numToCheck === 0 || this.game.inSpawnPhase()) {
      numToCheck = this.tileToCheckQueue.size();
    }

    while (numToCheck > 0) {
      numToCheck--;

      const entry = this.tileToCheckQueue.pop();
      if (!entry) {
        break;
      }

      const tile = entry.tile;
      const railRef = this.existingRailroads.get(tile);
      if (railRef !== undefined) {
        this.paintRail(railRef.tile);
      }
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
  }

  renderLayer(context: CanvasRenderingContext2D) {
    this.updateRailColors();
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }

  private handleRailRoadRendering(railUpdate: RailRoadUpdate) {
    for (const railRoad of railUpdate.railTiles) {
      const x = this.game.x(railRoad.tile);
      const y = this.game.y(railRoad.tile);
      if (railUpdate.isActive) {
        this.paintRailRoad(railRoad);
      } else {
        this.clearRailRoad(railRoad);
      }
    }
  }

  private paintRailRoad(railRoad: RailTile) {
    this.paintRail(railRoad);
    const railTile = this.existingRailroads.get(railRoad.tile);
    if (railTile) {
      railTile.numOccurence++;
      railTile.tile = railRoad;
    } else {
      this.existingRailroads.set(railRoad.tile, {
        tile: railRoad,
        numOccurence: 1,
      });
    }
  }

  private clearRailRoad(railRoad: RailTile) {
    const railTile = this.existingRailroads.get(railRoad.tile);
    if (railTile) {
      railTile.numOccurence--;
    }
    if ((railTile && railTile.numOccurence <= 0) || railTile === null) {
      const x = this.game.x(railRoad.tile);
      const y = this.game.y(railRoad.tile);
      this.existingRailroads.delete(railRoad.tile);
      this.context.clearRect(x * 2 - 1, y * 2 - 1, 3, 3);
    }
  }

  paintRail(railRoad: RailTile) {
    const x = this.game.x(railRoad.tile);
    const y = this.game.y(railRoad.tile);
    const owner = this.game.owner(railRoad.tile);
    const recipient = owner.isPlayer() ? (owner as PlayerView) : null;
    const color = recipient
      ? this.theme.railroadColor(recipient)
      : new Colord({ r: 255, g: 255, b: 255, a: 1 });
    this.context.fillStyle = color.toRgbString();
    switch (railRoad.railType) {
      case RailType.VERTICAL:
        this.paintRailRects(x, y, railRoad.railType);
        break;
      case RailType.HORIZONTAL:
        this.paintRailRects(x, y, railRoad.railType);
        break;
      default:
        this.paintRailRects(x, y, railRoad.railType);
        break;
    }
  }

  // Drawing a corner rail
  private paintRailRects(x: number, y: number, direction: RailType) {
    const railRects = getRailRoadRects(direction);
    for (const [dx, dy, w, h] of railRects) {
      this.context.fillRect(x * 2 + dx, y * 2 + dy, w, h);
    }
  }
}
