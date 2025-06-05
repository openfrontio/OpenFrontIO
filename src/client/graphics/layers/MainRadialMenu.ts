import { LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { PlayerActions, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { BuildMenu } from "./BuildMenu";
import { ChatIntegration } from "./ChatIntegration";
import { EmojiTable } from "./EmojiTable";
import { Layer } from "./Layer";
import { MenuEventManager } from "./MenuEventManager";
import { PlayerActionHandler } from "./PlayerActionHandler";
import { PlayerInfoOverlay } from "./PlayerInfoOverlay";
import { PlayerPanel } from "./PlayerPanel";
import { RadialMenu, RadialMenuConfig } from "./RadialMenu";
import {
  COLORS,
  MenuElementParams,
  Slot,
  createRadialMenuItems,
  getRootMenuItems,
  updateCenterButton,
} from "./RadialMenuElements";

import boatIcon from "../../../../resources/images/BoatIconWhite.svg";
import buildIcon from "../../../../resources/images/BuildIconWhite.svg";
import infoIcon from "../../../../resources/images/InfoIcon.svg";
import swordIcon from "../../../../resources/images/SwordIconWhite.svg";

@customElement("main-radial-menu")
export class MainRadialMenu extends LitElement implements Layer {
  private radialMenu: RadialMenu;
  private lastTickRefresh: number = 0;
  private tickRefreshInterval: number = 500;
  private needsRefresh: boolean = false;

  private playerActionHandler: PlayerActionHandler;
  private menuEventManager: MenuEventManager;
  private chatIntegration: ChatIntegration;

  constructor(
    private eventBus: EventBus,
    private game: GameView,
    private transformHandler: TransformHandler,
    private emojiTable: EmojiTable,
    private buildMenu: BuildMenu,
    private uiState: UIState,
    private playerInfoOverlay: PlayerInfoOverlay,
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

    this.radialMenu = new RadialMenu(menuConfig);

    this.playerActionHandler = new PlayerActionHandler(
      this.eventBus,
      this.uiState,
    );

    this.menuEventManager = new MenuEventManager(
      this.eventBus,
      this.game,
      this.transformHandler,
      this.radialMenu,
      this.buildMenu,
      this.emojiTable,
      this.playerInfoOverlay,
      this.playerPanel,
    );

    this.chatIntegration = new ChatIntegration(this.game, this.eventBus);

    this.radialMenu.setRootMenuItems(getRootMenuItems());
  }

  init() {
    this.radialMenu.init();

    this.menuEventManager.setContextMenuCallback((myPlayer, tile, actions) => {
      this.handlePlayerActions(myPlayer, actions, tile);
    });

    this.menuEventManager.init();
  }

  private async handlePlayerActions(
    myPlayer: PlayerView,
    actions: PlayerActions,
    tile: TileRef,
  ) {
    this.buildMenu.playerActions = actions;

    const tileOwner = this.game.owner(tile);
    const recipient = tileOwner.isPlayer() ? (tileOwner as PlayerView) : null;

    if (myPlayer && recipient) {
      this.chatIntegration.setupChatModal(myPlayer, recipient);
    }

    const params: MenuElementParams = {
      myPlayer,
      selected: recipient,
      tileOwner,
      tile,
      playerActions: actions,
      game: this.game,
      buildMenu: this.buildMenu,
      emojiTable: this.emojiTable,
      playerActionHandler: this.playerActionHandler,
      playerPanel: this.playerPanel,
      chatIntegration: this.chatIntegration,
      closeMenu: () => this.menuEventManager.closeMenu(),
    };

    const menuItems = createRadialMenuItems(params);

    this.radialMenu.setRootMenuItems(menuItems);

    updateCenterButton(params, (enabled, action) => {
      this.radialMenu.enableCenterButton(enabled, action);
    });
  }

  async tick() {
    const clickedCell = this.menuEventManager.getClickedCell();
    if (!this.radialMenu.isMenuVisible() || clickedCell === null) return;

    const currentTime = new Date().getTime();
    if (
      currentTime - this.lastTickRefresh < this.tickRefreshInterval &&
      !this.needsRefresh
    ) {
      return;
    }

    const myPlayer = this.game.myPlayer();
    if (myPlayer === null || !myPlayer.isAlive()) return;

    const tile = this.game.ref(clickedCell.x, clickedCell.y);

    const isSpawnPhase = this.game.inSpawnPhase();
    const wasInSpawnPhase = this.menuEventManager.getWasInSpawnPhase();

    if (wasInSpawnPhase !== isSpawnPhase) {
      if (wasInSpawnPhase && !isSpawnPhase) {
        this.needsRefresh = true;
        this.menuEventManager.setWasInSpawnPhase(isSpawnPhase);

        const actions = await this.playerActionHandler.getPlayerActions(
          myPlayer,
          tile,
        );
        this.updateMenuState(myPlayer, actions, tile);
        this.radialMenu.refreshMenu();
        return;
      }

      this.menuEventManager.closeMenu();
      return;
    }

    // Check if tile ownership has changed
    const originalTileOwner = this.menuEventManager.getOriginalTileOwner();
    if (originalTileOwner && originalTileOwner.isPlayer()) {
      if (this.game.owner(tile) !== originalTileOwner) {
        this.menuEventManager.closeMenu();
        return;
      }
    } else if (originalTileOwner) {
      if (
        this.game.owner(tile).isPlayer() ||
        this.game.owner(tile) === myPlayer
      ) {
        this.menuEventManager.closeMenu();
        return;
      }
    }

    this.lastTickRefresh = currentTime;
    this.needsRefresh = false;

    const actions = await this.playerActionHandler.getPlayerActions(
      myPlayer,
      tile,
    );
    this.updateMenuState(myPlayer, actions, tile);
  }

  private updateMenuState(
    myPlayer: PlayerView,
    actions: PlayerActions,
    tile: TileRef,
  ) {
    if (!this.radialMenu.isMenuVisible()) return;

    const tileOwner = this.game.owner(tile);
    const recipient = tileOwner.isPlayer() ? (tileOwner as PlayerView) : null;

    const params: MenuElementParams = {
      myPlayer,
      selected: recipient,
      tileOwner,
      tile,
      playerActions: actions,
      game: this.game,
      buildMenu: this.buildMenu,
      emojiTable: this.emojiTable,
      playerActionHandler: this.playerActionHandler,
      playerPanel: this.playerPanel,
      chatIntegration: this.chatIntegration,
      closeMenu: () => this.menuEventManager.closeMenu(),
    };

    if (this.radialMenu.getCurrentLevel() === 0) {
      updateCenterButton(params, (enabled, action) => {
        this.radialMenu.enableCenterButton(enabled, action);
      });
    }

    const canBuildTransport = actions.buildableUnits.find(
      (bu) => bu.type === UnitType.TransportShip,
    )?.canBuild;

    this.radialMenu.updateMenuItem(
      Slot.Build,
      !this.game.inSpawnPhase(),
      COLORS.build,
      buildIcon,
    );

    if (actions?.interaction?.canSendAllianceRequest) {
      this.radialMenu.updateMenuItem(Slot.Ally, true, COLORS.ally, undefined);
    } else if (actions?.interaction?.canBreakAlliance) {
      this.radialMenu.updateMenuItem(
        Slot.Ally,
        true,
        COLORS.breakAlly,
        undefined,
      );
    } else {
      this.radialMenu.updateMenuItem(Slot.Ally, false, undefined, undefined);
    }

    this.radialMenu.updateMenuItem(
      Slot.Boat,
      !!canBuildTransport,
      COLORS.boat,
      boatIcon,
    );

    this.radialMenu.updateMenuItem(
      Slot.Info,
      this.game.hasOwner(tile),
      COLORS.info,
      infoIcon,
    );
  }

  renderLayer(context: CanvasRenderingContext2D) {
    this.radialMenu.renderLayer(context);
  }

  shouldTransform(): boolean {
    return this.radialMenu.shouldTransform();
  }

  redraw() {
    // No redraw implementation needed
  }
}
