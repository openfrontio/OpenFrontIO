import { LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { consolex } from "../../../core/Consolex";
import { EventBus } from "../../../core/EventBus";
import {
  AllPlayers,
  Cell,
  PlayerActions,
  TerraNullius,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { flattenedEmojiTable } from "../../../core/Util";
import {
  CloseViewEvent,
  ContextMenuEvent,
  MouseUpEvent,
  ShowBuildMenuEvent,
} from "../../InputHandler";
import {
  BuildUnitIntentEvent,
  SendAllianceRequestIntentEvent,
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendBreakAllianceIntentEvent,
  SendDonateGoldIntentEvent,
  SendDonateTroopsIntentEvent,
  SendEmbargoIntentEvent,
  SendEmojiIntentEvent,
  SendQuickChatEvent,
  SendSpawnIntentEvent,
  SendTargetPlayerIntentEvent,
} from "../../Transport";
import { renderNumber, translateText } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { BuildItemDisplay, BuildMenu, flattenedBuildTable } from "./BuildMenu";
import { ChatModal, QuickChatPhrase, quickChatPhrases } from "./ChatModal";
import { EmojiTable } from "./EmojiTable";
import { Layer } from "./Layer";
import { PlayerInfoOverlay } from "./PlayerInfoOverlay";
import { PlayerPanel } from "./PlayerPanel";
import { MenuItem, RadialMenu, RadialMenuConfig } from "./RadialMenu";

import allianceIcon from "../../../../resources/images/AllianceIconWhite.svg";
import boatIcon from "../../../../resources/images/BoatIconWhite.svg";
import buildIcon from "../../../../resources/images/BuildIconWhite.svg";
import chatIcon from "../../../../resources/images/ChatIconWhite.svg";
import donateGoldIcon from "../../../../resources/images/DonateGoldIconWhite.svg";
import donateTroopIcon from "../../../../resources/images/DonateTroopIconWhite.svg";
import emojiIcon from "../../../../resources/images/EmojiIconWhite.svg";
import infoIcon from "../../../../resources/images/InfoIcon.svg";
import swordIcon from "../../../../resources/images/SwordIconWhite.svg";
import targetIcon from "../../../../resources/images/TargetIconWhite.svg";
import traitorIcon from "../../../../resources/images/TraitorIconWhite.svg";
import { TerraNulliusImpl } from "../../../core/game/TerraNulliusImpl";

/**
 * Enum for first-level menu slots
 */
enum Slot {
  Info,
  Boat,
  Build,
  Ally,
  Back,
}

const COLORS = {
  build: "#ebe250",
  building: "#2c2c2c",
  boat: "#3f6ab1",
  ally: "#53ac75",
  breakAlly: "#c74848",
  info: "#64748B",
  target: "#ff0000",
  infoDetails: "#7f8c8d",
  infoEmoji: "#f1c40f",
  trade: "#008080",
  embargo: "#6600cc",
  tooltip: {
    cost: "#ffd700",
    count: "#aaa",
  },
  chat: {
    default: "#66c",
    help: "#4caf50",
    attack: "#f44336",
    defend: "#2196f3",
    greet: "#ff9800",
    misc: "#9c27b0",
    warnings: "#ffeb3b",
  },
};

@customElement("main-radial-menu")
export class MainRadialMenu extends LitElement implements Layer {
  private radialMenu: RadialMenu;
  private clickedCell: Cell | null = null;
  private lastClosed: number = 0;
  private originalTileOwner: PlayerView | TerraNullius;
  private wasInSpawnPhase: boolean = false;
  private lastTickRefresh: number = 0;
  private tickRefreshInterval: number = 500;
  private needsRefresh: boolean = false;
  private ctModal: ChatModal;

  private rootMenuItems: MenuItem[] = [
    {
      id: Slot.Boat.toString(),
      name: "boat",
      disabled: true,
      action: () => {},
    },
    {
      id: Slot.Ally.toString(),
      name: "ally",
      disabled: true,
      action: () => {},
    },
    {
      id: Slot.Build.toString(),
      name: "build",
      disabled: true,
      action: () => {},
    },
    {
      id: Slot.Info.toString(),
      name: "info",
      disabled: true,
      action: () => {},
    },
  ];

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
    this.radialMenu.setRootMenuItems(this.rootMenuItems);
  }

  init() {
    this.radialMenu.init();

    this.eventBus.on(ContextMenuEvent, (e) => this.onContextMenu(e));
    this.eventBus.on(MouseUpEvent, (e) => this.onPointerUp(e));
    this.eventBus.on(CloseViewEvent, () => this.closeMenu());
    this.eventBus.on(ShowBuildMenuEvent, (e) => this.onShowBuildMenu(e));

    this.ctModal = document.querySelector("chat-modal") as ChatModal;

    // Make sure we have the chat modal before proceeding
    if (!this.ctModal) {
      consolex.warn("Chat modal not found during initialization");
    }
  }

  private onShowBuildMenu(e: ShowBuildMenuEvent) {
    const clickedCell = this.transformHandler.screenToWorldCoordinates(
      e.x,
      e.y,
    );
    if (clickedCell === null) {
      return;
    }
    if (!this.game.isValidCoord(clickedCell.x, clickedCell.y)) {
      return;
    }
    const tile = this.game.ref(clickedCell.x, clickedCell.y);
    const p = this.game.myPlayer();
    if (p === null) {
      return;
    }
    this.buildMenu.showMenu(tile);
  }

  private closeMenu() {
    if (this.radialMenu.isMenuVisible()) {
      this.radialMenu.hideRadialMenu();
    }

    if (this.buildMenu.isVisible) {
      this.buildMenu.hideMenu();
    }

    if (this.emojiTable.isVisible) {
      this.emojiTable.hideTable();
    }
  }

  private onContextMenu(event: ContextMenuEvent) {
    if (this.lastClosed + 200 > new Date().getTime()) return;

    if (this.buildMenu.isVisible) {
      this.buildMenu.hideMenu();
      return;
    }

    if (this.radialMenu.isMenuVisible()) {
      this.radialMenu.hideRadialMenu();
      return;
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
      return;
    }

    const tile = this.game.ref(this.clickedCell.x, this.clickedCell.y);
    this.originalTileOwner = this.game.owner(tile);

    this.wasInSpawnPhase = this.game.inSpawnPhase();

    const myPlayer = this.game.myPlayer();
    if (myPlayer === null) {
      consolex.warn("my player not found");
      return;
    }

    if (myPlayer && !myPlayer.isAlive() && !this.game.inSpawnPhase()) {
      return this.radialMenu.hideRadialMenu();
    }

    if (this.game.inSpawnPhase()) {
      if (this.game.isLand(tile) && !this.game.hasOwner(tile)) {
        this.radialMenu.enableCenterButton(true, () => {
          if (this.clickedCell === null) return;
          this.eventBus.emit(new SendSpawnIntentEvent(this.clickedCell));
          this.radialMenu.hideRadialMenu();
        });
      }
    }

    myPlayer.actions(tile).then((actions) => {
      this.handlePlayerActions(myPlayer, actions, tile);
    });
  }

  private onPointerUp(event: MouseUpEvent) {
    this.playerInfoOverlay.hide();
    this.hideEverything();
  }

  private hideEverything() {
    if (this.radialMenu.isMenuVisible()) {
      this.radialMenu.hideRadialMenu();
      this.lastClosed = new Date().getTime();
    }
    this.emojiTable.hideTable();
    this.buildMenu.hideMenu();
  }

  private handlePlayerActions(
    myPlayer: PlayerView,
    actions: PlayerActions,
    tile: TileRef,
  ) {
    this.buildMenu.playerActions = actions;

    const recipient = this.game.owner(tile) as PlayerView;
    if (recipient instanceof TerraNulliusImpl) return;

    if (this.ctModal && myPlayer) {
      this.ctModal.setSender(myPlayer);
      this.ctModal.setRecipient(recipient);
    }

    const buildSubMenu: MenuItem[] = [
      ...flattenedBuildTable.map((item: BuildItemDisplay) => ({
        id: `build_${item.unitType}`,
        name: item.key
          ? item.key.replace("unit_type.", "")
          : item.unitType.toString(),
        disabled: !this.buildMenu.canBuild(item),
        action: () => {
          this.eventBus.emit(
            new BuildUnitIntentEvent(
              item.unitType,
              new Cell(this.game.x(tile), this.game.y(tile)),
            ),
          );
        },
        color: this.buildMenu.canBuild(item) ? COLORS.building : undefined,
        icon: item.icon,
        tooltipItems: [
          { text: translateText(item.key || ""), className: "title" },
          {
            text: translateText(item.description || ""),
            className: "description",
          },
          {
            text: `${renderNumber(this.buildMenu.cost(item))} ${translateText("player_panel.gold")}`,
            className: "cost",
          },
          item.countable
            ? {
                text: `${this.buildMenu.count(item)}x`,
                className: "count",
              }
            : null,
        ].filter((item) => item !== null),
      })),
      {
        id: "build_menu",
        name: "build",
        disabled: false,
        action: () => {
          this.buildMenu.showMenu(tile);
        },
        color: COLORS.build,
        icon: buildIcon,
      },
    ];

    const infoSubMenu: MenuItem[] = [
      {
        id: "info_chat",
        name: "chat",
        disabled: false,
        action: () => {},
        color: COLORS.chat.default,
        icon: chatIcon,
        children: this.createQuickChatMenu(recipient),
      },
      {
        id: "info_emoji",
        name: "emoji",
        disabled: false,
        action: () => {},
        color: COLORS.infoEmoji,
        icon: emojiIcon,
        children: [
          ...flattenedEmojiTable.slice(0, 11).map((emoji, index) => ({
            id: `emoji_${index}`,
            name: emoji,
            text: emoji,
            disabled: false,
            fontSize: "30px",
            action: () => {
              const targetPlayer =
                recipient === this.game.myPlayer()
                  ? AllPlayers
                  : (recipient as PlayerView);
              this.eventBus.emit(new SendEmojiIntentEvent(targetPlayer, index));
            },
          })),
          {
            id: "emoji_more",
            name: "more",
            disabled: false,
            color: COLORS.infoEmoji,
            icon: emojiIcon,
            action: () => {
              this.emojiTable.showTable((emoji) => {
                const targetPlayer =
                  recipient === this.game.myPlayer()
                    ? AllPlayers
                    : (recipient as PlayerView);
                this.eventBus.emit(
                  new SendEmojiIntentEvent(
                    targetPlayer,
                    flattenedEmojiTable.indexOf(emoji),
                  ),
                );
                this.emojiTable.hideTable();
              });
            },
          },
        ],
      },
      {
        id: "info_player",
        name: "player",
        disabled: false,
        action: () => {
          this.playerPanel.show(actions, tile);
        },
        color: COLORS.info,
        icon: infoIcon,
      },
    ];

    const isAlly = !!actions?.interaction?.canBreakAlliance;
    const allySubMenu: MenuItem[] = [
      {
        id: "ally_target",
        name: "target",
        disabled: false,
        action: () => {
          this.eventBus.emit(new SendTargetPlayerIntentEvent(recipient.id()));
        },
        color: COLORS.target,
        icon: targetIcon,
      },
      {
        id: "ally_request",
        name: "request",
        disabled: !actions?.interaction?.canSendAllianceRequest,
        displayed: !isAlly,
        action: () => {
          this.eventBus.emit(
            new SendAllianceRequestIntentEvent(myPlayer, recipient),
          );
        },
        color: COLORS.ally,
        icon: allianceIcon,
      },
      {
        id: "ally_break",
        name: "break",
        disabled: !actions?.interaction?.canBreakAlliance,
        displayed: isAlly,
        action: () => {
          this.eventBus.emit(
            new SendBreakAllianceIntentEvent(myPlayer, recipient),
          );
        },
        color: COLORS.breakAlly,
        icon: traitorIcon,
      },
      {
        id: "ally_donate_gold",
        name: "donate gold",
        disabled: !actions?.interaction?.canDonate,
        action: () => {
          this.eventBus.emit(new SendDonateGoldIntentEvent(recipient, null));
        },
        color: COLORS.ally,
        icon: donateGoldIcon,
      },
      {
        id: "ally_donate_troops",
        name: "donate troops",
        disabled: !actions?.interaction?.canDonate,
        action: () => {
          this.eventBus.emit(new SendDonateTroopsIntentEvent(recipient, null));
        },
        color: COLORS.ally,
        icon: donateTroopIcon,
      },
      {
        id: "ally_trade",
        name: "trade",
        disabled: !!actions?.interaction?.canEmbargo,
        displayed: !actions?.interaction?.canEmbargo,
        action: () => {
          this.eventBus.emit(new SendEmbargoIntentEvent(recipient, "start"));
        },
        color: COLORS.trade,
        text: translateText("player_panel.start_trade"),
      },
      {
        id: "ally_embargo",
        name: "embargo",
        disabled: !actions?.interaction?.canEmbargo,
        displayed: !!actions?.interaction?.canEmbargo,
        action: () => {
          this.eventBus.emit(new SendEmbargoIntentEvent(recipient, "stop"));
        },
        color: COLORS.embargo,
        text: translateText("player_panel.stop_trade"),
      },
    ].filter((item) => item.displayed !== false);

    const updatedMenuItems: MenuItem[] = [
      {
        id: Slot.Boat.toString(),
        name: "boat",
        disabled: !actions.buildableUnits.find(
          (bu) => bu.type === UnitType.TransportShip,
        )?.canBuild,
        action: () => {
          myPlayer.bestTransportShipSpawn(tile).then((spawn) => {
            let spawnTile: Cell | null = null;
            if (spawn !== false) {
              spawnTile = new Cell(this.game.x(spawn), this.game.y(spawn));
            }

            if (this.clickedCell === null) return;
            this.eventBus.emit(
              new SendBoatAttackIntentEvent(
                recipient.id(),
                this.clickedCell,
                this.uiState.attackRatio * myPlayer.troops(),
                spawnTile,
              ),
            );
          });
        },
        color: COLORS.boat,
        icon: boatIcon,
      },
      {
        id: Slot.Ally.toString(),
        name: "ally",
        disabled: !(
          actions?.interaction?.canSendAllianceRequest ||
          actions?.interaction?.canBreakAlliance
        ),
        action: () => {},
        color: actions?.interaction?.canSendAllianceRequest
          ? COLORS.ally
          : actions?.interaction?.canBreakAlliance
            ? COLORS.breakAlly
            : undefined,
        icon: actions?.interaction?.canSendAllianceRequest
          ? allianceIcon
          : actions?.interaction?.canBreakAlliance
            ? traitorIcon
            : undefined,
        children: allySubMenu,
      },
      {
        id: Slot.Build.toString(),
        name: "build",
        disabled: this.game.inSpawnPhase(),
        action: () => {},
        color: COLORS.build,
        icon: buildIcon,
        children: buildSubMenu,
      },
      {
        id: Slot.Info.toString(),
        name: "info",
        disabled: !this.game.hasOwner(tile),
        action: () => {},
        color: COLORS.info,
        icon: infoIcon,
        children: infoSubMenu,
      },
    ];

    this.radialMenu.setRootMenuItems(updatedMenuItems);
    this.updateCenterButton(actions);
  }

  private updateCenterButton(actions: PlayerActions) {
    if (actions.canAttack) {
      this.radialMenu.enableCenterButton(true, () => {
        if (this.clickedCell === null) return;
        const clicked = this.game.ref(this.clickedCell.x, this.clickedCell.y);
        const myPlayer = this.game.myPlayer();
        if (myPlayer !== null && this.game.owner(clicked) !== myPlayer) {
          this.eventBus.emit(
            new SendAttackIntentEvent(
              this.game.owner(clicked).id(),
              this.uiState.attackRatio * myPlayer.troops(),
            ),
          );
        }
        this.radialMenu.hideRadialMenu();
      });
    }
  }

  async tick() {
    if (!this.radialMenu.isMenuVisible() || this.clickedCell === null) return;

    const currentTime = new Date().getTime();
    if (
      currentTime - this.lastTickRefresh < this.tickRefreshInterval &&
      !this.needsRefresh
    ) {
      return;
    }

    const myPlayer = this.game.myPlayer();
    if (myPlayer === null || !myPlayer.isAlive()) return;

    const tile = this.game.ref(this.clickedCell.x, this.clickedCell.y);

    const isSpawnPhase = this.game.inSpawnPhase();

    if (this.wasInSpawnPhase !== isSpawnPhase) {
      if (this.wasInSpawnPhase && !isSpawnPhase) {
        this.needsRefresh = true;
        this.wasInSpawnPhase = isSpawnPhase;

        const actions = await myPlayer.actions(tile);
        this.updateMenuState(actions, tile);

        this.radialMenu.refreshMenu();
        return;
      }

      this.closeMenu();
      return;
    }

    // Check if tile ownership has changed
    if (this.originalTileOwner.isPlayer()) {
      if (this.game.owner(tile) !== this.originalTileOwner) {
        this.closeMenu();
        return;
      }
    } else {
      if (
        this.game.owner(tile).isPlayer() ||
        this.game.owner(tile) === myPlayer
      ) {
        this.closeMenu();
        return;
      }
    }

    this.lastTickRefresh = currentTime;
    this.needsRefresh = false;

    const actions = await myPlayer.actions(tile);
    this.updateMenuState(actions, tile);
  }

  private updateMenuState(actions: PlayerActions, tile: TileRef) {
    if (this.radialMenu.getCurrentLevel() === 0) {
      this.radialMenu.enableCenterButton(false);
      this.updateCenterButton(actions);
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

  private createQuickChatMenu(recipient: PlayerView): MenuItem[] {
    if (!this.ctModal) {
      consolex.warn("Chat modal not set");
      return [];
    }

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      consolex.warn("Current player not found");
      return [];
    }

    return this.ctModal.categories.map((category) => {
      const categoryTranslation = translateText(`chat.cat.${category.id}`);

      const categoryColor =
        COLORS.chat[category.id as keyof typeof COLORS.chat] ||
        COLORS.chat.default;
      const phrases = quickChatPhrases[category.id] || [];

      const phraseItems: MenuItem[] = phrases.map((phrase: QuickChatPhrase) => {
        const phraseText = translateText(`chat.${category.id}.${phrase.key}`);

        return {
          id: `phrase-${category.id}-${phrase.key}`,
          name: phraseText,
          disabled: false,
          text: this.shortenText(phraseText),
          fontSize: "10px",
          color: categoryColor,
          tooltipItems: [
            {
              text: phraseText,
              className: "description",
            },
          ],
          action: () => {
            if (phrase.requiresPlayer) {
              this.ctModal.openWithSelection(
                category.id,
                phrase.key,
                myPlayer,
                recipient,
              );
              this.radialMenu.hideRadialMenu();
            } else {
              this.eventBus.emit(
                new SendQuickChatEvent(
                  recipient,
                  `${category.id}.${phrase.key}`,
                  {},
                ),
              );
              this.radialMenu.hideRadialMenu();
            }
          },
        };
      });

      return {
        id: `chat-category-${category.id}`,
        name: categoryTranslation,
        disabled: false,
        text: categoryTranslation,
        color: categoryColor,
        action: () => {},
        children: phraseItems,
      };
    });
  }

  private shortenText(text: string, maxLength = 15): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + "...";
  }
}
