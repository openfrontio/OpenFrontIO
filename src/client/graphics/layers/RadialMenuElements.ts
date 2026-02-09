import { Config } from "../../../core/configuration/Config";
import { AllPlayers, PlayerActions, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { Emoji, flattenedEmojiTable } from "../../../core/Util";
import { renderNumber, translateText } from "../../Utils";
import { UIState } from "../UIState";
import { BuildItemDisplay, BuildMenu, flattenedBuildTable } from "./BuildMenu";
import { ChatIntegration } from "./ChatIntegration";
import { EmojiTable } from "./EmojiTable";
import { PlayerActionHandler } from "./PlayerActionHandler";
import { PlayerPanel } from "./PlayerPanel";
import { TooltipItem } from "./RadialMenu";

import { EventBus } from "../../../core/EventBus";
import allianceIcon from "/images/AllianceIconWhite.svg?url";
import boatIcon from "/images/BoatIconWhite.svg?url";
import buildIcon from "/images/BuildIconWhite.svg?url";
import chatIcon from "/images/ChatIconWhite.svg?url";
import donateGoldIcon from "/images/DonateGoldIconWhite.svg?url";
import donateTroopIcon from "/images/DonateTroopIconWhite.svg?url";
import emojiIcon from "/images/EmojiIconWhite.svg?url";
import infoIcon from "/images/InfoIcon.svg?url";
import swordIcon from "/images/SwordIconWhite.svg?url";
import targetIcon from "/images/TargetIconWhite.svg?url";
import traitorIcon from "/images/TraitorIconWhite.svg?url";
import xIcon from "/images/XIcon.svg?url";

export interface MenuElementParams {
  myPlayer: PlayerView;
  selected: PlayerView | null;
  tile: TileRef;
  playerActions: PlayerActions;
  game: GameView;
  buildMenu: BuildMenu;
  emojiTable: EmojiTable;
  playerActionHandler: PlayerActionHandler;
  playerPanel: PlayerPanel;
  chatIntegration: ChatIntegration;
  eventBus: EventBus;
  uiState?: UIState;
  closeMenu: () => void;
}

export interface MenuElement {
  id: string;
  name: string;
  displayed?: boolean | ((params: MenuElementParams) => boolean);
  color?: string;
  icon?: string;
  text?: string;
  fontSize?: string;
  tooltipItems?: TooltipItem[];
  tooltipKeys?: TooltipKey[];

  cooldown?: (params: MenuElementParams) => number;
  disabled: (params: MenuElementParams) => boolean;
  action?: (params: MenuElementParams) => void; // For leaf items that perform actions
  subMenu?: (params: MenuElementParams) => MenuElement[]; // For non-leaf items that open submenus
}

export interface TooltipKey {
  key: string;
  className: string;
  params?: Record<string, string | number>;
}

export interface CenterButtonElement {
  disabled: (params: MenuElementParams) => boolean;
  action: (params: MenuElementParams) => void;
}

export const COLORS = {
  build: "#ebe250",
  building: "#2c2c2c",
  boat: "#3f6ab1",
  ally: "#53ac75",
  breakAlly: "#c74848",
  delete: "#ff0000",
  info: "#64748B",
  target: "#ff0000",
  attack: "#ff0000",
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
  Attack = "attack",
  Ally = "ally",
  Back = "back",
  Delete = "delete",
}

function isFriendlyTarget(params: MenuElementParams): boolean {
  const selectedPlayer = params.selected;
  if (selectedPlayer === null) return false;
  const isFriendly = (selectedPlayer as PlayerView).isFriendly;
  if (typeof isFriendly !== "function") return false;
  return isFriendly.call(selectedPlayer, params.myPlayer);
}

function isDisconnectedTarget(params: MenuElementParams): boolean {
  const selectedPlayer = params.selected;
  if (selectedPlayer === null) return false;
  const isDisconnected = (selectedPlayer as PlayerView).isDisconnected;
  if (typeof isDisconnected !== "function") return false;
  return isDisconnected.call(selectedPlayer);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const infoChatElement: MenuElement = {
  id: "info_chat",
  name: "chat",
  disabled: () => false,
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
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyTargetElement: MenuElement = {
  id: "ally_target",
  name: "target",
  disabled: (params: MenuElementParams): boolean => {
    if (params.selected === null) return true;
    return !params.playerActions.interaction?.canTarget;
  },
  color: COLORS.target,
  icon: targetIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleTargetPlayer(params.selected!.id());
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyTradeElement: MenuElement = {
  id: "ally_trade",
  name: "trade",
  disabled: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canEmbargo,
  displayed: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canEmbargo,
  color: COLORS.trade,
  text: translateText("player_panel.start_trade"),
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleEmbargo(params.selected!, "stop");
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyEmbargoElement: MenuElement = {
  id: "ally_embargo",
  name: "embargo",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canEmbargo,
  displayed: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canEmbargo,
  color: COLORS.embargo,
  text: translateText("player_panel.stop_trade"),
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleEmbargo(params.selected!, "start");
    params.closeMenu();
  },
};

const allyRequestElement: MenuElement = {
  id: "ally_request",
  name: "request",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canSendAllianceRequest,
  displayed: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canBreakAlliance,
  color: COLORS.ally,
  icon: allianceIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleAllianceRequest(
      params.myPlayer,
      params.selected!,
    );
    params.closeMenu();
  },
};

const allyBreakElement: MenuElement = {
  id: "ally_break",
  name: "break",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canBreakAlliance,
  displayed: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canBreakAlliance,
  color: COLORS.breakAlly,
  icon: traitorIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleBreakAlliance(
      params.myPlayer,
      params.selected!,
    );
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyDonateGoldElement: MenuElement = {
  id: "ally_donate_gold",
  name: "donate gold",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canDonateGold,
  color: COLORS.ally,
  icon: donateGoldIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleDonateGold(params.selected!);
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyDonateTroopsElement: MenuElement = {
  id: "ally_donate_troops",
  name: "donate troops",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canDonateTroops,
  color: COLORS.ally,
  icon: donateTroopIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleDonateTroops(params.selected!);
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const infoPlayerElement: MenuElement = {
  id: "info_player",
  name: "player",
  disabled: () => false,
  color: COLORS.info,
  icon: infoIcon,
  action: (params: MenuElementParams) => {
    params.playerPanel.show(params.playerActions, params.tile);
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const infoEmojiElement: MenuElement = {
  id: "info_emoji",
  name: "emoji",
  disabled: () => false,
  color: COLORS.infoEmoji,
  icon: emojiIcon,
  subMenu: (params: MenuElementParams) => {
    const emojiElements: MenuElement[] = [
      {
        id: "emoji_more",
        name: "more",
        disabled: () => false,
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
              flattenedEmojiTable.indexOf(emoji as Emoji),
            );
            params.emojiTable.hideTable();
          });
        },
      },
    ];

    const emojiCount = 8;
    for (let i = 0; i < emojiCount; i++) {
      emojiElements.push({
        id: `emoji_${i}`,
        name: flattenedEmojiTable[i],
        text: flattenedEmojiTable[i],
        disabled: () => false,
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

    return emojiElements;
  },
};

export const infoMenuElement: MenuElement = {
  id: Slot.Info,
  name: "info",
  disabled: (params: MenuElementParams) =>
    !params.selected || params.game.inSpawnPhase(),
  icon: infoIcon,
  color: COLORS.info,
  action: (params: MenuElementParams) => {
    params.playerPanel.show(params.playerActions, params.tile);
  },
};

function getAllEnabledUnits(myPlayer: boolean, config: Config): Set<UnitType> {
  const Units: Set<UnitType> = new Set<UnitType>();

  const addStructureIfEnabled = (unitType: UnitType) => {
    if (!config.isUnitDisabled(unitType)) {
      Units.add(unitType);
    }
  };

  if (myPlayer) {
    addStructureIfEnabled(UnitType.City);
    addStructureIfEnabled(UnitType.DefensePost);
    addStructureIfEnabled(UnitType.Port);
    addStructureIfEnabled(UnitType.MissileSilo);
    addStructureIfEnabled(UnitType.SAMLauncher);
    addStructureIfEnabled(UnitType.Factory);
  } else {
    addStructureIfEnabled(UnitType.Warship);
    addStructureIfEnabled(UnitType.HydrogenBomb);
    addStructureIfEnabled(UnitType.MIRV);
    addStructureIfEnabled(UnitType.AtomBomb);
  }

  return Units;
}

const ATTACK_UNIT_TYPES: UnitType[] = [
  UnitType.AtomBomb,
  UnitType.MIRV,
  UnitType.HydrogenBomb,
  UnitType.Warship,
];

function createMenuElements(
  params: MenuElementParams,
  filterType: "attack" | "build",
  elementIdPrefix: string,
): MenuElement[] {
  const unitTypes: Set<UnitType> = getAllEnabledUnits(
    params.selected === params.myPlayer,
    params.game.config(),
  );

  return flattenedBuildTable
    .filter(
      (item) =>
        unitTypes.has(item.unitType) &&
        (filterType === "attack"
          ? ATTACK_UNIT_TYPES.includes(item.unitType)
          : !ATTACK_UNIT_TYPES.includes(item.unitType)),
    )
    .map((item: BuildItemDisplay) => ({
      id: `${elementIdPrefix}_${item.unitType}`,
      name: item.key
        ? item.key.replace("unit_type.", "")
        : item.unitType.toString(),
      disabled: (params: MenuElementParams) =>
        !params.buildMenu.canBuildOrUpgrade(item),
      color: params.buildMenu.canBuildOrUpgrade(item)
        ? filterType === "attack"
          ? COLORS.attack
          : COLORS.building
        : undefined,
      icon: item.icon,
      tooltipItems: [
        { text: translateText(item.key ?? ""), className: "title" },
        {
          text: translateText(item.description ?? ""),
          className: "description",
        },
        {
          text: `${renderNumber(params.buildMenu.cost(item))} ${translateText("player_panel.gold")}`,
          className: "cost",
        },
        item.countable
          ? { text: `${params.buildMenu.count(item)}x`, className: "count" }
          : null,
      ].filter(
        (tooltipItem): tooltipItem is TooltipItem => tooltipItem !== null,
      ),
      action: (params: MenuElementParams) => {
        const buildableUnit = params.playerActions.buildableUnits.find(
          (bu) => bu.type === item.unitType,
        );
        if (buildableUnit === undefined) {
          return;
        }
        if (params.buildMenu.canBuildOrUpgrade(item)) {
          params.buildMenu.sendBuildOrUpgrade(buildableUnit, params.tile);
        }
        params.closeMenu();
      },
    }));
}

export const attackMenuElement: MenuElement = {
  id: Slot.Attack,
  name: "radial_attack",
  disabled: (params: MenuElementParams) => params.game.inSpawnPhase(),
  icon: swordIcon,
  color: COLORS.attack,

  subMenu: (params: MenuElementParams) => {
    if (params === undefined) return [];
    return createMenuElements(params, "attack", "attack");
  },
};

const donateGoldRadialElement: MenuElement = {
  id: Slot.Attack,
  name: "radial_donate_gold",
  disabled: (params: MenuElementParams) =>
    params.game.inSpawnPhase() ||
    !params.playerActions?.interaction?.canDonateGold,
  icon: donateGoldIcon,
  color: "#EAB308",
  action: (params: MenuElementParams) => {
    if (!params.selected) return;
    params.playerPanel.openSendGoldModal(
      params.playerActions,
      params.tile,
      params.selected,
    );
  },
};

export const deleteUnitElement: MenuElement = {
  id: Slot.Delete,
  name: "delete",
  cooldown: (params: MenuElementParams) => params.myPlayer.deleteUnitCooldown(),
  disabled: (params: MenuElementParams) => {
    const tileOwner = params.game.owner(params.tile);
    const isLand = params.game.isLand(params.tile);

    if (!tileOwner.isPlayer() || tileOwner.id() !== params.myPlayer.id()) {
      return true;
    }

    if (!isLand) {
      return true;
    }

    if (params.game.inSpawnPhase()) {
      return true;
    }

    if (params.myPlayer.deleteUnitCooldown() > 0) {
      return true;
    }

    const DELETE_SELECTION_RADIUS = 5;
    const myUnits = params.myPlayer
      .units()
      .filter(
        (unit) =>
          !unit.isUnderConstruction() &&
          unit.markedForDeletion() === false &&
          params.game.manhattanDist(unit.tile(), params.tile) <=
            DELETE_SELECTION_RADIUS,
      );

    return myUnits.length === 0;
  },
  icon: xIcon,
  color: COLORS.delete,
  tooltipKeys: [
    {
      key: "radial_menu.delete_unit_title",
      className: "title",
    },
    {
      key: "radial_menu.delete_unit_description",
      className: "description",
    },
  ],
  action: (params: MenuElementParams) => {
    const DELETE_SELECTION_RADIUS = 5;
    const myUnits = params.myPlayer
      .units()
      .filter(
        (unit) =>
          params.game.manhattanDist(unit.tile(), params.tile) <=
          DELETE_SELECTION_RADIUS,
      );

    if (myUnits.length > 0) {
      myUnits.sort(
        (a, b) =>
          params.game.manhattanDist(a.tile(), params.tile) -
          params.game.manhattanDist(b.tile(), params.tile),
      );

      params.playerActionHandler.handleDeleteUnit(myUnits[0].id());
    }

    params.closeMenu();
  },
};

export const buildMenuElement: MenuElement = {
  id: Slot.Build,
  name: "build",
  disabled: (params: MenuElementParams) => params.game.inSpawnPhase(),
  icon: buildIcon,
  color: COLORS.build,

  subMenu: (params: MenuElementParams) => {
    if (params === undefined) return [];
    return createMenuElements(params, "build", "build");
  },
};

export const boatMenuElement: MenuElement = {
  id: Slot.Boat,
  name: "boat",
  disabled: (params: MenuElementParams) =>
    !params.playerActions.buildableUnits.some(
      (unit) => unit.type === UnitType.TransportShip && unit.canBuild,
    ),
  icon: boatIcon,
  color: COLORS.boat,

  action: async (params: MenuElementParams) => {
    params.playerActionHandler.handleBoatAttack(params.myPlayer, params.tile);

    params.closeMenu();
  },
};

export const centerButtonElement: CenterButtonElement = {
  disabled: (params: MenuElementParams): boolean => {
    const tileOwner = params.game.owner(params.tile);
    const isLand = params.game.isLand(params.tile);
    if (!isLand) {
      return true;
    }
    if (params.game.inSpawnPhase()) {
      if (params.game.config().isRandomSpawn()) {
        return true;
      }
      if (tileOwner.isPlayer()) {
        return true;
      }
      return false;
    }

    if (isFriendlyTarget(params) && !isDisconnectedTarget(params)) {
      return !params.playerActions.interaction?.canDonateTroops;
    }

    return !params.playerActions.canAttack;
  },
  action: (params: MenuElementParams) => {
    if (params.game.inSpawnPhase()) {
      params.playerActionHandler.handleSpawn(params.tile);
    } else {
      if (isFriendlyTarget(params) && !isDisconnectedTarget(params)) {
        const selectedPlayer = params.selected as PlayerView;
        const ratio = params.uiState?.attackRatio ?? 1;
        const troopsToDonate = Math.floor(ratio * params.myPlayer.troops());
        if (troopsToDonate > 0) {
          params.playerActionHandler.handleDonateTroops(
            selectedPlayer,
            troopsToDonate,
          );
        }
      } else {
        params.playerActionHandler.handleAttack(
          params.myPlayer,
          params.selected?.id() ?? null,
        );
      }
    }
    params.closeMenu();
  },
};

export const rootMenuElement: MenuElement = {
  id: "root",
  name: "root",
  disabled: () => false,
  icon: infoIcon,
  color: COLORS.info,
  subMenu: (params: MenuElementParams) => {
    const isAllied = params.selected?.isAlliedWith(params.myPlayer);
    const isDisconnected = isDisconnectedTarget(params);

    const tileOwner = params.game.owner(params.tile);
    const isOwnTerritory =
      tileOwner.isPlayer() &&
      (tileOwner as PlayerView).id() === params.myPlayer.id();

    const menuItems: (MenuElement | null)[] = [
      infoMenuElement,
      ...(isOwnTerritory
        ? [deleteUnitElement, allyRequestElement, buildMenuElement]
        : [
            isAllied && !isDisconnected ? allyBreakElement : boatMenuElement,
            allyRequestElement,
            isFriendlyTarget(params) && !isDisconnected
              ? donateGoldRadialElement
              : attackMenuElement,
          ]),
    ];

    return menuItems.filter((item): item is MenuElement => item !== null);
  },
};
