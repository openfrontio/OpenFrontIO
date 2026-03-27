import { assetUrl } from "../../../core/AssetUrls";
import { Config } from "../../../core/configuration/Config";
import {
  AllPlayers,
  BuildableAttacks,
  PlayerActions,
  PlayerBuildableUnitType,
  Structures,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { Emoji, findClosestBy, flattenedEmojiTable } from "../../../core/Util";
import { renderNumber, translateText } from "../../Utils";
import { UIState } from "../UIState";
import { BuildItemDisplay, BuildMenu, flattenedBuildTable } from "./BuildMenu";
import { ChatIntegration } from "./ChatIntegration";
import { quickChatPhrases } from "./ChatModal";
import { EmojiTable } from "./EmojiTable";
import { PlayerActionHandler } from "./PlayerActionHandler";
import { PlayerPanel } from "./PlayerPanel";
import { PresetSlot, QuickChatPresetService } from "./QuickChatPresetService";
import { TooltipItem } from "./RadialMenu";
import { TargetSelectionMode } from "./TargetSelectionMode";

import { EventBus } from "../../../core/EventBus";
import { SendQuickChatEvent } from "../../Transport";
const allianceIcon = assetUrl("images/AllianceIconWhite.svg");
const boatIcon = assetUrl("images/BoatIconWhite.svg");
const buildIcon = assetUrl("images/BuildIconWhite.svg");
const chatIcon = assetUrl("images/ChatIconWhite.svg");
const donateGoldIcon = assetUrl("images/DonateGoldIconWhite.svg");
const donateTroopIcon = assetUrl("images/DonateTroopIconWhite.svg");
const emojiIcon = assetUrl("images/EmojiIconWhite.svg");
const infoIcon = assetUrl("images/InfoIcon.svg");
const swordIcon = assetUrl("images/SwordIconWhite.svg");
const targetIcon = assetUrl("images/TargetIconWhite.svg");
const traitorIcon = assetUrl("images/TraitorIconWhite.svg");
const xIcon = assetUrl("images/XIcon.svg");

const settingsIcon = assetUrl("images/SettingIconWhite.svg");

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
  color?: string | ((params: MenuElementParams) => string);
  icon?: string;
  text?: string | ((params: MenuElementParams) => string);
  fontSize?: string;
  tooltipItems?: TooltipItem[];
  tooltipKeys?: TooltipKey[];

  cooldown?: (params: MenuElementParams) => number;
  disabled: (params: MenuElementParams) => boolean;
  action?: (params: MenuElementParams) => void; // For leaf items that perform actions
  subMenu?: (params: MenuElementParams) => MenuElement[]; // For non-leaf items that open submenus

  renderType?: string;

  timerFraction?: (params: MenuElementParams) => number; // 0..1, for arc timer overlay
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
  build: "#e6c74a",
  building: "#1e3a5f",
  boat: "#2a82c9",
  ally: "#4ade80",
  breakAlly: "#dc2626",
  breakAllyNoDebuff: "#d97706",
  delete: "#ef4444",
  info: "#475569",
  target: "#ef4444",
  attack: "#ef4444",
  infoDetails: "#7f8c8d",
  infoEmoji: "#fbbf24",
  trade: "#0891b2",
  embargo: "#7c3aed",
  tooltip: {
    cost: "#f59e0b",
    count: "#94a3b8",
  },
  chat: {
    default: "#6366f1",
    help: "#22c55e",
    attack: "#ef4444",
    defend: "#3b82f6",
    greet: "#f97316",
    misc: "#a855f7",
    warnings: "#fbbf24",
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

const allyExtendElement: MenuElement = {
  id: "ally_extend",
  name: "extend",
  displayed: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.allianceInfo?.inExtensionWindow,
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.allianceInfo?.canExtend,
  color: COLORS.ally,
  icon: allianceIcon,
  action: (params: MenuElementParams) => {
    if (!params.playerActions?.interaction?.allianceInfo?.canExtend) return;
    params.playerActionHandler.handleExtendAlliance(params.selected!);
    params.closeMenu();
  },
  timerFraction: (params: MenuElementParams): number => {
    const interaction = params.playerActions?.interaction;
    if (!interaction?.allianceInfo) return 1;
    const remaining = Math.max(
      0,
      interaction.allianceInfo.expiresAt - params.game.ticks(),
    );
    const extensionWindow = Math.max(
      1,
      params.game.config().allianceExtensionPromptOffset(),
    );
    return Math.max(0, Math.min(1, remaining / extensionWindow));
  },
  renderType: "allyExtend",
};

const allyBreakElement: MenuElement = {
  id: "ally_break",
  name: "break",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canBreakAlliance,
  displayed: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canBreakAlliance,
  color: (params: MenuElementParams) =>
    params.selected?.isTraitor() || params.selected?.isDisconnected()
      ? COLORS.breakAllyNoDebuff
      : COLORS.breakAlly,
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

/** Shortens a phrase label to fit inside a radial menu arc segment. */
function shortenPresetText(text: string, maxLength = 15): string {
  return text.length <= maxLength
    ? text
    : text.substring(0, maxLength - 3) + "...";
}

/** Builds a single MenuElement from a PresetSlot at runtime. */
function buildPresetItem(slot: PresetSlot, recipient: PlayerView): MenuElement {
  // --- Quick Chat ---
  if (slot.type === "quickchat" && slot.category && slot.key) {
    const phrase = quickChatPhrases[slot.category]?.find(
      (p) => p.key === slot.key,
    );
    const fullKey = `${slot.category}.${slot.key}`;
    const label = translateText(`chat.${slot.category}.${slot.key}`);
    const color =
      COLORS.chat[slot.category as keyof typeof COLORS.chat] ??
      COLORS.chat.default;
    return {
      id: `preset-qc-${slot.category}-${slot.key}`,
      name: label,
      disabled: () => false,
      text: shortenPresetText(label),
      fontSize: "10px",
      color,
      tooltipItems: [{ text: label, className: "description" }],
      action: (p: MenuElementParams) => {
        if (phrase?.requiresPlayer) {
          TargetSelectionMode.getInstance().enter(fullKey, recipient);
          p.closeMenu();
        } else {
          p.eventBus.emit(new SendQuickChatEvent(recipient, fullKey));
          p.closeMenu();
        }
      },
    };
  }

  // --- Emoji: opens the full emoji panel, same as the existing emoji button ---
  if (slot.type === "emoji") {
    return {
      id: "preset-emoji-panel",
      name: "emoji",
      disabled: () => false,
      icon: emojiIcon,
      color: COLORS.infoEmoji,
      action: (p: MenuElementParams) => {
        const target =
          p.selected === p.game.myPlayer() ? AllPlayers : p.selected;
        p.emojiTable.showTable((emoji) => {
          p.playerActionHandler.handleEmoji(
            target!,
            flattenedEmojiTable.indexOf(emoji as Emoji),
          );
          p.emojiTable.hideTable();
        });
        // Do NOT call closeMenu() here — the emoji table needs to stay interactive
      },
    };
  }

  // --- Trade: smart toggle — label/color reflect live canEmbargo state ---
  if (slot.type === "trade") {
    return {
      id: "preset-trade-toggle",
      name: "trade",
      disabled: (p: MenuElementParams) => p.selected === null,
      color: (p: MenuElementParams) =>
        p.playerActions?.interaction?.canEmbargo
          ? COLORS.embargo
          : COLORS.trade,
      text: (p: MenuElementParams) => {
        const label = p.playerActions?.interaction?.canEmbargo
          ? translateText("player_panel.stop_trade")
          : translateText("player_panel.start_trade");
        return shortenPresetText(label);
      },
      fontSize: "10px",
      action: (p: MenuElementParams) => {
        const canEmbargo = !!p.playerActions?.interaction?.canEmbargo;
        p.playerActionHandler.handleEmbargo(
          p.selected!,
          canEmbargo ? "start" : "stop",
        );
        p.closeMenu();
      },
    };
  }

  // Fallback (should never happen)
  return {
    id: "preset-unknown",
    name: "?",
    disabled: () => true,
    color: COLORS.infoDetails,
  };
}

/**
 * The "i" (Info) button — opens a Quick Chat / actions submenu.
 *
 * Submenu contains:
 *   1. User-configured preset slots (up to 5): quickchat, emoji, or trade
 *   2. A permanent "Info" button that opens the player panel
 *   3. A permanent "Customize Presets" settings button
 */
export const infoMenuElement: MenuElement = {
  id: Slot.Info,
  name: "info",
  disabled: (params: MenuElementParams) =>
    !params.selected || params.game.inSpawnPhase(),
  icon: infoIcon,
  color: COLORS.info,
  subMenu: (params: MenuElementParams): MenuElement[] => {
    if (params === undefined || !params.selected) return [];

    const recipient = params.selected;
    const presets = QuickChatPresetService.getInstance().load();

    const presetItems = presets.map((slot) => buildPresetItem(slot, recipient));

    // Permanent: open the player info panel (original Info button behaviour)
    const playerInfoItem: MenuElement = {
      id: "player-info",
      name: "info",
      disabled: () => false,
      icon: infoIcon,
      color: COLORS.info,
      tooltipItems: [
        { text: translateText("quick_chat.player_info"), className: "title" },
      ],
      action: (p: MenuElementParams) => {
        p.playerPanel.show(p.playerActions, p.tile);
      },
    };

    // Permanent: open the preset config modal
    const configureItem: MenuElement = {
      id: "configure-quick-chat",
      name: translateText("quick_chat.configure_presets"),
      disabled: () => false,
      icon: settingsIcon,
      color: COLORS.infoDetails,
      tooltipItems: [
        {
          text: translateText("quick_chat.configure_presets"),
          className: "title",
        },
      ],
      action: (p: MenuElementParams) => {
        const modal = document.querySelector("quick-chat-config-modal") as any;
        if (modal) {
          modal.open();
        } else {
          console.error("[QuickChat] quick-chat-config-modal not found");
        }
        p.closeMenu();
      },
    };

    return [...presetItems, playerInfoItem, configureItem];
  },
};

function getAllEnabledUnits(
  myPlayer: boolean,
  config: Config,
): Set<PlayerBuildableUnitType> {
  const units: Set<PlayerBuildableUnitType> =
    new Set<PlayerBuildableUnitType>();

  const addIfEnabled = (unitType: PlayerBuildableUnitType) => {
    if (!config.isUnitDisabled(unitType)) {
      units.add(unitType);
    }
  };

  if (myPlayer) {
    Structures.types.forEach(addIfEnabled);
  } else {
    BuildableAttacks.types.forEach(addIfEnabled);
  }

  return units;
}

function createMenuElements(
  params: MenuElementParams,
  filterType: "attack" | "build",
  elementIdPrefix: string,
): MenuElement[] {
  const unitTypes: Set<PlayerBuildableUnitType> = getAllEnabledUnits(
    params.selected === params.myPlayer,
    params.game.config(),
  );

  return flattenedBuildTable
    .filter(
      (item) =>
        unitTypes.has(item.unitType) &&
        (filterType === "attack"
          ? BuildableAttacks.has(item.unitType)
          : !BuildableAttacks.has(item.unitType)),
    )
    .map((item: BuildItemDisplay) => {
      const canBuildOrUpgrade = params.buildMenu.canBuildOrUpgrade(item);
      return {
        id: `${elementIdPrefix}_${item.unitType}`,
        name: item.key
          ? item.key.replace("unit_type.", "")
          : item.unitType.toString(),
        disabled: () => !canBuildOrUpgrade,
        color: canBuildOrUpgrade
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
          if (canBuildOrUpgrade) {
            params.buildMenu.sendBuildOrUpgrade(buildableUnit, params.tile);
          }
          params.closeMenu();
        },
      };
    });
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
  color: "#f59e0b",
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

    const closestUnit = findClosestBy(myUnits, (unit) =>
      params.game.manhattanDist(unit.tile(), params.tile),
    );
    if (closestUnit) {
      params.playerActionHandler.handleDeleteUnit(closestUnit.id());
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

    const inExtensionWindow =
      params.playerActions.interaction?.allianceInfo?.inExtensionWindow;

    const menuItems: (MenuElement | null)[] = [
      infoMenuElement,
      ...(isOwnTerritory
        ? [deleteUnitElement, allyRequestElement, buildMenuElement]
        : [
            isAllied && !isDisconnected ? allyBreakElement : boatMenuElement,
            inExtensionWindow ? allyExtendElement : allyRequestElement,
            isFriendlyTarget(params) && !isDisconnected
              ? donateGoldRadialElement
              : attackMenuElement,
          ]),
    ];

    return menuItems.filter((item): item is MenuElement => item !== null);
  },
};
