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
import xIcon from "../../../../resources/images/XIcon.svg";
import { Config } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { AllPlayers, PlayerActions, UnitType } from "../../../core/game/Game";
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

export type MenuElementParams = {
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
  closeMenu: () => void;
};

export type MenuElement = {
  id: string;
  name: string;
  displayed?: boolean | ((params: MenuElementParams) => boolean);
  color?: string;
  icon?: string;
  text?: string;
  fontSize?: string;
  tooltipItems?: TooltipItem[];
  tooltipKeys?: TooltipKey[];

  disabled: (params: MenuElementParams) => boolean;
  action?: (params: MenuElementParams) => void; // For leaf items that perform actions
  subMenu?: (params: MenuElementParams) => MenuElement[]; // For non-leaf items that open submenus
};

export type TooltipKey = {
  key: string;
  className: string;
  params?: Record<string, string | number>;
};

export type CenterButtonElement = {
  disabled: (params: MenuElementParams) => boolean;
  action: (params: MenuElementParams) => void;
};

export const COLORS = {
  ally: "#53ac75",
  attack: "#ff0000",
  boat: "#3f6ab1",
  breakAlly: "#c74848",
  build: "#ebe250",
  building: "#2c2c2c",
  chat: {
    attack: "#f44336",
    default: "#66c",
    defend: "#2196f3",
    greet: "#ff9800",
    help: "#4caf50",
    misc: "#9c27b0",
    warnings: "#e3c532",
  },
  delete: "#ff0000",
  embargo: "#6600cc",
  info: "#64748B",
  infoDetails: "#7f8c8d",
  infoEmoji: "#f1c40f",
  target: "#ff0000",
  tooltip: {
    cost: "#ffd700",
    count: "#aaa",
  },
  trade: "#008080",
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

/* eslint-disable @typescript-eslint/no-non-null-assertion */
const infoChatElement: MenuElement = {
  color: COLORS.chat.default,
  disabled: () => false,
  icon: chatIcon,
  id: "info_chat",
  name: "chat",
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

const allyTargetElement: MenuElement = {
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleTargetPlayer(params.selected!.id());
    params.closeMenu();
  },
  color: COLORS.target,
  disabled: (params: MenuElementParams): boolean => {
    if (params.selected === null) return true;
    return !params.playerActions.interaction?.canTarget;
  },
  icon: targetIcon,
  id: "ally_target",
  name: "target",
};

const allyTradeElement: MenuElement = {
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleEmbargo(params.selected!, "stop");
    params.closeMenu();
  },
  color: COLORS.trade,
  disabled: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canEmbargo,
  displayed: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canEmbargo,
  id: "ally_trade",
  name: "trade",
  text: translateText("player_panel.start_trade"),
};

const allyEmbargoElement: MenuElement = {
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleEmbargo(params.selected!, "start");
    params.closeMenu();
  },
  color: COLORS.embargo,
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canEmbargo,
  displayed: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canEmbargo,
  id: "ally_embargo",
  name: "embargo",
  text: translateText("player_panel.stop_trade"),
};

const allyRequestElement: MenuElement = {
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleAllianceRequest(
      params.myPlayer,
      params.selected!,
    );
    params.closeMenu();
  },
  color: COLORS.ally,
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canSendAllianceRequest,
  displayed: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canBreakAlliance,
  icon: allianceIcon,
  id: "ally_request",
  name: "request",
};

const allyBreakElement: MenuElement = {
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleBreakAlliance(
      params.myPlayer,
      params.selected!,
    );
    params.closeMenu();
  },
  color: COLORS.breakAlly,
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canBreakAlliance,
  displayed: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canBreakAlliance,
  icon: traitorIcon,
  id: "ally_break",
  name: "break",
};

const allyDonateGoldElement: MenuElement = {
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleDonateGold(params.selected!);
    params.closeMenu();
  },
  color: COLORS.ally,
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canDonateGold,
  icon: donateGoldIcon,
  id: "ally_donate_gold",
  name: "donate gold",
};

const allyDonateTroopsElement: MenuElement = {
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleDonateTroops(params.selected!);
    params.closeMenu();
  },
  color: COLORS.ally,
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canDonateTroops,
  icon: donateTroopIcon,
  id: "ally_donate_troops",
  name: "donate troops",
};

const infoPlayerElement: MenuElement = {
  action: (params: MenuElementParams) => {
    params.playerPanel.show(params.playerActions, params.tile);
  },
  color: COLORS.info,
  disabled: () => false,
  icon: infoIcon,
  id: "info_player",
  name: "player",
};

const infoEmojiElement: MenuElement = {
  color: COLORS.infoEmoji,
  disabled: () => false,
  icon: emojiIcon,
  id: "info_emoji",
  name: "emoji",
  subMenu: (params: MenuElementParams) => {
    const emojiElements: MenuElement[] = [
      {
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
        color: COLORS.infoEmoji,
        disabled: () => false,
        icon: emojiIcon,
        id: "emoji_more",
        name: "more",
      },
    ];

    const emojiCount = 8;
    for (let i = 0; i < emojiCount; i++) {
      emojiElements.push({
        action: (params: MenuElementParams) => {
          const targetPlayer =
            params.selected === params.game.myPlayer()
              ? AllPlayers
              : params.selected;
          params.playerActionHandler.handleEmoji(targetPlayer!, i);
          params.closeMenu();
        },
        disabled: () => false,
        fontSize: "25px",
        id: `emoji_${i}`,
        name: flattenedEmojiTable[i],
        text: flattenedEmojiTable[i],
      });
    }

    return emojiElements;
  },
};
/* eslint-enable @typescript-eslint/no-non-null-assertion */

export const infoMenuElement: MenuElement = {
  action: (params: MenuElementParams) => {
    params.playerPanel.show(params.playerActions, params.tile);
  },
  color: COLORS.info,
  disabled: (params: MenuElementParams) =>
    !params.selected || params.game.inSpawnPhase(),
  icon: infoIcon,
  id: Slot.Info,
  name: "info",
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
      color: params.buildMenu.canBuildOrUpgrade(item)
        ? filterType === "attack"
          ? COLORS.attack
          : COLORS.building
        : undefined,
      disabled: (params: MenuElementParams) =>
        !params.buildMenu.canBuildOrUpgrade(item),
      icon: item.icon,
      id: `${elementIdPrefix}_${item.unitType}`,
      name: item.key
        ? item.key.replace("unit_type.", "")
        : item.unitType.toString(),
      tooltipItems: [
        { className: "title", text: translateText(item.key ?? "") },
        {
          className: "description",
          text: translateText(item.description ?? ""),
        },
        {
          className: "cost",
          text: `${renderNumber(params.buildMenu.cost(item))} ${translateText("player_panel.gold")}`,
        },
        item.countable
          ? { className: "count", text: `${params.buildMenu.count(item)}x` }
          : null,
      ].filter(
        (tooltipItem): tooltipItem is TooltipItem => tooltipItem !== null,
      ),
    }));
}

export const attackMenuElement: MenuElement = {
  color: COLORS.attack,
  disabled: (params: MenuElementParams) => params.game.inSpawnPhase(),
  icon: swordIcon,
  id: Slot.Attack,
  name: "radial_attack",

  subMenu: (params: MenuElementParams) => {
    if (params === undefined) return [];
    return createMenuElements(params, "attack", "attack");
  },
};

export const deleteUnitElement: MenuElement = {
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
  color: COLORS.delete,
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

    if (!params.myPlayer.canDeleteUnit()) {
      return true;
    }

    const DELETE_SELECTION_RADIUS = 5;
    const myUnits = params.myPlayer
      .units()
      .filter(
        (unit) =>
          params.game.manhattanDist(unit.tile(), params.tile) <=
          DELETE_SELECTION_RADIUS,
      );

    return myUnits.length === 0;
  },
  icon: xIcon,
  id: Slot.Delete,
  name: "delete",
  tooltipKeys: [
    {
      className: "title",
      key: "radial_menu.delete_unit_title",
    },
    {
      className: "description",
      key: "radial_menu.delete_unit_description",
    },
  ],
};

export const buildMenuElement: MenuElement = {
  color: COLORS.build,
  disabled: (params: MenuElementParams) => params.game.inSpawnPhase(),
  icon: buildIcon,
  id: Slot.Build,
  name: "build",

  subMenu: (params: MenuElementParams) => {
    if (params === undefined) return [];
    return createMenuElements(params, "build", "build");
  },
};

export const boatMenuElement: MenuElement = {
  action: async (params: MenuElementParams) => {
    const spawn = await params.playerActionHandler.findBestTransportShipSpawn(
      params.myPlayer,
      params.tile,
    );

    params.playerActionHandler.handleBoatAttack(
      params.myPlayer,
      params.selected?.id() ?? null,
      params.tile,
      spawn !== false ? spawn : null,
    );

    params.closeMenu();
  },
  color: COLORS.boat,
  disabled: (params: MenuElementParams) =>
    !params.playerActions.buildableUnits.some(
      (unit) => unit.type === UnitType.TransportShip && unit.canBuild,
    ),
  icon: boatIcon,
  id: Slot.Boat,
  name: "boat",
};

export const centerButtonElement: CenterButtonElement = {
  action: (params: MenuElementParams) => {
    if (params.game.inSpawnPhase()) {
      params.playerActionHandler.handleSpawn(params.tile);
    } else {
      params.playerActionHandler.handleAttack(
        params.myPlayer,
        params.selected?.id() ?? null,
      );
    }
    params.closeMenu();
  },
  disabled: (params: MenuElementParams): boolean => {
    const tileOwner = params.game.owner(params.tile);
    const isLand = params.game.isLand(params.tile);
    if (!isLand) {
      return true;
    }
    if (params.game.inSpawnPhase()) {
      if (tileOwner.isPlayer()) {
        return true;
      }
      return false;
    }
    return !params.playerActions.canAttack;
  },
};

export const rootMenuElement: MenuElement = {
  color: COLORS.info,
  disabled: () => false,
  icon: infoIcon,
  id: "root",
  name: "root",
  subMenu: (params: MenuElementParams) => {
    let ally = allyRequestElement;
    if (params.selected?.isAlliedWith(params.myPlayer)) {
      ally = allyBreakElement;
    }

    const tileOwner = params.game.owner(params.tile);
    const isOwnTerritory =
      tileOwner.isPlayer() && tileOwner.id() === params.myPlayer.id();

    const menuItems: (MenuElement | null)[] = [
      infoMenuElement,
      boatMenuElement,
      ally,
    ];

    if (isOwnTerritory) {
      menuItems.push(buildMenuElement);
      menuItems.push(deleteUnitElement);
    } else {
      menuItems.push(attackMenuElement);
    }

    return menuItems.filter((item): item is MenuElement => item !== null);
  },
};
