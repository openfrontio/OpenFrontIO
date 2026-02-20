import { colord } from "colord";
import { EventBus, GameEvent } from "../../../core/EventBus";
import { PlayerID, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import {
  GameUpdateType,
  RailroadConstructionUpdate,
  RailroadDestructionUpdate,
  RailroadSnapUpdate,
} from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { AlternateViewEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { Layer } from "./Layer";
import { getBridgeRects, getRailroadRects } from "./RailroadSprites";
import {
  computeRailTiles,
  RailroadView,
  RailTile,
  RailType,
} from "./RailroadView";

type RailRef = {
  tile: RailTile;
  numOccurence: number;
  lastOwnerId: PlayerID | null;
};
const SNAPPABLE_STRUCTURES: UnitType[] = [
  UnitType.Port,
  UnitType.City,
  UnitType.OilRig,
];
export class RailTileChangedEvent implements GameEvent {
  constructor(public tile: TileRef) {}
}

export class RailroadLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private alternativeView = false;
  // Save the number of railroads per tiles. Delete when it reaches 0
  private existingRailroads = new Map<TileRef, RailRef>();
  private railroads = new Map<number, RailroadView>();
  // Railroads under construction
  private pendingRailroads = new Set<number>();
  private nextRailIndexToCheck = 0;
  private railTileList: TileRef[] = [];
  private railTileIndex = new Map<TileRef, number>();
  private lastRailColorUpdate = 0;
  private readonly railColorIntervalMs = 50;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
    private uiState: UIState,
  ) {}

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    this.updatePendingRailroads();
    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;
    // The event has to be handled in this specific order: construction / snap / destruction
    // Otherwise some ID may not be available yet/anymore
    updates[GameUpdateType.RailroadConstructionEvent]?.forEach((update) => {
      if (update === undefined) return;
      this.onRailroadConstruction(update);
    });
    updates[GameUpdateType.RailroadSnapEvent]?.forEach((update) => {
      if (update === undefined) return;
      this.onRailroadSnapEvent(update);
    });
    updates[GameUpdateType.RailroadDestructionEvent]?.forEach((update) => {
      if (update === undefined) return;
      this.onRailroadDestruction(update);
    });
  }

  updatePendingRailroads() {
    for (const id of this.pendingRailroads) {
      const pending = this.railroads.get(id);
      if (pending === undefined) {
        // Rail deleted or snapped before the end of the animation
        this.pendingRailroads.delete(id);
        continue;
      }
      const newTiles = pending.tick();
      if (newTiles.length === 0) {
        // Animation complete
        this.pendingRailroads.delete(id);
        continue;
      }

      for (const railTile of newTiles) {
        this.paintRailTile(railTile);
        this.eventBus.emit(new RailTileChangedEvent(railTile.tile));
      }
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

  private highlightOverlappingRailroads(context: CanvasRenderingContext2D) {
    if (
      this.uiState.ghostStructure === null ||
      !SNAPPABLE_STRUCTURES.includes(this.uiState.ghostStructure)
    )
      return;
    if (
      this.uiState.overlappingRailroads === undefined ||
      this.uiState.overlappingRailroads.length === 0
    )
      return;
    const offsetX = -this.game.width() / 2;
    const offsetY = -this.game.height() / 2;
    context.fillStyle = "rgba(0, 255, 0, 0.4)";
    for (const id of this.uiState.overlappingRailroads) {
      const rail = this.railroads.get(id);
      if (rail) {
        for (const railTile of rail.drawnTiles()) {
          const x = this.game.x(railTile.tile);
          const y = this.game.y(railTile.tile);
          context.fillRect(x + offsetX - 1, y + offsetY - 1, 2.5, 2.5);
        }
      }
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    const scale = this.transformHandler.scale;
    if (scale <= 1) {
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

    this.renderGhostRailroads(context);

    if (this.existingRailroads.size > 0) {
      this.highlightOverlappingRailroads(context);

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
    }

    context.restore();
  }

  private renderGhostRailroads(context: CanvasRenderingContext2D) {
    if (
      this.uiState.ghostStructure !== UnitType.City &&
      this.uiState.ghostStructure !== UnitType.Port
    )
      return;
    if (this.uiState.ghostRailPaths.length === 0) return;

    const offsetX = -this.game.width() / 2;
    const offsetY = -this.game.height() / 2;
    context.fillStyle = "rgba(0, 0, 0, 0.4)";

    for (const path of this.uiState.ghostRailPaths) {
      const railTiles = computeRailTiles(this.game, path);
      for (const railTile of railTiles) {
        const x = this.game.x(railTile.tile);
        const y = this.game.y(railTile.tile);

        if (this.game.isWater(railTile.tile)) {
          context.save();
          context.fillStyle = "rgba(197, 69, 72, 0.4)";
          const bridgeRects = getBridgeRects(railTile.type);
          for (const [dx, dy, w, h] of bridgeRects) {
            context.fillRect(
              x + offsetX + dx / 2,
              y + offsetY + dy / 2,
              w / 2,
              h / 2,
            );
          }
          context.restore();
        }

        const railRects = getRailroadRects(railTile.type);
        for (const [dx, dy, w, h] of railRects) {
          context.fillRect(
            x + offsetX + dx / 2,
            y + offsetY + dy / 2,
            w / 2,
            h / 2,
          );
        }
      }
    }
  }

  private onRailroadSnapEvent(update: RailroadSnapUpdate) {
    const original = this.railroads.get(update.originalId);
    if (!original) {
      console.warn("Could not snap railroad: ", update.originalId);
      return;
    }
    if (!original.isComplete()) {
      // The animation is not complete but we don't want to compute where the animation should resume
      // Just draw every remaining rails at once
      this.drawRemainingTiles(original);
    }

    // No need to compute the directions here, the rails are already painted
    const directions1: RailTile[] = update.tiles1.map((tile) => ({
      tile,
      type: RailType.HORIZONTAL,
    }));
    const directions2: RailTile[] = update.tiles2.map((tile) => ({
      tile,
      type: RailType.HORIZONTAL,
    }));
    // The rails are already painted, consider them complete
    this.railroads.set(
      update.newId1,
      new RailroadView(update.newId1, directions1, true),
    );
    this.railroads.set(
      update.newId2,
      new RailroadView(update.newId2, directions2, true),
    );

    this.railroads.delete(update.originalId);
  }

  private drawRemainingTiles(railroad: RailroadView) {
    for (const tile of railroad.remainingTiles()) {
      this.paintRail(tile);
    }
    this.pendingRailroads.delete(railroad.id);
  }

  private onRailroadConstruction(railUpdate: RailroadConstructionUpdate) {
    const railTiles = computeRailTiles(this.game, railUpdate.tiles);
    const rail = new RailroadView(railUpdate.id, railTiles);
    this.addRailroad(rail);
  }

  private onRailroadDestruction(railUpdate: RailroadDestructionUpdate) {
    const railroad = this.railroads.get(railUpdate.id);
    if (!railroad) {
      console.warn("Can't remove unexisting railroad: ", railUpdate.id);
      return;
    }
    this.removeRailroad(railroad);
  }

  private addRailroad(railroad: RailroadView) {
    this.railroads.set(railroad.id, railroad);
    this.pendingRailroads.add(railroad.id);
  }

  private removeRailroad(railroad: RailroadView) {
    this.pendingRailroads.delete(railroad.id);
    for (const railTile of railroad.drawnTiles()) {
      this.clearRailroad(railTile.tile);
      this.eventBus.emit(new RailTileChangedEvent(railTile.tile));
    }
    this.railroads.delete(railroad.id);
  }

  private paintRailTile(railTile: RailTile) {
    const currentOwner = this.game.owner(railTile.tile)?.id() ?? null;
    const railRef = this.existingRailroads.get(railTile.tile);

    if (railRef) {
      railRef.numOccurence++;
      railRef.tile = railTile;
      railRef.lastOwnerId = currentOwner;
    } else {
      this.existingRailroads.set(railTile.tile, {
        tile: railTile,
        numOccurence: 1,
        lastOwnerId: currentOwner,
      });
      this.railTileIndex.set(railTile.tile, this.railTileList.length);
      this.railTileList.push(railTile.tile);
      this.paintRail(railTile);
    }
  }

  private clearRailroad(railroad: TileRef) {
    const ref = this.existingRailroads.get(railroad);
    if (ref) ref.numOccurence--;

    if (!ref || ref.numOccurence <= 0) {
      this.existingRailroads.delete(railroad);
      this.removeRailTile(railroad);
      if (this.context === undefined) throw new Error("Not initialized");
      if (this.game.isWater(railroad)) {
        this.context.clearRect(
          this.game.x(railroad) * 2 - 2,
          this.game.y(railroad) * 2 - 2,
          5,
          6,
        );
      } else {
        this.context.clearRect(
          this.game.x(railroad) * 2 - 1,
          this.game.y(railroad) * 2 - 1,
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

  paintRail(railTile: RailTile) {
    if (this.context === undefined) throw new Error("Not initialized");
    const { tile } = railTile;
    const { type } = railTile;
    const x = this.game.x(tile);
    const y = this.game.y(tile);
    // If rail tile is over water, paint a bridge underlay first
    if (this.game.isWater(tile)) {
      this.paintBridge(this.context, x, y, type);
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
    this.paintRailRects(this.context, x, y, type);
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
