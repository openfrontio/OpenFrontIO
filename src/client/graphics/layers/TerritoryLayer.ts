import { PriorityQueue } from "@datastructures-js/priority-queue";
import { Colord } from "colord";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { Cell, PlayerType, UnitType } from "../../../core/game/Game";
import {
  euclDistFN,
  manhattanDistFN,
  TileRef,
} from "../../../core/game/GameMap";
import { GameUpdateType, UnitUpdate } from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { PseudoRandom } from "../../../core/PseudoRandom";
import { AlternateViewEvent, DragEvent } from "../../InputHandler";
import { Layer } from "./Layer";

export class TerritoryLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private imageData: ImageData;

  private tileToRenderQueue: PriorityQueue<{
    tile: TileRef;
    lastUpdate: number;
  }> = new PriorityQueue((a, b) => {
    return a.lastUpdate - b.lastUpdate;
  });
  private random = new PseudoRandom(123);
  private theme: Theme = null;

  // Used for spawn highlighting
  private highlightCanvas: HTMLCanvasElement;
  private highlightContext: CanvasRenderingContext2D;

  private alternativeView = false;
  private lastDragTime = 0;
  private nodrawDragDuration = 200;

  private refreshRate = 50;
  private lastRefresh = 0;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
  ) {
    this.theme = game.config().theme();
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    this.game.recentlyUpdatedTiles().forEach((t) => this.enqueueTile(t));
    this.game.updatesSinceLastTick()[GameUpdateType.Unit].forEach((u) => {
      const update = u as UnitUpdate;
      if (update.unitType == UnitType.DefensePost && update.isActive) {
        const tile = update.pos;
        this.game
          .bfs(
            tile,
            manhattanDistFN(tile, this.game.config().defensePostRange()),
          )
          .forEach((t) => {
            if (
              this.game.isBorder(t) &&
              this.game.ownerID(t) == update.ownerID
            ) {
              this.enqueueTile(t);
            }
          });
      }
    });

    if (!this.game.inSpawnPhase()) {
      return;
    }
    if (this.game.ticks() % 5 == 0) {
      return;
    }

    this.highlightContext.clearRect(
      0,
      0,
      this.game.width(),
      this.game.height(),
    );
    const humans = this.game
      .playerViews()
      .filter((p) => p.type() == PlayerType.Human);

    for (const human of humans) {
      const center = human.nameLocation();
      if (!center) {
        continue;
      }
      const centerTile = this.game.ref(center.x, center.y);
      if (!centerTile) {
        continue;
      }
      for (const tile of this.game.bfs(centerTile, euclDistFN(centerTile, 9))) {
        if (!this.game.hasOwner(tile)) {
          this.paintHighlightCell(
            new Cell(this.game.x(tile), this.game.y(tile)),
            this.theme.spawnHighlightColor(),
            255,
          );
        }
      }
    }
  }

  init() {
    this.eventBus.on(AlternateViewEvent, (e) => {
      this.alternativeView = e.alternateView;
    });
    this.eventBus.on(DragEvent, (e) => {
      // TODO: consider re-enabling this on mobile or low end devices for smoother dragging.
      // this.lastDragTime = Date.now();
    });
    this.redraw();
  }

  redraw() {
    console.log("redrew territory layer");
    this.canvas = document.createElement("canvas");
    this.context = this.canvas.getContext("2d");

    this.imageData = this.context.getImageData(
      0,
      0,
      this.game.width(),
      this.game.height(),
    );
    this.initImageData();
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();
    this.context.putImageData(this.imageData, 0, 0);

    // Add a second canvas for highlights
    this.highlightCanvas = document.createElement("canvas");
    this.highlightContext = this.highlightCanvas.getContext("2d", {
      alpha: true,
    });
    this.highlightCanvas.width = this.game.width();
    this.highlightCanvas.height = this.game.height();

    this.game.forEachTile((t) => {
      this.paintTerritory(t);
    });
  }

  initImageData() {
    this.game.forEachTile((tile) => {
      const cell = new Cell(this.game.x(tile), this.game.y(tile));
      const index = cell.y * this.game.width() + cell.x;
      const offset = index * 4;
      this.imageData.data[offset + 3] = 0;
    });
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (
      Date.now() > this.lastDragTime + this.nodrawDragDuration &&
      Date.now() > this.lastRefresh + this.refreshRate
    ) {
      this.lastRefresh = Date.now();
      this.renderTerritory();
      this.context.putImageData(this.imageData, 0, 0);
    }
    if (this.alternativeView) {
      return;
    }

    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
    if (this.game.inSpawnPhase()) {
      context.drawImage(
        this.highlightCanvas,
        -this.game.width() / 2,
        -this.game.height() / 2,
        this.game.width(),
        this.game.height(),
      );
    }
  }

  renderTerritory() {
    let numToRender = Math.floor(this.tileToRenderQueue.size() / 5);
    if (numToRender == 0 || this.game.inSpawnPhase()) {
      numToRender = this.tileToRenderQueue.size();
    }

    while (numToRender > 0) {
      numToRender--;
      const tile = this.tileToRenderQueue.pop().tile;
      this.paintTerritory(tile);
      for (const neighbor of this.game.neighbors(tile)) {
        this.paintTerritory(neighbor, true);
      }
    }
  }

  paintTerritory(tile: TileRef, isBorder: boolean = false) {
    if (isBorder && !this.game.hasOwner(tile)) {
      return;
    }
    if (!this.game.hasOwner(tile)) {
      if (this.game.hasFallout(tile)) {
        this.paintCell(
          this.game.x(tile),
          this.game.y(tile),
          this.theme.falloutColor(),
          150,
        );
        return;
      }
      this.clearCell(new Cell(this.game.x(tile), this.game.y(tile)));
      return;
    }
    const owner = this.game.owner(tile) as PlayerView;
    if (this.game.isBorder(tile)) {
      if (
        this.game.nearbyDefenses(tile).filter((u) => u.owner() == owner)
          .length > 0
      ) {
        this.paintCell(
          this.game.x(tile),
          this.game.y(tile),
          this.theme.defendedBorderColor(owner.info()),
          255,
        );
      } else {
        this.paintCell(
          this.game.x(tile),
          this.game.y(tile),
          this.theme.borderColor(owner.info()),
          255,
        );
      }
    } else {
      this.paintCell(
        this.game.x(tile),
        this.game.y(tile),
        this.theme.territoryColor(owner.info()),
        150,
      );
    }
  }

  paintCell(x: number, y: number, color: Colord, alpha: number) {
    const index = y * this.game.width() + x;
    const offset = index * 4;
    this.imageData.data[offset] = color.rgba.r;
    this.imageData.data[offset + 1] = color.rgba.g;
    this.imageData.data[offset + 2] = color.rgba.b;
    this.imageData.data[offset + 3] = alpha;
  }

  clearCell(cell: Cell) {
    const index = cell.y * this.game.width() + cell.x;
    const offset = index * 4;
    this.imageData.data[offset + 3] = 0; // Set alpha to 0 (fully transparent)
  }

  enqueueTile(tile: TileRef) {
    this.tileToRenderQueue.push({
      tile: tile,
      lastUpdate: this.game.ticks() + this.random.nextFloat(0, 0.5),
    });
  }

  paintHighlightCell(cell: Cell, color: Colord, alpha: number) {
    this.clearCell(cell);
    this.highlightContext.fillStyle = color.alpha(alpha / 255).toRgbString();
    this.highlightContext.fillRect(cell.x, cell.y, 1, 1);
  }

  clearHighlightCell(cell: Cell) {
    this.highlightContext.clearRect(cell.x, cell.y, 1, 1);
  }
}
