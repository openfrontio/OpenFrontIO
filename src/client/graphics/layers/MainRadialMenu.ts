import { LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { PlayerActions } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import {
  CloseViewEvent,
  ContextMenuEvent,
  MouseUpEvent,
  TouchEvent,
} from "../../InputHandler";
import { SendQuickChatEvent } from "../../Transport";
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
import { TargetSelectionMode } from "./TargetSelectionMode";

const donateTroopIcon = assetUrl("images/DonateTroopIconWhite.svg");
const swordIcon = assetUrl("images/SwordIconWhite.svg");

@customElement("main-radial-menu")
export class MainRadialMenu extends LitElement implements Layer {
  private radialMenu: RadialMenu;

  private playerActionHandler: PlayerActionHandler;
  private chatIntegration: ChatIntegration;

  private clickedTile: TileRef | null = null;

  getTickIntervalMs() {
    return 500;
  }

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

    // Handle left-click and touch: if target-selection mode is active, resolve
    // the clicked tile as the chat target instead of performing a normal action.
    const handleSelectClick = (x: number, y: number) => {
      const mode = TargetSelectionMode.getInstance();
      if (!mode.active) return false;

      const worldCoords = this.transformHandler.screenToWorldCoordinates(x, y);
      if (!this.game.isValidCoord(worldCoords.x, worldCoords.y)) return true;

      const tile = this.game.ref(worldCoords.x, worldCoords.y);
      const owner = this.game.owner(tile);

      if (owner.isPlayer()) {
        this.eventBus.emit(
          new SendQuickChatEvent(
            mode.pendingRecipient!,
            mode.pendingKey!,
            (owner as PlayerView).id(),
          ),
        );
        mode.exit();
      }
      // If tile has no owner, stay in mode and wait for another click.
      return true;
    };

    this.eventBus.on(MouseUpEvent, (event) => {
      if (handleSelectClick(event.x, event.y)) return;
    });

    this.eventBus.on(TouchEvent, (event) => {
      if (handleSelectClick(event.x, event.y)) return;
    });

    // Escape cancels target-selection mode.
    this.eventBus.on(CloseViewEvent, () => {
      TargetSelectionMode.getInstance().exit();
    });

    this.eventBus.on(ContextMenuEvent, (event) => {
      // While in target-selection mode:
      // - left-click (isRightClick=false) → attempt to resolve the target
      // - right-click (isRightClick=true) → cancel the mode
      if (TargetSelectionMode.getInstance().active) {
        if (event.isRightClick) {
          TargetSelectionMode.getInstance().exit();
        } else {
          handleSelectClick(event.x, event.y);
        }
        return;
      }

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
    this.buildMenu.playerBuildables = actions.buildableUnits;

    const tileOwner = this.game.owner(tile);
    const recipient = tileOwner.isPlayer() ? (tileOwner as PlayerView) : null;

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
      uiState: this.uiState,
      closeMenu: () => this.closeMenu(),
      eventBus: this.eventBus,
    };

    const isFriendlyTarget =
      recipient !== null &&
      recipient.isFriendly(myPlayer) &&
      !recipient.isDisconnected();

    this.radialMenu.setCenterButtonAppearance(
      isFriendlyTarget ? donateTroopIcon : swordIcon,
      isFriendlyTarget ? "#22d3ee" : "#0f2744",
      isFriendlyTarget
        ? this.radialMenu.getDefaultCenterIconSize() * 0.75
        : this.radialMenu.getDefaultCenterIconSize(),
    );

    this.radialMenu.setParams(params);
    if (screenX !== null && screenY !== null) {
      this.radialMenu.showRadialMenu(screenX, screenY);
    } else {
      this.radialMenu.refresh();
    }
  }

  async tick() {
    if (!this.radialMenu.isMenuVisible() || this.clickedTile === null) return;
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
