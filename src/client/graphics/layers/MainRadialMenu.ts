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
  SendAllianceRequestIntentEvent,
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendBreakAllianceIntentEvent,
  SendEmojiIntentEvent,
  SendSpawnIntentEvent,
} from "../../Transport";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { BuildMenu } from "./BuildMenu";
import { EmojiTable } from "./EmojiTable";
import { Layer } from "./Layer";
import { PlayerInfoOverlay } from "./PlayerInfoOverlay";
import { PlayerPanel } from "./PlayerPanel";
import { MenuItem, RadialMenu, RadialMenuConfig } from "./RadialMenu";

import allianceIcon from "../../../../resources/images/AllianceIconWhite.svg";
import boatIcon from "../../../../resources/images/BoatIconWhite.svg";
import buildIcon from "../../../../resources/images/BuildIconWhite.svg";
import infoIcon from "../../../../resources/images/InfoIcon.svg";
import swordIcon from "../../../../resources/images/SwordIconWhite.svg";
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
  boat: "#3f6ab1",
  ally: "#53ac75",
  breakAlly: "#c74848",
  buildTower: "#e67e22",
  buildWall: "#3498db",
  buildFarm: "#2ecc71",
  buildAdvanced: "#9b59b6",
  buildPort: "#1abc9c",
  buildBarracks: "#e74c3c",
  info: "#64748B",
  infoDetails: "#7f8c8d",
  infoEmoji: "#f1c40f",
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

    if (this.game.inSpawnPhase()) {
      if (this.game.isLand(tile) && !this.game.hasOwner(tile)) {
        this.radialMenu.enableCenterButton(true, () => {
          if (this.clickedCell === null) return;
          this.eventBus.emit(new SendSpawnIntentEvent(this.clickedCell));
          this.radialMenu.hideRadialMenu();
        });
      }
      return;
    }

    const myPlayer = this.game.myPlayer();
    if (myPlayer === null) {
      consolex.warn("my player not found");
      return;
    }
    if (myPlayer && !myPlayer.isAlive() && !this.game.inSpawnPhase()) {
      return this.radialMenu.hideRadialMenu();
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
    const buildSubMenu: MenuItem[] = [
      {
        id: "build_tower",
        name: "tower",
        disabled: false,
        action: () => {
          this.buildMenu.showMenu(tile);
        },
        color: COLORS.buildTower,
        icon: buildIcon,
      },
      {
        id: "build_wall",
        name: "wall",
        disabled: false,
        action: () => {
          this.buildMenu.showMenu(tile);
        },
        color: COLORS.buildWall,
        icon: buildIcon,
      },
      {
        id: "build_farm",
        name: "farm",
        disabled: false,
        action: () => {
          this.buildMenu.showMenu(tile);
        },
        color: COLORS.buildFarm,
        icon: buildIcon,
      },
      {
        id: "build_advanced",
        name: "advanced",
        disabled: false,
        color: COLORS.buildAdvanced,
        icon: buildIcon,
        action: () => {},
        children: [
          {
            id: "build_port",
            name: "port",
            disabled: false,
            action: () => {
              this.buildMenu.showMenu(tile);
            },
            color: COLORS.buildPort,
            icon: boatIcon,
            children: [
              {
                id: "build_port_advanced",
                name: "advanced",
                disabled: false,
                action: () => {},
                color: COLORS.buildPort,
                icon: boatIcon,
              },
            ],
          },
          {
            id: "build_barracks",
            name: "barracks",
            disabled: false,
            action: () => {
              this.buildMenu.showMenu(tile);
            },
            color: COLORS.buildBarracks,
            icon: swordIcon,
          },
        ],
      },
    ];

    const infoSubMenu: MenuItem[] = [
      {
        id: "info_details",
        name: "details",
        disabled: false,
        action: () => {
          this.playerPanel.show(actions, tile);
        },
        color: COLORS.infoDetails,
        icon: infoIcon,
      },
      {
        id: "info_emoji",
        name: "emoji",
        disabled: false,
        action: () => {
          const targetPlayer = this.game.owner(tile);
          if (targetPlayer instanceof TerraNulliusImpl) return;

          this.emojiTable.showTable((emoji) => {
            const recipient =
              targetPlayer === this.game.myPlayer()
                ? AllPlayers
                : (targetPlayer as PlayerView);
            this.eventBus.emit(
              new SendEmojiIntentEvent(
                recipient,
                flattenedEmojiTable.indexOf(emoji),
              ),
            );
            this.emojiTable.hideTable();
          });
        },
        color: COLORS.infoEmoji,
        icon: infoIcon,
      },
    ];

    const updatedMenuItems: MenuItem[] = [
      {
        id: Slot.Boat.toString(),
        name: "boat",
        disabled: !actions.buildableUnits.find(
          (bu) => bu.type === UnitType.TransportShip,
        )?.canBuild,
        action: () => {
          // BestTransportShipSpawn is an expensive operation
          myPlayer.bestTransportShipSpawn(tile).then((spawn) => {
            let spawnTile: Cell | null = null;
            if (spawn !== false) {
              spawnTile = new Cell(this.game.x(spawn), this.game.y(spawn));
            }

            if (this.clickedCell === null) return;
            this.eventBus.emit(
              new SendBoatAttackIntentEvent(
                this.game.owner(tile).id(),
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
        action: () => {
          if (actions?.interaction?.canSendAllianceRequest) {
            this.eventBus.emit(
              new SendAllianceRequestIntentEvent(
                myPlayer,
                this.game.owner(tile) as PlayerView,
              ),
            );
          } else if (actions?.interaction?.canBreakAlliance) {
            this.eventBus.emit(
              new SendBreakAllianceIntentEvent(
                myPlayer,
                this.game.owner(tile) as PlayerView,
              ),
            );
          }
        },
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
      // Game phase has changed, close menu to prevent stale actions
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
      this.radialMenu.updateMenuItem(Slot.Ally.toString(), false);
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
}
