import { LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import {
  AllPlayers,
  Cell,
  PlayerActions,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { flattenedEmojiTable } from "../../../core/Util";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { BuildMenu } from "./BuildMenu";
import { ChatIntegration } from "./ChatIntegration";
import { EmojiTable } from "./EmojiTable";
import { Layer } from "./Layer";
import { COLORS, MenuBuilder, Slot } from "./MenuBuilder";
import { MenuEventManager } from "./MenuEventManager";
import { PlayerActionHandler } from "./PlayerActionHandler";
import { PlayerInfoOverlay } from "./PlayerInfoOverlay";
import { PlayerPanel } from "./PlayerPanel";
import { RadialMenu, RadialMenuConfig } from "./RadialMenu";

import allianceIcon from "../../../../resources/images/AllianceIconWhite.svg";
import boatIcon from "../../../../resources/images/BoatIconWhite.svg";
import buildIcon from "../../../../resources/images/BuildIconWhite.svg";
import infoIcon from "../../../../resources/images/InfoIcon.svg";
import swordIcon from "../../../../resources/images/SwordIconWhite.svg";
import traitorIcon from "../../../../resources/images/TraitorIconWhite.svg";

@customElement("main-radial-menu")
export class MainRadialMenu extends LitElement implements Layer {
  private radialMenu: RadialMenu;
  private lastTickRefresh: number = 0;
  private tickRefreshInterval: number = 500;
  private needsRefresh: boolean = false;

  private menuBuilder: MenuBuilder;
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

    this.menuBuilder = new MenuBuilder(this.game, this.buildMenu);
    this.playerActionHandler = new PlayerActionHandler(
      this.game,
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

    this.radialMenu.setRootMenuItems(this.menuBuilder.getRootMenuItems());
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

    const buildSubMenu = this.menuBuilder.createBuildSubMenu(
      (unitType, x, y) => {
        this.playerActionHandler.handleBuildUnit(unitType, x, y);
        this.menuEventManager.closeMenu();
      },
      tile,
    );

    const allySubMenu = recipient
      ? this.menuBuilder.createAllySubMenu(
          recipient,
          myPlayer,
          actions,
          (playerId) => {
            this.playerActionHandler.handleTargetPlayer(playerId);
            this.menuEventManager.closeMenu();
          },
          (player, recipient) => {
            this.playerActionHandler.handleAllianceRequest(player, recipient);
            this.menuEventManager.closeMenu();
          },
          (player, recipient) => {
            this.playerActionHandler.handleBreakAlliance(player, recipient);
            this.menuEventManager.closeMenu();
          },
          (recipient) => {
            this.playerActionHandler.handleDonateGold(recipient);
            this.menuEventManager.closeMenu();
          },
          (recipient) => {
            this.playerActionHandler.handleDonateTroops(recipient);
            this.menuEventManager.closeMenu();
          },
          (recipient, action) => {
            this.playerActionHandler.handleEmbargo(
              recipient,
              action as "start" | "stop",
            );
            this.menuEventManager.closeMenu();
          },
        )
      : [];

    const updatedMenuItems = this.menuBuilder.createUpdatedMenuItems(
      actions,
      tile,
      recipient,
      async () => {
        if (!recipient) return;
        const spawn = await this.playerActionHandler.findBestTransportShipSpawn(
          myPlayer,
          tile,
        );
        let spawnTile: Cell | null = null;
        if (spawn !== false) {
          spawnTile = new Cell(this.game.x(spawn), this.game.y(spawn));
        }

        const clickedCell = this.menuEventManager.getClickedCell();
        if (clickedCell === null) return;

        this.playerActionHandler.handleBoatAttack(
          myPlayer,
          recipient.id(),
          clickedCell,
          spawnTile,
        );
        this.menuEventManager.closeMenu();
      },
      allySubMenu,
      buildSubMenu,
    );

    for (const item of updatedMenuItems) {
      if (item.id === Slot.Info.toString() && recipient) {
        item.children = this.menuBuilder.createInfoSubMenu(
          recipient,
          () => {
            this.playerPanel.show(actions, tile);
          },
          (recipient) => this.chatIntegration.createQuickChatMenu(recipient),
        );

        if (item.children && item.children.length > 0) {
          const emojiMenuItem = item.children.find(
            (child) => child.id === "info_emoji",
          );
          if (emojiMenuItem && emojiMenuItem.children) {
            emojiMenuItem.action = () => {};

            const moreEmojiItem = emojiMenuItem.children.find(
              (child) => child.id === "emoji_more",
            );
            if (moreEmojiItem) {
              moreEmojiItem.action = () => {
                this.emojiTable.showTable((emoji) => {
                  const targetPlayer =
                    recipient === this.game.myPlayer() ? AllPlayers : recipient;
                  this.playerActionHandler.handleEmoji(
                    targetPlayer,
                    flattenedEmojiTable.indexOf(emoji),
                  );
                  this.emojiTable.hideTable();
                });
              };
            }

            for (const emojiItem of emojiMenuItem.children) {
              if (emojiItem.id !== "emoji_more") {
                const emojiIndex = parseInt(emojiItem.id.split("_")[1], 10);
                emojiItem.action = () => {
                  const targetPlayer =
                    recipient === this.game.myPlayer() ? AllPlayers : recipient;
                  this.playerActionHandler.handleEmoji(
                    targetPlayer,
                    emojiIndex,
                  );
                  this.menuEventManager.closeMenu();
                };
              }
            }
          }
        }
      }
    }

    this.radialMenu.setRootMenuItems(updatedMenuItems);
    this.updateCenterButton(actions, myPlayer);
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
        this.updateMenuState(actions, tile);

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
    this.updateMenuState(actions, tile);
  }

  private updateMenuState(actions: PlayerActions, tile: TileRef) {
    const currentPlayer = this.game.myPlayer();

    if (this.radialMenu.getCurrentLevel() === 0) {
      this.radialMenu.enableCenterButton(false);

      if (currentPlayer) {
        this.updateCenterButton(actions, currentPlayer);
      }
    }

    this.radialMenu.updateMenuItem(
      Slot.Build.toString(),
      !this.game.inSpawnPhase(),
      COLORS.build,
      buildIcon,
    );

    if (actions?.interaction?.canSendAllianceRequest) {
      this.radialMenu.updateMenuItem(
        Slot.Ally.toString(),
        true,
        COLORS.ally,
        allianceIcon,
      );
    } else if (actions?.interaction?.canBreakAlliance) {
      this.radialMenu.updateMenuItem(
        Slot.Ally.toString(),
        true,
        COLORS.breakAlly,
        traitorIcon,
      );
    } else {
      this.radialMenu.updateMenuItem(
        Slot.Ally.toString(),
        false,
        undefined,
        allianceIcon,
      );
    }

    const canBuildTransport = actions.buildableUnits.find(
      (bu) => bu.type === UnitType.TransportShip,
    )?.canBuild;
    this.radialMenu.updateMenuItem(
      Slot.Boat.toString(),
      !!canBuildTransport,
      COLORS.boat,
      boatIcon,
    );

    this.radialMenu.updateMenuItem(
      Slot.Info.toString(),
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

  private updateCenterButton(actions: PlayerActions, myPlayer: PlayerView) {
    if (actions.canAttack) {
      this.radialMenu.enableCenterButton(true, () => {
        const clickedCell = this.menuEventManager.getClickedCell();
        if (clickedCell === null) return;

        const clicked = this.game.ref(clickedCell.x, clickedCell.y);
        const owner = this.game.owner(clicked);

        if (owner && owner !== myPlayer) {
          this.playerActionHandler.handleAttack(myPlayer, owner.id());
        }
        this.menuEventManager.closeMenu();
      });
    } else {
      this.radialMenu.enableCenterButton(false);
    }
  }
}
