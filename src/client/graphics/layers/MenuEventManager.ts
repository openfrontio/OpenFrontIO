import { EventBus } from "../../../core/EventBus";
import { Cell, PlayerActions, TerraNullius } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import {
  CloseViewEvent,
  ContextMenuEvent,
  MouseUpEvent,
  ShowBuildMenuEvent,
} from "../../InputHandler";
import { SendSpawnIntentEvent } from "../../Transport";
import { TransformHandler } from "../TransformHandler";
import { BuildMenu } from "./BuildMenu";
import { EmojiTable } from "./EmojiTable";
import { PlayerInfoOverlay } from "./PlayerInfoOverlay";
import { PlayerPanel } from "./PlayerPanel";
import { RadialMenu } from "./RadialMenu";

export type ContextMenuCallback = (
  myPlayer: PlayerView,
  tile: TileRef,
  actions: PlayerActions,
) => void;

export class MenuEventManager {
  private clickedCell: Cell | null = null;
  private lastClosed: number = 0;
  private originalTileOwner: PlayerView | TerraNullius | null = null;
  private wasInSpawnPhase: boolean = false;
  private onContextMenuCallback: ContextMenuCallback | null = null;

  constructor(
    private eventBus: EventBus,
    private game: GameView,
    private transformHandler: TransformHandler,
    private radialMenu: RadialMenu,
    private buildMenu: BuildMenu,
    private emojiTable: EmojiTable,
    private playerInfoOverlay: PlayerInfoOverlay,
    private playerPanel: PlayerPanel,
  ) {}

  init() {
    this.eventBus.on(ContextMenuEvent, (e) => this.onContextMenu(e));
    this.eventBus.on(MouseUpEvent, (e) => this.onPointerUp(e));
    this.eventBus.on(CloseViewEvent, () => this.closeMenu());
    this.eventBus.on(ShowBuildMenuEvent, (e) => this.onShowBuildMenu(e));
  }

  setContextMenuCallback(callback: ContextMenuCallback) {
    this.onContextMenuCallback = callback;
  }

  onContextMenu(event: ContextMenuEvent): Cell | null {
    if (this.lastClosed + 200 > new Date().getTime()) return null;

    this.closeMenu();

    if (this.radialMenu.isMenuVisible()) {
      this.radialMenu.hideRadialMenu();
      return null;
    } else {
      this.radialMenu.showRadialMenu(event.x, event.y);
    }

    this.radialMenu.disableAllButtons();
    this.clickedCell = this.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );

    if (
      !this.clickedCell ||
      !this.game.isValidCoord(this.clickedCell.x, this.clickedCell.y)
    ) {
      return null;
    }

    const tile = this.game.ref(this.clickedCell.x, this.clickedCell.y);
    this.originalTileOwner = this.game.owner(tile);
    this.wasInSpawnPhase = this.game.inSpawnPhase();

    const myPlayer = this.game.myPlayer();
    if (myPlayer === null) {
      throw new Error("my player not found");
    }

    if (myPlayer && !myPlayer.isAlive() && !this.game.inSpawnPhase()) {
      this.radialMenu.hideRadialMenu();
      return null;
    }

    if (this.game.inSpawnPhase()) {
      if (this.game.isLand(tile) && !this.game.hasOwner(tile)) {
        this.radialMenu.enableCenterButton(true, () => {
          if (this.clickedCell === null) return;
          this.eventBus.emit(new SendSpawnIntentEvent(this.clickedCell));
          this.radialMenu.hideRadialMenu();
        });

        return this.clickedCell;
      }
    }

    myPlayer.actions(tile).then((actions) => {
      if (this.onContextMenuCallback) {
        this.onContextMenuCallback(myPlayer, tile, actions);
      }
    });

    return this.clickedCell;
  }

  getClickedCell(): Cell | null {
    return this.clickedCell;
  }

  getOriginalTileOwner(): PlayerView | TerraNullius | null {
    return this.originalTileOwner;
  }

  getWasInSpawnPhase(): boolean {
    return this.wasInSpawnPhase;
  }

  setWasInSpawnPhase(value: boolean) {
    this.wasInSpawnPhase = value;
  }

  onPointerUp(event: MouseUpEvent) {
    this.playerInfoOverlay.hide();
    this.hideEverything();
  }

  onShowBuildMenu(e: ShowBuildMenuEvent): TileRef | null {
    const clickedCell = this.transformHandler.screenToWorldCoordinates(
      e.x,
      e.y,
    );
    if (clickedCell === null) {
      return null;
    }
    if (!this.game.isValidCoord(clickedCell.x, clickedCell.y)) {
      return null;
    }
    const tile = this.game.ref(clickedCell.x, clickedCell.y);
    const p = this.game.myPlayer();
    if (p === null) {
      return null;
    }
    this.buildMenu.showMenu(tile);
    return tile;
  }

  closeMenu() {
    if (this.radialMenu.isMenuVisible()) {
      this.radialMenu.hideRadialMenu();
    }

    if (this.buildMenu.isVisible) {
      this.buildMenu.hideMenu();
    }

    if (this.emojiTable.isVisible) {
      this.emojiTable.hideTable();
    }

    if (this.playerPanel.isVisible) {
      this.playerPanel.hide();
    }
  }

  hideEverything() {
    if (this.radialMenu.isMenuVisible()) {
      this.radialMenu.hideRadialMenu();
      this.lastClosed = new Date().getTime();
    }
    this.emojiTable.hideTable();
    this.buildMenu.hideMenu();
  }

  enableCenterButton(enabled: boolean, action: () => void) {
    this.radialMenu.enableCenterButton(enabled, action);
  }
}
