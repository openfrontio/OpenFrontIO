import {
  COLORS,
  MenuElementParams,
  centerButtonElement,
  rootMenuElement,
} from "./RadialMenuElements";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { RadialMenu, RadialMenuConfig } from "./RadialMenu";
import { BuildMenu } from "./BuildMenu";
import { ChatIntegration } from "./ChatIntegration";
import { ContextMenuEvent } from "../../InputHandler";
import { EmojiTable } from "./EmojiTable";
import { EventBus } from "../../../core/EventBus";
import { Layer } from "./Layer";
import { LitElement } from "lit";
import { PlayerActionHandler } from "./PlayerActionHandler";
import { PlayerActions } from "../../../core/game/Game";
import { PlayerPanel } from "./PlayerPanel";
import { TileRef } from "../../../core/game/GameMap";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { customElement } from "lit/decorators.js";
import swordIcon from "../../../../resources/images/SwordIconWhite.svg";

@customElement("main-radial-menu")
export class MainRadialMenu extends LitElement implements Layer {
  private radialMenu: RadialMenu;

  private playerActionHandler: PlayerActionHandler;
  private chatIntegration: ChatIntegration;

  private clickedTile: TileRef | null = null;

  constructor(
    private eventBus: EventBus,
    private game: GameView,
    private transformHandler: TransformHandler,
    private emojiTable: EmojiTable,
    private buildMenu: BuildMenu,
    private uiState: UIState,
    private playerPanel: PlayerPanel,
  ) {
    super();

    const menuConfig: RadialMenuConfig = {
      centerButtonIcon: swordIcon,
      tooltipStyle: `
        .radial-tooltip .cost {
          margin-top: 4px;
          color: ${COLORS.tooltip.cost};
        }
        .radial-tooltip .count {
          color: ${COLORS.tooltip.count};
        }
      `,
    };

    this.radialMenu = new RadialMenu(
      this.eventBus,
      rootMenuElement,
      centerButtonElement,
      menuConfig,
    );

    this.playerActionHandler = new PlayerActionHandler(
      this.eventBus,
      this.uiState,
    );

    this.chatIntegration = new ChatIntegration(this.game, this.eventBus);
  }

  init() {
    this.radialMenu.init();
    this.eventBus.on(ContextMenuEvent, (event) => {
      const worldCoords = this.transformHandler.screenToWorldCoordinates(
        event.x,
        event.y,
      );
      if (!this.game.isValidCoord(worldCoords.x, worldCoords.y)) {
        return;
      }
      if (this.game.myPlayer() === null) {
        return;
      }
      this.clickedTile = this.game.ref(worldCoords.x, worldCoords.y);
      this.game
        .myPlayer()!
        .actions(this.clickedTile)
        .then((actions) => {
          this.updatePlayerActions(
            this.game.myPlayer()!,
            actions,
            this.clickedTile!,
            event.x,
            event.y,
          );
        });
    });
  }

  private async updatePlayerActions(
    myPlayer: PlayerView,
    actions: PlayerActions,
    tile: TileRef,
    screenX: number | null = null,
    screenY: number | null = null,
  ) {
    this.buildMenu.playerActions = actions;

    const tileOwner = this.game.owner(tile);
    const recipient = tileOwner.isPlayer() ? tileOwner : null;

    if (myPlayer && recipient) {
      this.chatIntegration.setupChatModal(myPlayer, recipient);
    }

    const params: MenuElementParams = {
      myPlayer,
      selected: recipient,
      tile,
      playerActions: actions,
      game: this.game,
      buildMenu: this.buildMenu,
      emojiTable: this.emojiTable,
      playerActionHandler: this.playerActionHandler,
      playerPanel: this.playerPanel,
      chatIntegration: this.chatIntegration,
      closeMenu: () => this.closeMenu(),
      eventBus: this.eventBus,
    };

    this.radialMenu.setParams(params);
    if (screenX !== null && screenY !== null) {
      this.radialMenu.showRadialMenu(screenX, screenY);
    } else {
      this.radialMenu.refresh();
    }
  }

  async tick() {
    if (!this.radialMenu.isMenuVisible() || this.clickedTile === null) return;
    if (this.game.ticks() % 5 === 0) {
      this.game
        .myPlayer()!
        .actions(this.clickedTile)
        .then((actions) => {
          this.updatePlayerActions(
            this.game.myPlayer()!,
            actions,
            this.clickedTile!,
          );
        });
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    this.radialMenu.renderLayer(context);
  }

  shouldTransform(): boolean {
    return this.radialMenu.shouldTransform();
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
}
