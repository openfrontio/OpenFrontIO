import { colord } from "colord";
import { Theme } from "../../../core/configuration/Config";
import { PlayerID } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import {
  GameUpdateType,
  RailroadUpdate,
  RailTile,
  RailType,
} from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
import { getBridgeRects, getRailroadRects } from "./RailroadSprites";

type RailRef = {
  tile: RailTile;
  numOccurence: number;
  lastOwnerId: PlayerID | null;
};

export class RailroadLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private theme: Theme;
  // Save the number of railroads per tiles. Delete when it reaches 0
  private existingRailroads = new Map<TileRef, RailRef>();
  private nextRailIndexToCheck = 0;
  private railTileList: TileRef[] = [];
  // Track global fare range for coloring
  private minFare: number = Infinity;
  private maxFare: number = 0;

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
  ) {
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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const [_, rail] of this.existingRailroads) {
      this.paintRail(rail.tile);
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    this.updateRailColors();
    const scale = this.transformHandler.scale;
    if (scale <= 1) {
      return;
    }
    const rawAlpha = (scale - 1) / (2 - 1); // maps 1->0, 2->1
    const alpha = Math.max(0, Math.min(1, rawAlpha));

    context.save();
    context.globalAlpha = alpha;
    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
    context.restore();
  }

  private handleRailroadRendering(railUpdate: RailroadUpdate) {
    // Fare-only updates: recolor existing segments without touching counts
    if (railUpdate.isActive && railUpdate.isFareUpdate) {
      for (const railRoad of railUpdate.railTiles) {
        const ref = this.existingRailroads.get(railRoad.tile);
        if (!ref) continue;

        if (railRoad.fare !== undefined) {
          this.minFare = Math.min(this.minFare, railRoad.fare);
          this.maxFare = Math.max(this.maxFare, railRoad.fare);
        }
        // Update the stored tile's fare and repaint
        ref.tile.fare = railRoad.fare;
        this.paintRail(ref.tile);
      }
      return;
    }

    // Construction / deletion events
    for (const railRoad of railUpdate.railTiles) {
      if (railUpdate.isActive) {
        this.paintRailroad(railRoad);
      } else {
        this.clearRailroad(railRoad);
      }
    }
  }

  private paintRailroad(railRoad: RailTile) {
    if (railRoad.fare !== undefined) {
      this.minFare = Math.min(this.minFare, railRoad.fare);
      this.maxFare = Math.max(this.maxFare, railRoad.fare);
    }

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
    let color = recipient
      ? recipient.borderColor()
      : colord("rgba(255,255,255,1)");

    const fare = railRoad.fare;
    if (
      fare !== undefined &&
      Number.isFinite(this.minFare) &&
      this.maxFare > this.minFare
    ) {
      const t = (fare - this.minFare) / (this.maxFare - this.minFare);
      const clampedT = Math.max(0, Math.min(1, t));
      const baseRgb = color.toRgb();
      const redTarget = 255;
      const r = Math.round(baseRgb.r + (redTarget - baseRgb.r) * clampedT);
      const g = Math.round(baseRgb.g * (1 - clampedT));
      const b = Math.round(baseRgb.b * (1 - clampedT));
      color = colord({ r, g, b });
    }

    this.context.fillStyle = color.toRgbString();
    this.paintRailRects(this.context, x, y, railType);
  }

  private paintRailRects(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    direction: RailType,
  ) {
    const railRects = getRailroadRects(direction);
    for (const [dx, dy, w, h] of railRects) {
      context.fillRect(x * 2 + dx, y * 2 + dy, w, h);
    }
  }

  private paintBridge(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    direction: RailType,
  ) {
    context.save();
    context.fillStyle = "rgb(197,69,72)";
    const bridgeRects = getBridgeRects(direction);
    for (const [dx, dy, w, h] of bridgeRects) {
      context.fillRect(x * 2 + dx, y * 2 + dy, w, h);
    }
    context.restore();
  }
}
