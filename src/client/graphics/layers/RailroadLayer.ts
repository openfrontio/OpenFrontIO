import { colord } from "colord";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { PlayerID } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import {
  GameUpdateType,
  RailroadUpdate,
  RailTile,
  RailType,
} from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { AlternateViewEvent } from "../../InputHandler";
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
  private alternativeView = false;
  // Save the number of railroads per tiles. Delete when it reaches 0
  private existingRailroads = new Map<TileRef, RailRef>();
  private nextRailIndexToCheck = 0;
  private railTileList: TileRef[] = [];
  private railTileIndex = new Map<TileRef, number>();
  private lastRailColorUpdate = 0;
  private readonly railColorIntervalMs = 50;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
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
    if (this.railTileList.length === 0) {
      return;
    }
    // Throttle color checks so we do not re-evaluate on every frame
    const now = performance.now();
    if (now - this.lastRailColorUpdate < this.railColorIntervalMs) {
      return;
    }
    this.lastRailColorUpdate = now;

    // Spread work over multiple frames to avoid large bursts when many rails exist
    const maxTilesPerFrame = Math.max(
      1,
      Math.ceil(this.railTileList.length / 120),
    );
    let checked = 0;

    while (checked < maxTilesPerFrame && this.railTileList.length > 0) {
      const tile = this.railTileList[this.nextRailIndexToCheck];
      const railRef = this.existingRailroads.get(tile);
      if (railRef) {
        const currentOwner = this.game.owner(tile)?.id() ?? null;
        if (railRef.lastOwnerId !== currentOwner) {
          // Repaint only when the owner changed to keep colors in sync
          railRef.lastOwnerId = currentOwner;
          this.paintRail(railRef.tile);
        }
      }

      this.nextRailIndexToCheck =
        (this.nextRailIndexToCheck + 1) % this.railTileList.length;
      checked++;
    }
  }

  init() {
    this.eventBus.on(AlternateViewEvent, (e) => {
      this.alternativeView = e.alternateView;
      for (const { tile } of this.existingRailroads.values()) {
        this.paintRail(tile);
      }
    });
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
    const scale = this.transformHandler.scale;
    if (scale <= 1) {
      return;
    }
    if (this.existingRailroads.size === 0) {
      return;
    }
    this.updateRailColors();
    const rawAlpha = (scale - 1) / (2 - 1); // maps 1->0, 2->1
    const alpha = Math.max(0, Math.min(1, rawAlpha));

    const [topLeft, bottomRight] = this.transformHandler.screenBoundingRect();
    const padding = 2; // small margin so edges do not pop
    const visLeft = Math.max(0, topLeft.x - padding);
    const visTop = Math.max(0, topLeft.y - padding);
    const visRight = Math.min(this.game.width(), bottomRight.x + padding);
    const visBottom = Math.min(this.game.height(), bottomRight.y + padding);
    const visWidth = Math.max(0, visRight - visLeft);
    const visHeight = Math.max(0, visBottom - visTop);
    if (visWidth === 0 || visHeight === 0) {
      return;
    }

    const srcX = visLeft * 2;
    const srcY = visTop * 2;
    const srcW = visWidth * 2;
    const srcH = visHeight * 2;

    const dstX = -this.game.width() / 2 + visLeft;
    const dstY = -this.game.height() / 2 + visTop;

    context.save();
    context.globalAlpha = alpha;
    context.drawImage(
      this.canvas,
      srcX,
      srcY,
      srcW,
      srcH,
      dstX,
      dstY,
      visWidth,
      visHeight,
    );
    context.restore();
  }

  private handleRailroadRendering(railUpdate: RailroadUpdate) {
    for (const railRoad of railUpdate.railTiles) {
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
      this.railTileIndex.set(railRoad.tile, this.railTileList.length);
      this.railTileList.push(railRoad.tile);
      this.paintRail(railRoad);
    }
  }

  private clearRailroad(railRoad: RailTile) {
    const ref = this.existingRailroads.get(railRoad.tile);
    if (ref) ref.numOccurence--;

    if (!ref || ref.numOccurence <= 0) {
      this.existingRailroads.delete(railRoad.tile);
      this.removeRailTile(railRoad.tile);
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

  private removeRailTile(tile: TileRef) {
    const idx = this.railTileIndex.get(tile);
    if (idx === undefined) return;

    const lastIndex = this.railTileList.length - 1;
    const lastTile = this.railTileList[lastIndex];

    this.railTileList[idx] = lastTile;
    this.railTileIndex.set(lastTile, idx);

    this.railTileList.pop();
    this.railTileIndex.delete(tile);

    if (this.nextRailIndexToCheck >= this.railTileList.length) {
      this.nextRailIndexToCheck = 0;
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

    if (this.alternativeView && recipient?.isMe()) {
      color = colord("#00ff00");
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
