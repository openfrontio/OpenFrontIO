import {
  AlternateViewEvent,
  DragEvent,
  MouseOverEvent,
  RedrawGraphicsEvent,
} from "../../InputHandler";
import { Cell, PlayerType, UnitType } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { TileRef, euclDistFN } from "../../../core/game/GameMap";
import { Colord } from "colord";
import { EventBus } from "../../../core/EventBus";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { Layer } from "./Layer";
import { PriorityQueue } from "@datastructures-js/priority-queue";
import { PseudoRandom } from "../../../core/PseudoRandom";
import { Theme } from "../../../core/configuration/Config";
import { TransformHandler } from "../TransformHandler";
import { UserSettings } from "../../../core/game/UserSettings";
import spawnFlagIcon from "../../../../resources/images/RedFlagIcon.svg";

export class TerritoryLayer implements Layer {
  private readonly userSettings: UserSettings;
  private canvas: HTMLCanvasElement | undefined;
  private context: CanvasRenderingContext2D | undefined;
  private imageData: ImageData | undefined;
  private alternativeImageData: ImageData | undefined;

  private cachedTerritoryPatternsEnabled: boolean | undefined;

  private readonly tileToRenderQueue: PriorityQueue<{
    tile: TileRef;
    lastUpdate: number;
  }> = new PriorityQueue((a, b) => {
    return a.lastUpdate - b.lastUpdate;
  });
  private readonly random = new PseudoRandom(123);
  private readonly theme: Theme;

  // Used for spawn highlighting
  private highlightCanvas: HTMLCanvasElement | undefined;
  private highlightContext: CanvasRenderingContext2D | undefined;
  private readonly spawnFlagIconImage: HTMLImageElement;

  private highlightedTerritory: PlayerView | null = null;

  private alternativeView = false;
  private readonly lastDragTime = 0;
  private readonly nodrawDragDuration = 200;
  private lastMousePosition: { x: number; y: number } | null = null;

  private readonly refreshRate = 10; //refresh every 10ms
  private lastRefresh = 0;

  private lastFocusedPlayer: PlayerView | null = null;

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly transformHandler: TransformHandler,
    userSettings: UserSettings,
  ) {
    this.userSettings = userSettings;
    this.theme = game.config().theme();
    this.cachedTerritoryPatternsEnabled = undefined;
    this.spawnFlagIconImage = new Image();
    this.spawnFlagIconImage.decoding = "async";
    this.spawnFlagIconImage.src = spawnFlagIcon;
    this.spawnFlagIconImage.onload = () => this.eventBus.emit(new RedrawGraphicsEvent());
    this.spawnFlagIconImage.onerror = (e) => {
      console.warn("Failed to load spawn flag icon:", e);
    };
  }

  shouldTransform(): boolean {
    return true;
  }

  async paintPlayerBorder(player: PlayerView) {
    const tiles = await player.borderTiles();
    tiles.borderTiles.forEach((tile: TileRef) => {
      this.paintTerritory(tile, true); // Immediately paint the tile instead of enqueueing
    });
  }

  tick() {
    const prev = this.cachedTerritoryPatternsEnabled;
    this.cachedTerritoryPatternsEnabled = this.userSettings.territoryPatterns();
    if (prev !== undefined && prev !== this.cachedTerritoryPatternsEnabled) {
      this.eventBus.emit(new RedrawGraphicsEvent());
    }
    this.game.recentlyUpdatedTiles().forEach((t) => this.enqueueTile(t));
    const updates = this.game.updatesSinceLastTick();
    const unitUpdates = updates !== null ? updates[GameUpdateType.Unit] : [];
    unitUpdates.forEach((update) => {
      if (update.unitType === UnitType.DefensePost) {
        const tile = update.pos;
        this.game
          .bfs(tile, euclDistFN(tile, this.game.config().defensePostRange()))
          .forEach((t) => {
            if (
              this.game.isBorder(t) &&
              (this.game.ownerID(t) === update.ownerID ||
                this.game.ownerID(t) === update.lastOwnerID)
            ) {
              this.enqueueTile(t);
            }
          });
      }
    });

    // Detect alliance mutations
    const myPlayer = this.game.myPlayer();
    if (myPlayer) {
      updates?.[GameUpdateType.BrokeAlliance]?.forEach((update) => {
        const territory = this.game.playerBySmallID(update.betrayedID);
        if (territory && territory instanceof PlayerView) {
          this.redrawBorder(territory);
        }
      });

      updates?.[GameUpdateType.AllianceRequestReply]?.forEach((update) => {
        if (
          update.accepted &&
          (update.request.requestorID === myPlayer.smallID() ||
            update.request.recipientID === myPlayer.smallID())
        ) {
          const territoryId =
            update.request.requestorID === myPlayer.smallID()
              ? update.request.recipientID
              : update.request.requestorID;
          const territory = this.game.playerBySmallID(territoryId);
          if (territory && territory instanceof PlayerView) {
            this.redrawBorder(territory);
          }
        }
      });
      updates?.[GameUpdateType.EmbargoEvent]?.forEach((update) => {
        const player = this.game.playerBySmallID(update.playerID) as PlayerView;
        const embargoed = this.game.playerBySmallID(
          update.embargoedID,
        ) as PlayerView;

        if (
          player.id() === myPlayer?.id() ||
          embargoed.id() === myPlayer?.id()
        ) {
          this.redrawBorder(player, embargoed);
        }
      });
    }

    const focusedPlayer = this.game.focusedPlayer();
    if (focusedPlayer !== this.lastFocusedPlayer) {
      if (this.lastFocusedPlayer) {
        this.paintPlayerBorder(this.lastFocusedPlayer);
      }
      if (focusedPlayer) {
        this.paintPlayerBorder(focusedPlayer);
      }
      this.lastFocusedPlayer = focusedPlayer;
    }

    if (!this.game.inSpawnPhase()) {
      return;
    }
    if (this.game.ticks() % 5 === 0) {
      return;
    }

    this.highlightContext?.clearRect(
      0,
      0,
      this.game.width(),
      this.game.height(),
    );
    const humans = this.game
      .playerViews()
      .filter((p) => p.type() === PlayerType.Human);

    for (const human of humans) {
      const center = human.nameLocation();
      if (!center) {
        continue;
      }
      const centerTile = this.game.ref(center.x, center.y);
      if (!centerTile) {
        continue;
      }
      let color = this.theme.spawnHighlightColor();
      const myPlayer = this.game.myPlayer();
      if (
        myPlayer !== null &&
        myPlayer !== human &&
        myPlayer.isFriendly(human)
      ) {
        color = this.theme.selfColor();
      }
      for (const tile of this.game.bfs(
        centerTile,
        euclDistFN(centerTile, 9, true),
      )) {
        if (!this.game.hasOwner(tile)) {
          this.paintHighlightTile(tile, color, 255);
        }
      }

      // draw spawn flag for the local player
      if (
        myPlayer !== null &&
        human === myPlayer &&
        this.spawnFlagIconImage &&
        this.spawnFlagIconImage.complete &&
        this.highlightContext
      ) {
        const iconSize = 32;
        const offsetX = center.x - iconSize / 5;
        const offsetY = center.y - iconSize;
        this.highlightContext.drawImage(
          this.spawnFlagIconImage,
          offsetX,
          offsetY,
          iconSize,
          iconSize,
        );
      }
    }
  }

  init() {
    this.eventBus.on(MouseOverEvent, (e) => this.onMouseOver(e));
    this.eventBus.on(AlternateViewEvent, (e) => {
      this.alternativeView = e.alternateView;
    });
    this.eventBus.on(DragEvent, (e) => {
      // TODO: consider re-enabling this on mobile or low end devices for smoother dragging.
      // this.lastDragTime = Date.now();
    });
    this.redraw();
  }

  onMouseOver(event: MouseOverEvent) {
    this.lastMousePosition = { x: event.x, y: event.y };
    this.updateHighlightedTerritory();
  }

  private updateHighlightedTerritory() {
    if (!this.alternativeView) {
      return;
    }

    if (!this.lastMousePosition) {
      return;
    }

    const cell = this.transformHandler.screenToWorldCoordinates(
      this.lastMousePosition.x,
      this.lastMousePosition.y,
    );
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      return;
    }

    const previousTerritory = this.highlightedTerritory;
    const territory = this.getTerritoryAtCell(cell);

    if (territory) {
      this.highlightedTerritory = territory;
    } else {
      this.highlightedTerritory = null;
    }

    if (previousTerritory?.id() !== this.highlightedTerritory?.id()) {
      const territories: PlayerView[] = [];
      if (previousTerritory) {
        territories.push(previousTerritory);
      }
      if (this.highlightedTerritory) {
        territories.push(this.highlightedTerritory);
      }
      this.redrawBorder(...territories);
    }
  }

  private getTerritoryAtCell(cell: { x: number; y: number }) {
    const tile = this.game.ref(cell.x, cell.y);
    if (!tile) {
      return null;
    }
    // If the tile has no owner, it is either a fallout tile or a terra nullius tile.
    if (!this.game.hasOwner(tile)) {
      return null;
    }
    const owner = this.game.owner(tile);
    return owner instanceof PlayerView ? owner : null;
  }

  redraw() {
    console.log("redrew territory layer");
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext("2d");
    if (context === null) throw new Error("2d context not supported");
    this.context = context;
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();

    this.imageData = this.context.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    this.alternativeImageData = this.context.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    this.initImageData();

    this.context.putImageData(
      this.alternativeView ? this.alternativeImageData : this.imageData,
      0,
      0,
    );

    // Add a second canvas for highlights
    this.highlightCanvas = document.createElement("canvas");
    const highlightContext = this.highlightCanvas.getContext("2d", {
      alpha: true,
    });
    if (highlightContext === null) throw new Error("2d context not supported");
    this.highlightContext = highlightContext;
    this.highlightCanvas.width = this.game.width();
    this.highlightCanvas.height = this.game.height();

    this.game.forEachTile((t) => {
      this.paintTerritory(t);
    });
  }

  redrawBorder(...players: PlayerView[]) {
    return Promise.all(
      players.map(async (player) => {
        const tiles = await player.borderTiles();
        tiles.borderTiles.forEach((tile: TileRef) => {
          this.paintTerritory(tile, true);
        });
      }),
    );
  }

  initImageData() {
    this.game.forEachTile((tile) => {
      if (this.imageData === undefined) throw new Error("Not initialized");
      if (this.alternativeImageData === undefined) throw new Error("Not initialized");
      const cell = new Cell(this.game.x(tile), this.game.y(tile));
      const index = cell.y * this.game.width() + cell.x;
      const offset = index * 4;
      this.imageData.data[offset + 3] = 0;
      this.alternativeImageData.data[offset + 3] = 0;
    });
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (this.canvas === undefined) throw new Error("Not initialized");
    if (this.highlightCanvas === undefined) throw new Error("Not initialized");
    if (this.context === undefined) throw new Error("Not initialized");
    if (this.imageData === undefined) throw new Error("Not initialized");
    if (this.alternativeImageData === undefined) throw new Error("Not initialized");
    const now = Date.now();
    if (
      now > this.lastDragTime + this.nodrawDragDuration &&
      now > this.lastRefresh + this.refreshRate
    ) {
      this.lastRefresh = now;
      this.renderTerritory();

      const [topLeft, bottomRight] = this.transformHandler.screenBoundingRect();
      const vx0 = Math.max(0, topLeft.x);
      const vy0 = Math.max(0, topLeft.y);
      const vx1 = Math.min(this.game.width() - 1, bottomRight.x);
      const vy1 = Math.min(this.game.height() - 1, bottomRight.y);

      const w = vx1 - vx0 + 1;
      const h = vy1 - vy0 + 1;

      if (w > 0 && h > 0) {
        this.context.putImageData(
          this.alternativeView ? this.alternativeImageData : this.imageData,
          0,
          0,
          vx0,
          vy0,
          w,
          h,
        );
      }
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
    let numToRender = Math.floor(this.tileToRenderQueue.size() / 10);
    if (numToRender === 0 || this.game.inSpawnPhase()) {
      numToRender = this.tileToRenderQueue.size();
    }

    while (numToRender > 0) {
      numToRender--;

      const entry = this.tileToRenderQueue.pop();
      if (!entry) {
        break;
      }

      const { tile } = entry;
      this.paintTerritory(tile);
      for (const neighbor of this.game.neighbors(tile)) {
        this.paintTerritory(neighbor, true);
      }
    }
  }

  paintTerritory(tile: TileRef, isBorder = false) {
    if (isBorder && !this.game.hasOwner(tile)) {
      return;
    }
    if (this.imageData === undefined) throw new Error("Not initialized");
    if (this.alternativeImageData === undefined) throw new Error("Not initialized");

    if (!this.game.hasOwner(tile)) {
      if (this.game.hasFallout(tile)) {
        this.paintTile(this.imageData, tile, this.theme.falloutColor(), 150);
        this.paintTile(
          this.alternativeImageData,
          tile,
          this.theme.falloutColor(),
          150,
        );
        return;
      }
      this.clearTile(tile);
      return;
    }
    const owner = this.game.owner(tile) as PlayerView;
    const isHighlighted =
      this.highlightedTerritory &&
      this.highlightedTerritory.id() === owner.id();
    const myPlayer = this.game.myPlayer();

    if (this.game.isBorder(tile)) {
      const playerIsFocused = owner && this.game.focusedPlayer() === owner;
      if (myPlayer) {
        const alternativeColor = this.alternateViewColor(owner);
        this.paintTile(this.alternativeImageData, tile, alternativeColor, 255);
      }
      if (
        this.game.hasUnitNearby(
          tile,
          this.game.config().defensePostRange(),
          UnitType.DefensePost,
          owner.id(),
        )
      ) {
        const borderColors = this.theme.defendedBorderColors(owner);
        const x = this.game.x(tile);
        const y = this.game.y(tile);
        const lightTile =
          (x % 2 === 0 && y % 2 === 0) || (y % 2 === 1 && x % 2 === 1);
        const borderColor = lightTile ? borderColors.light : borderColors.dark;
        this.paintTile(this.imageData, tile, borderColor, 255);
      } else {
        const useBorderColor = playerIsFocused
          ? this.theme.focusedBorderColor()
          : this.theme.borderColor(owner);
        this.paintTile(this.imageData, tile, useBorderColor, 255);
      }
    } else {
      // Interior tiles
      const { pattern } = owner.cosmetics;
      const patternsEnabled = this.cachedTerritoryPatternsEnabled ?? false;

      // Alternative view only shows borders.
      this.clearAlternativeTile(tile);

      if (pattern === undefined || patternsEnabled === false) {
        this.paintTile(
          this.imageData,
          tile,
          this.theme.territoryColor(owner),
          150,
        );
      } else {
        const x = this.game.x(tile);
        const y = this.game.y(tile);
        const baseColor = this.theme.territoryColor(owner);

        const decoder = owner.patternDecoder();
        const color = decoder?.isSet(x, y)
          ? baseColor.darken(0.125)
          : baseColor;
        this.paintTile(this.imageData, tile, color, 150);
      }
    }
  }

  alternateViewColor(other: PlayerView): Colord {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      return this.theme.neutralColor();
    }
    if (other.smallID() === myPlayer.smallID()) {
      return this.theme.selfColor();
    }
    if (other.isFriendly(myPlayer)) {
      return this.theme.allyColor();
    }
    if (!other.hasEmbargo(myPlayer)) {
      return this.theme.neutralColor();
    }
    return this.theme.enemyColor();
  }

  paintAlternateViewTile(tile: TileRef, other: PlayerView) {
    if (this.alternativeImageData === undefined) throw new Error("Not initialized");
    const color = this.alternateViewColor(other);
    this.paintTile(this.alternativeImageData, tile, color, 255);
  }

  paintTile(imageData: ImageData, tile: TileRef, color: Colord, alpha: number) {
    const offset = tile * 4;
    imageData.data[offset] = color.rgba.r;
    imageData.data[offset + 1] = color.rgba.g;
    imageData.data[offset + 2] = color.rgba.b;
    imageData.data[offset + 3] = alpha;
  }

  clearTile(tile: TileRef) {
    const offset = tile * 4;
    if (this.imageData === undefined) throw new Error("Not initialized");
    if (this.alternativeImageData === undefined) throw new Error("Not initialized");
    this.imageData.data[offset + 3] = 0; // Set alpha to 0 (fully transparent)
    this.alternativeImageData.data[offset + 3] = 0; // Set alpha to 0 (fully transparent)
  }

  clearAlternativeTile(tile: TileRef) {
    const offset = tile * 4;
    if (this.alternativeImageData === undefined) throw new Error("Not initialized");
    this.alternativeImageData.data[offset + 3] = 0; // Set alpha to 0 (fully transparent)
  }

  enqueueTile(tile: TileRef) {
    this.tileToRenderQueue.push({
      tile,
      lastUpdate: this.game.ticks() + this.random.nextFloat(0, 0.5),
    });
  }

  async enqueuePlayerBorder(player: PlayerView) {
    const playerBorderTiles = await player.borderTiles();
    playerBorderTiles.borderTiles.forEach((tile: TileRef) => {
      this.enqueueTile(tile);
    });
  }

  paintHighlightTile(tile: TileRef, color: Colord, alpha: number) {
    this.clearTile(tile);
    const x = this.game.x(tile);
    const y = this.game.y(tile);
    if (this.highlightContext === undefined) throw new Error("Not initialized");
    this.highlightContext.fillStyle = color.alpha(alpha / 255).toRgbString();
    this.highlightContext.fillRect(x, y, 1, 1);
  }

  clearHighlightTile(tile: TileRef) {
    const x = this.game.x(tile);
    const y = this.game.y(tile);
    if (this.highlightContext === undefined) throw new Error("Not initialized");
    this.highlightContext.clearRect(x, y, 1, 1);
  }
}
