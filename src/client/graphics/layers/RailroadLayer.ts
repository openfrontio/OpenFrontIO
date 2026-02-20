import { colord } from "colord";
import { EventBus, GameEvent } from "../../../core/EventBus";
import { PlayerID, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { AlternateViewEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { Layer } from "./Layer";
import { getBridgeRects, getRailroadRects } from "./RailroadSprites";
import { computeRailTiles, RailTile, RailType } from "./RailroadView";

type RailRef = {
  tile: RailTile;
  numOccurence: number;
  lastOwnerId: PlayerID | null;
};
const SNAPPABLE_STRUCTURES: UnitType[] = [
  UnitType.Port,
  UnitType.City,
  UnitType.Factory,
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
    const updates = this.game.updatesSinceLastTick();
    const hasRailUpdates =
      (updates?.[GameUpdateType.RailroadConstructionEvent]?.length ?? 0) > 0 ||
      (updates?.[GameUpdateType.RailroadSnapEvent]?.length ?? 0) > 0 ||
      (updates?.[GameUpdateType.RailroadDestructionEvent]?.length ?? 0) > 0;
    if (hasRailUpdates) {
      this.rebuildFromGameView();
    }
    this.updateRailColors();
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
      this.rebuildFromGameView();
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

    this.rebuildFromGameView();
  }

  private rebuildFromGameView() {
    if (this.context === undefined) return;

    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.existingRailroads.clear();
    this.railTileList = [];
    this.railTileIndex.clear();
    this.nextRailIndexToCheck = 0;

    for (const tiles of this.game.railroads().values()) {
      const railTiles = computeRailTiles(this.game, Array.from(tiles));
      for (const railTile of railTiles) {
        this.registerRailTile(railTile);
      }
    }

    for (const { tile } of this.existingRailroads.values()) {
      this.paintRail(tile);
      this.eventBus.emit(new RailTileChangedEvent(tile.tile));
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
      const tiles = this.game.railroads().get(id);
      if (!tiles) continue;
      for (const tile of tiles) {
        const x = this.game.x(tile);
        const y = this.game.y(tile);
        context.fillRect(x + offsetX - 1, y + offsetY - 1, 2.5, 2.5);
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

  private registerRailTile(railTile: RailTile) {
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
