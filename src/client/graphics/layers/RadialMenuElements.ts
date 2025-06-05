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
import { renderNumber, translateText } from "../../Utils";
import { BuildItemDisplay, BuildMenu, flattenedBuildTable } from "./BuildMenu";
import { ChatIntegration } from "./ChatIntegration";
import { EmojiTable } from "./EmojiTable";
import { PlayerActionHandler } from "./PlayerActionHandler";
import { PlayerPanel } from "./PlayerPanel";
import { TooltipItem } from "./RadialMenu";

import allianceIcon from "../../../../resources/images/AllianceIconWhite.svg";
import boatIcon from "../../../../resources/images/BoatIconWhite.svg";
import buildIcon from "../../../../resources/images/BuildIconWhite.svg";
import chatIcon from "../../../../resources/images/ChatIconWhite.svg";
import donateGoldIcon from "../../../../resources/images/DonateGoldIconWhite.svg";
import donateTroopIcon from "../../../../resources/images/DonateTroopIconWhite.svg";
import emojiIcon from "../../../../resources/images/EmojiIconWhite.svg";
import infoIcon from "../../../../resources/images/InfoIcon.svg";
import targetIcon from "../../../../resources/images/TargetIconWhite.svg";
import traitorIcon from "../../../../resources/images/TraitorIconWhite.svg";

export interface MenuElementParams {
  myPlayer: PlayerView;
  selected: PlayerView | null;
  tileOwner: PlayerView | TerraNullius;
  tile: TileRef;
  playerActions: PlayerActions;
  game: GameView;
  buildMenu: BuildMenu;
  emojiTable: EmojiTable;
  playerActionHandler: PlayerActionHandler;
  playerPanel: PlayerPanel;
  chatIntegration: ChatIntegration;
  closeMenu: () => void;
}

export interface MenuElement {
  id: string;
  name: string;
  disabled: boolean;
  displayed?: boolean;
  color?: string;
  icon?: string;
  text?: string;
  fontSize?: string;
  tooltipItems?: TooltipItem[];

  action?: (params: MenuElementParams) => void; // For leaf items that perform actions
  subMenu?: (params: MenuElementParams) => MenuElement[]; // For non-leaf items that open submenus

  // Runtime properties used by RadialMenu (not to be set by menu element creators)
  children?: MenuElement[];
  _action?: () => void;
}

export const COLORS = {
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
    warnings: "#e3c532",
  },
};

export enum Slot {
  Info = "info",
  Boat = "boat",
  Build = "build",
  Ally = "ally",
  Back = "back",
}

/**
 * Convert a MenuElement tree to a version usable by the RadialMenu
 * by resolving subMenu functions and setting up actions
 */
export function prepareMenuElementsForRadialMenu(
  elements: MenuElement[],
  params: MenuElementParams,
): MenuElement[] {
  return elements.map((element) => {
    const prepared: MenuElement = { ...element };

    // If the element has a subMenu function, execute it to get the children
    if (element.subMenu) {
      prepared.children = prepareMenuElementsForRadialMenu(
        element.subMenu(params),
        params,
      );
      // We don't need the subMenu function anymore
      prepared.subMenu = undefined;
    }

    // Set up the action function to call the element's action with params
    if (element.action) {
      prepared._action = () => element.action!(params);
    } else {
      prepared._action = () => {};
    }

    return prepared;
  });
}

export const buildMenuElement: MenuElement = {
  id: Slot.Build,
  name: "build",
  disabled: false,
  icon: buildIcon,
  color: COLORS.build,

  subMenu: (params: MenuElementParams) => {
    const buildElements: MenuElement[] = flattenedBuildTable.map(
      (item: BuildItemDisplay) => ({
        id: `build_${item.unitType}`,
        name: item.key
          ? item.key.replace("unit_type.", "")
          : item.unitType.toString(),
        disabled: !params.buildMenu.canBuild(item),
        color: params.buildMenu.canBuild(item) ? COLORS.building : undefined,
        icon: item.icon,
        tooltipItems: [
          { text: translateText(item.key || ""), className: "title" },
          {
            text: translateText(item.description || ""),
            className: "description",
          },
          {
            text: `${renderNumber(params.buildMenu.cost(item))} ${translateText("player_panel.gold")}`,
            className: "cost",
          },
          item.countable
            ? { text: `${params.buildMenu.count(item)}x`, className: "count" }
            : null,
        ].filter((item): item is TooltipItem => item !== null),
        action: (params: MenuElementParams) => {
          params.playerActionHandler.handleBuildUnit(
            item.unitType,
            params.game.x(params.tile),
            params.game.y(params.tile),
          );
          params.closeMenu();
        },
      }),
    );

    buildElements.push({
      id: "build_menu",
      name: "build",
      disabled: false,
      color: COLORS.build,
      icon: buildIcon,
      action: (params: MenuElementParams) => {
        params.buildMenu.showMenu(params.tile);
      },
    });

    return buildElements;
  },
};

export const boatMenuElement: MenuElement = {
  id: Slot.Boat,
  name: "boat",
  disabled: false,
  icon: boatIcon,
  color: COLORS.boat,

  action: async (params: MenuElementParams) => {
    if (!params.selected) return;

    const spawn = await params.playerActionHandler.findBestTransportShipSpawn(
      params.myPlayer,
      params.tile,
    );

    let spawnTile: Cell | null = null;
    if (spawn !== false) {
      spawnTile = new Cell(params.game.x(spawn), params.game.y(spawn));
    }

    params.playerActionHandler.handleBoatAttack(
      params.myPlayer,
      params.selected.id(),
      new Cell(params.game.x(params.tile), params.game.y(params.tile)),
      spawnTile,
    );

    params.closeMenu();
  },
};

export const infoMenuElement: MenuElement = {
  id: Slot.Info,
  name: "info",
  disabled: false,
  icon: infoIcon,
  color: COLORS.info,

  subMenu: (params: MenuElementParams) => {
    if (!params.selected) return [];

    return [
      {
        id: "info_chat",
        name: "chat",
        disabled: false,
        color: COLORS.chat.default,
        icon: chatIcon,
        subMenu: (params: MenuElementParams) =>
          params.chatIntegration
            .createQuickChatMenu(params.selected!)
            .map((item) => ({
              ...item,
              action: item.action
                ? (_params: MenuElementParams) => item.action!(params)
                : undefined,
            })),
      },
      {
        id: "ally_target",
        name: "target",
        disabled: false,
        color: COLORS.target,
        icon: targetIcon,
        action: (params: MenuElementParams) => {
          params.playerActionHandler.handleTargetPlayer(params.selected!.id());
          params.closeMenu();
        },
      },
      {
        id: "ally_trade",
        name: "trade",
        disabled: !!params.playerActions?.interaction?.canEmbargo,
        displayed: !params.playerActions?.interaction?.canEmbargo,
        color: COLORS.trade,
        text: translateText("player_panel.start_trade"),
        action: (params: MenuElementParams) => {
          params.playerActionHandler.handleEmbargo(params.selected!, "start");
          params.closeMenu();
        },
      },
      {
        id: "ally_embargo",
        name: "embargo",
        disabled: !params.playerActions?.interaction?.canEmbargo,
        displayed: !!params.playerActions?.interaction?.canEmbargo,
        color: COLORS.embargo,
        text: translateText("player_panel.stop_trade"),
        action: (params: MenuElementParams) => {
          params.playerActionHandler.handleEmbargo(params.selected!, "stop");
          params.closeMenu();
        },
      },
      {
        id: "ally_request",
        name: "request",
        disabled: !params.playerActions?.interaction?.canSendAllianceRequest,
        displayed: !params.playerActions?.interaction?.canBreakAlliance,
        color: COLORS.ally,
        icon: allianceIcon,
        action: (params: MenuElementParams) => {
          params.playerActionHandler.handleAllianceRequest(
            params.myPlayer,
            params.selected!,
          );
          params.closeMenu();
        },
      },
      {
        id: "ally_break",
        name: "break",
        disabled: !params.playerActions?.interaction?.canBreakAlliance,
        displayed: !!params.playerActions?.interaction?.canBreakAlliance,
        color: COLORS.breakAlly,
        icon: traitorIcon,
        action: (params: MenuElementParams) => {
          params.playerActionHandler.handleBreakAlliance(
            params.myPlayer,
            params.selected!,
          );
          params.closeMenu();
        },
      },

      {
        id: "ally_donate_gold",
        name: "donate gold",
        disabled: !params.playerActions?.interaction?.canDonate,
        color: COLORS.ally,
        icon: donateGoldIcon,
        action: (params: MenuElementParams) => {
          params.playerActionHandler.handleDonateGold(params.selected!);
          params.closeMenu();
        },
      },
      {
        id: "ally_donate_troops",
        name: "donate troops",
        disabled: !params.playerActions?.interaction?.canDonate,
        color: COLORS.ally,
        icon: donateTroopIcon,
        action: (params: MenuElementParams) => {
          params.playerActionHandler.handleDonateTroops(params.selected!);
          params.closeMenu();
        },
      },
      {
        id: "info_player",
        name: "player",
        disabled: false,
        color: COLORS.info,
        icon: infoIcon,
        action: (params: MenuElementParams) => {
          params.playerPanel.show(params.playerActions, params.tile);
        },
      },
      {
        id: "info_emoji",
        name: "emoji",
        disabled: false,
        color: COLORS.infoEmoji,
        icon: emojiIcon,
        subMenu: () => {
          const emojiElements: MenuElement[] = [];

          const emojiCount = 15;
          for (let i = 0; i < emojiCount; i++) {
            emojiElements.push({
              id: `emoji_${i}`,
              name: flattenedEmojiTable[i],
              text: flattenedEmojiTable[i],
              disabled: false,
              fontSize: "25px",
              action: (params: MenuElementParams) => {
                const targetPlayer =
                  params.selected === params.game.myPlayer()
                    ? AllPlayers
                    : params.selected;
                params.playerActionHandler.handleEmoji(targetPlayer!, i);
                params.closeMenu();
              },
            });
          }

          emojiElements.push({
            id: "emoji_more",
            name: "more",
            disabled: false,
            color: COLORS.infoEmoji,
            icon: emojiIcon,
            action: (params: MenuElementParams) => {
              params.emojiTable.showTable((emoji) => {
                const targetPlayer =
                  params.selected === params.game.myPlayer()
                    ? AllPlayers
                    : params.selected;
                params.playerActionHandler.handleEmoji(
                  targetPlayer!,
                  flattenedEmojiTable.indexOf(emoji),
                );
                params.emojiTable.hideTable();
              });
            },
          });

          return emojiElements;
        },
      },
    ].filter((item) => item.displayed !== false);
  },
};

export function createMenuItems(params: MenuElementParams): MenuElement[] {
  const canBuildTransport = params.playerActions.buildableUnits.find(
    (bu) => bu.type === UnitType.TransportShip,
  )?.canBuild;

  return [
    {
      ...boatMenuElement,
      disabled: !canBuildTransport || !params.selected,
    },
    {
      ...buildMenuElement,
      disabled: params.game.inSpawnPhase(),
    },
    {
      ...infoMenuElement,
      disabled: !params.game.hasOwner(params.tile),
    },
  ];
}

export function createRadialMenuItems(
  params: MenuElementParams,
): MenuElement[] {
  const elements = createMenuItems(params);
  return prepareMenuElementsForRadialMenu(elements, params);
}

export function getRootMenuItems(): MenuElement[] {
  return [
    {
      id: Slot.Boat,
      name: "boat",
      disabled: true,
      _action: () => {},
      icon: boatIcon,
    },
    {
      id: Slot.Build,
      name: "build",
      disabled: true,
      _action: () => {},
      icon: buildIcon,
    },
    {
      id: Slot.Info,
      name: "info",
      disabled: true,
      _action: () => {},
      icon: infoIcon,
    },
  ];
}

export function updateCenterButton(
  params: MenuElementParams,
  enableCenterButton: (enabled: boolean, action?: (() => void) | null) => void,
) {
  if (params.playerActions.canAttack) {
    enableCenterButton(true, () => {
      if (params.tileOwner !== params.myPlayer) {
        params.playerActionHandler.handleAttack(
          params.myPlayer,
          params.tileOwner.id(),
        );
      }
      params.closeMenu();
    });
  } else {
    enableCenterButton(false);
  }
}
