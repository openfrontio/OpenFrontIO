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
import { TurnDebtEvent } from "../../Transport";
import { UIState } from "../UIState";
import { customElement } from "lit/decorators.js";
import swordIcon from "../../../../resources/images/SwordIconWhite.svg";

@customElement("main-radial-menu")
export class MainRadialMenu extends LitElement implements Layer {
  private readonly radialMenu: RadialMenu;

  private readonly playerActionHandler: PlayerActionHandler;
  private readonly chatIntegration: ChatIntegration;

  private clickedTile: TileRef | null = null;
  private isInTurnDebt = false;

  constructor(
    private readonly eventBus: EventBus,
    private readonly game: GameView,
    private readonly transformHandler: TransformHandler,
    private readonly emojiTable: EmojiTable,
    private readonly buildMenu: BuildMenu,
    private readonly uiState: UIState,
    private readonly playerPanel: PlayerPanel,
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
    this.eventBus.on(TurnDebtEvent, (e) => {
      this.isInTurnDebt = e.isInTurnDebt;
      if (this.isInTurnDebt) {
        this.closeMenu();
      }
    });
    this.eventBus.on(ContextMenuEvent, async (event) => {
      const worldCoords = this.transformHandler.screenToWorldCoordinates(
        event.x,
        event.y,
      );
      if (!this.game.isValidCoord(worldCoords.x, worldCoords.y)) {
        return;
      }
      if (this.isInTurnDebt) {
        return;
      }
      const myPlayer = this.game.myPlayer();
      if (myPlayer === null) {
        return;
      }
      const tile = this.game.ref(worldCoords.x, worldCoords.y);
      this.clickedTile = tile;
      try {
        const actions = await myPlayer.actions(tile);
        // Stale check: user might have clicked somewhere else already
        if (this.clickedTile !== tile) return;
        this.updatePlayerActions(
          myPlayer,
          actions,
          tile,
          event.x,
          event.y,
        );
      } catch (err) {
        console.error("Failed to fetch player actions:", err);
      }
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
      const myPlayer = this.game.myPlayer();
      if (myPlayer === null) return;
      const tile = this.clickedTile;
      if (tile === null) return;
      try {
        const actions = await myPlayer.actions(tile);
        if (this.clickedTile !== tile) return; // stale
        this.updatePlayerActions(
          myPlayer,
          actions,
          tile,
        );
      } catch (err) {
        console.error("Failed to refresh player actions:", err);
      }
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
