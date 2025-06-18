import { colord, Colord } from "colord";
import { Theme } from "../../../core/configuration/Config";
import { Layer } from "./Layer";

import { PriorityQueue } from "@datastructures-js/priority-queue";
import RailHorizontalIcon from "../../../../resources/sprites/railHorizontal.png";
import RailVerticalIcon from "../../../../resources/sprites/railVertical.png";
import { TileRef } from "../../../core/game/GameMap";
import {
  GameUpdateType,
  RailRoadUpdate,
  RailTile,
  RailType,
} from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { colorizeCanvas } from "../SpriteLoader";
import { getRailRoadRects } from "./RailRoadSprites";

type RailCorner = {
  icon: HTMLCanvasElement;
  centerX: number;
  centerY: number;
};

type RailRef = {
  tile: RailTile;
  numOccurence: number;
};

export class RailRoadLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private unitIcons: Map<string, HTMLImageElement> = new Map();
  private theme: Theme;
  // Save the number of railroads per tiles. Delete when it reaches 0
  private existingRailroads = new Map<TileRef, RailRef>();
  private tempCanvas: HTMLCanvasElement;
  private tempContext: CanvasRenderingContext2D;
  private railImages: Partial<Record<RailType, RailCorner>> = {} as Record<
    RailType,
    RailCorner
  >;

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
    this.tempContext = tempContext;
    this.loadRailImages();
    this.loadCorner();
  }

  async loadImage(path: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = path;
    });
  }

  async loadColoredImage(src: string) {
    const image = await this.loadImage(src);
    return colorizeCanvas(
      image,
      colord("#ff0000"), // Color A
      colord("#00ff00"), // Color B
      colord("#0000ff"), // Color C
    );
  }

  private loadRailImages() {
    this.loadCorner();
    this.loadSegments();
  }

  private async loadSegments() {
    const verticalIcon = await this.loadColoredImage(RailVerticalIcon);
    const horizontalIcon = await this.loadColoredImage(RailHorizontalIcon);

    this.railImages[RailType.VERTICAL] = {
      icon: verticalIcon,
      centerX: 1,
      centerY: 1,
    };
    this.railImages[RailType.HORIZONTAL] = {
      icon: horizontalIcon,
      centerX: 1,
      centerY: 1,
    };
  }

  private async loadCorner() {
    const cornerIcon = await this.loadColoredImage(RailVerticalIcon);

    // Wait until the image is fully loaded and decoded
    //await image.decode();
    this.createRotatedImages(cornerIcon);
  }

  private createRotatedImages(original: HTMLCanvasElement) {
    this.railImages[RailType.BOTTOM_RIGHT] = {
      icon: original,
      centerX: 1,
      centerY: 1,
    };
    let rotatedImage = this.createRotatedImage(original, 90);
    if (rotatedImage) {
      this.railImages[RailType.BOTTOM_LEFT] = {
        icon: rotatedImage,
        centerX: 2,
        centerY: 1,
      };
    }
    rotatedImage = this.createRotatedImage(original, 180);
    if (rotatedImage) {
      this.railImages[RailType.TOP_LEFT] = {
        icon: rotatedImage,
        centerX: 2,
        centerY: 2,
      };
    }
    rotatedImage = this.createRotatedImage(original, 270);
    if (rotatedImage) {
      this.railImages[RailType.TOP_RIGHT] = {
        icon: rotatedImage,
        centerX: 1,
        centerY: 2,
      };
    }
  }

  private createRotatedImage(
    original: HTMLCanvasElement,
    angle: number,
  ): HTMLCanvasElement | null {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return null;

    // Determine canvas size
    if (angle % 180 === 0) {
      canvas.width = original.width;
      canvas.height = original.height;
    } else {
      canvas.width = original.height;
      canvas.height = original.width;
    }

    // Rotate and draw the image
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((angle * Math.PI) / 180);
    context.drawImage(original, -original.width / 2, -original.height / 2);

    return canvas;
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

  // Drawing: [
  private paintHorizontalRail(x: number, y: number) {
    this.context.fillRect(x * 2 - 1, y * 2 - 1, 2, 1);
    this.context.fillRect(x * 2 - 1, y * 2 + 1, 2, 1);
    this.context.fillRect(x * 2 - 1, y * 2, 1, 1);
  }

  // Drawing: U
  private paintVerticalRail(x: number, y: number) {
    this.context.fillRect(x * 2 - 1, y * 2 - 2, 1, 2);
    this.context.fillRect(x * 2 + 1, y * 2 - 2, 1, 2);
    this.context.fillRect(x * 2, y * 2 - 1, 1, 1);
  }
  // this.context.fillRect(x * 2, y * 2 - 1, 2, 2);
  // this.context.fillRect(x * 2 - 1, y * 2 - 1, 1, 1);
  // this.context.fillRect(x * 2 + 1, y * 2 + 1, 1, 1);
  // this.context.fillRect(x * 2 - 1, y * 2 - 2, 1, 1);
  // this.context.fillRect(x * 2 + 1, y * 2 - 2, 1, 1);
  // Drawing a corner rail
  private paintRailRects(x: number, y: number, direction: RailType) {
    const railRects = getRailRoadRects(direction);
    for (const [dx, dy, w, h] of railRects) {
      this.context.fillRect(x * 2 + dx, y * 2 + dy, w, h);
    }
    // const points = [
    //   [ 0, 0, 1, 1],
    //   [-1, -1, 3, 1],
    //   [ 1,  0, 1, 2],
    //   [-1, -2, 1, 1],
    //   [ 1, -2, 1, 1]
    // ];

    // const rotate = (px: number, py: number): [number, number] => {
    //   switch (direction) {
    //     case RailType.TOP_RIGHT:
    //       return [px, py];
    //     case RailType.TOP_LEFT:
    //       return [-px, py];
    //     case RailType.BOTTOM_LEFT:
    //       return [-px, -py];
    //     case RailType.BOTTOM_RIGHT:
    //       return [px, -py];
    //   }
    //   return [px, py];
    // };

    // this.context.fillStyle = color.toRgbString();

    // for (const [dx, dy, w, h] of points) {
    //   const [rx, ry] = rotate(dx, dy);
    //   this.context.fillRect(x * 2 + rx, y * 2 + ry, w, h);
    // }
  }
}
