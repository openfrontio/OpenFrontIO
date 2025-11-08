import { LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { PlayerActions, GameMode } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { BuildMenu } from "./BuildMenu";
import { ChatIntegration } from "./ChatIntegration";
import { EmojiTable } from "./EmojiTable";
import { Layer } from "./Layer";
import { PlayerActionHandler } from "./PlayerActionHandler";
import { PlayerPanel } from "./PlayerPanel";
import { RadialMenu, RadialMenuConfig } from "./RadialMenu";
import {
  centerButtonElement,
  COLORS,
  MenuElementParams,
  rootMenuElement,
} from "./RadialMenuElements";

import swordIcon from "../../../../resources/images/SwordIconWhite.svg";
import { ContextMenuEvent } from "../../InputHandler";
import { FogOfWarLayer } from "./FogOfWarLayer";
import { NameLayer } from "./NameLayer";

// Extended interface to include fogOfWarLayer and nameLayer
interface ExtendedMenuElementParams extends MenuElementParams {
  fogOfWarLayer: FogOfWarLayer | null;
  nameLayer: NameLayer | null;
}

@customElement("main-radial-menu")
export class MainRadialMenu extends LitElement implements Layer {
  private radialMenu: RadialMenu;

  private playerActionHandler: PlayerActionHandler;
  private chatIntegration: ChatIntegration;

  private clickedTile: TileRef | null = null;
  private fogOfWarLayer: FogOfWarLayer | null = null;
  private nameLayer: NameLayer | null = null;

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

  // Method to set the reference to FogOfWarLayer
  public setFogOfWarLayer(fogLayer: FogOfWarLayer) {
    this.fogOfWarLayer = fogLayer;
  }

  // Method to set the reference to NameLayer
  public setNameLayer(nameLayer: NameLayer) {
    this.nameLayer = nameLayer;
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
      
      // Check if we are in Fog of War mode or other supported modes (FFA, Team)
      const gameMode = this.game.config().gameConfig().gameMode;
      if (gameMode === GameMode.FogOfWar && this.fogOfWarLayer) {
        // In Fog of War mode, continue with existing logic
        const tileRef = this.game.ref(worldCoords.x, worldCoords.y);
        const x = this.game.x(tileRef);
        const y = this.game.y(tileRef);
        const idx = y * this.game.width() + x;
        const fogValue = this.fogOfWarLayer.getFogValueAt(idx);
        
        // Show radial menu in all areas, but with different logic for fog = 1
        // This check was removed because the radial menu should be displayed in all areas
      } else if (gameMode === GameMode.FFA || gameMode === GameMode.Team) {
        // In FFA and Team modes, allow radial menu
        // No fog check in these modes
      } else {
        // In other modes, don't show radial menu
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
    const recipient = tileOwner.isPlayer() ? (tileOwner as PlayerView) : null;

    if (myPlayer && recipient) {
      this.chatIntegration.setupChatModal(myPlayer, recipient);
    }

    // Extend parameters with fogOfWarLayer and nameLayer
    const params: ExtendedMenuElementParams = {
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
      fogOfWarLayer: this.fogOfWarLayer,
      nameLayer: this.nameLayer,
    } as ExtendedMenuElementParams;

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