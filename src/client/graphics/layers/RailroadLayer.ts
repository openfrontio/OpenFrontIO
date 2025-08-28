import {
  GameUpdateType,
  RailTile,
  RailType,
  RailroadUpdate,
} from "../../../core/game/GameUpdates";
import { getBridgeRects, getRailroadRects } from "./RailroadSprites";
import { Colord } from "colord";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";
import { PlayerID } from "../../../core/game/Game";
import { Theme } from "../../../core/configuration/Config";
import { TileRef } from "../../../core/game/GameMap";

type RailRef = {
  tile: RailTile;
  numOccurence: number;
  lastOwnerId: PlayerID | null;
};

export class RailroadLayer implements Layer {
  private canvas: HTMLCanvasElement | undefined;
  private context: CanvasRenderingContext2D | undefined;
  private readonly theme: Theme;
  // Save the number of railroads per tiles. Delete when it reaches 0
  private readonly existingRailroads = new Map<TileRef, RailRef>();
  private nextRailIndexToCheck = 0;
  private railTileList: TileRef[] = [];

  constructor(private readonly game: GameView) {
    this.theme = game.config().theme();
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    const updates = this.game.updatesSinceLastTick();
    const railUpdates =
      updates !== null ? updates[GameUpdateType.RailroadEvent] : [];
    for (const rail of railUpdates) {
      this.handleRailroadRendering(rail);
    }
  }

  updateRailColors() {
    const maxTilesPerFrame = this.railTileList.length / 60;
    let checked = 0;

    while (checked < maxTilesPerFrame && this.railTileList.length > 0) {
      const tile = this.railTileList[this.nextRailIndexToCheck];
      const railRef = this.existingRailroads.get(tile);
      if (railRef) {
        const currentOwner = this.game.owner(tile)?.id() ?? null;
        if (railRef.lastOwnerId !== currentOwner) {
          railRef.lastOwnerId = currentOwner;
          this.paintRail(railRef.tile);
        }
      }

      this.nextRailIndexToCheck++;
      if (this.nextRailIndexToCheck >= this.railTileList.length) {
        this.nextRailIndexToCheck = 0;
      }
      checked++;
    }
  }

  init() {
    this.redraw();
  }

  redraw() {
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext("2d", { alpha: true });
    if (context === null) throw new Error("2d context not supported");
    this.context = context;

    // Enable smooth scaling
    this.context.imageSmoothingEnabled = true;
    this.context.imageSmoothingQuality = "high";

    this.canvas.width = this.game.width() * 2;
    this.canvas.height = this.game.height() * 2;

    for (const [_, rail] of this.existingRailroads) {
      this.paintRail(rail.tile);
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (this.canvas === undefined) throw new Error("Not initialized");
    this.updateRailColors();
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
  }

  private handleRailroadRendering(railUpdate: RailroadUpdate) {
    for (const railRoad of railUpdate.railTiles) {
      const x = this.game.x(railRoad.tile);
      const y = this.game.y(railRoad.tile);
      if (railUpdate.isActive) {
        this.paintRailroad(railRoad);
      } else {
        this.clearRailroad(railRoad);
      }
    }
  }

  private paintRailroad(railRoad: RailTile) {
    const currentOwner = this.game.owner(railRoad.tile)?.id() ?? null;
    const railTile = this.existingRailroads.get(railRoad.tile);

    if (railTile) {
      railTile.numOccurence++;
      railTile.tile = railRoad;
      railTile.lastOwnerId = currentOwner;
    } else {
      this.existingRailroads.set(railRoad.tile, {
        tile: railRoad,
        numOccurence: 1,
        lastOwnerId: currentOwner,
      });
      this.railTileList.push(railRoad.tile);
      this.paintRail(railRoad);
    }
  }

  private clearRailroad(railRoad: RailTile) {
    const ref = this.existingRailroads.get(railRoad.tile);
    if (ref) ref.numOccurence--;

    if (!ref || ref.numOccurence <= 0) {
      this.existingRailroads.delete(railRoad.tile);
      this.railTileList = this.railTileList.filter((t) => t !== railRoad.tile);
      if (this.context === undefined) throw new Error("Not initialized");
      if (this.game.isWater(railRoad.tile)) {
        this.context.clearRect(
          this.game.x(railRoad.tile) * 2 - 2,
          this.game.y(railRoad.tile) * 2 - 2,
          5,
          6,
        );
      } else {
        this.context.clearRect(
          this.game.x(railRoad.tile) * 2 - 1,
          this.game.y(railRoad.tile) * 2 - 1,
          3,
          3,
        );
      }
    }
  }

  paintRail(railRoad: RailTile) {
    if (this.context === undefined) throw new Error("Not initialized");
    const { tile } = railRoad;
    const { railType } = railRoad;
    const x = this.game.x(tile);
    const y = this.game.y(tile);
    // If rail tile is over water, paint a bridge underlay first
    if (this.game.isWater(tile)) {
      this.paintBridge(this.context, x, y, railType);
    }
    const owner = this.game.owner(tile);
    const recipient = owner.isPlayer() ? owner : null;
    const color = recipient
      ? this.theme.railroadColor(recipient)
      : new Colord({ r: 255, g: 255, b: 255, a: 1 });
    this.context.fillStyle = color.toRgbString();
    this.paintRailRects(this.context, x, y, railType);
  }

  private paintRailRects(context: CanvasRenderingContext2D, x: number, y: number, direction: RailType) {
    const railRects = getRailroadRects(direction);
    for (const [dx, dy, w, h] of railRects) {
      context.fillRect(x * 2 + dx, y * 2 + dy, w, h);
    }
  }

  private paintBridge(context: CanvasRenderingContext2D, x: number, y: number, direction: RailType) {
    context.save();
    context.fillStyle = "rgb(197,69,72)";
    const bridgeRects = getBridgeRects(direction);
    for (const [dx, dy, w, h] of bridgeRects) {
      context.fillRect(x * 2 + dx, y * 2 + dy, w, h);
    }
    context.restore();
  }
}
