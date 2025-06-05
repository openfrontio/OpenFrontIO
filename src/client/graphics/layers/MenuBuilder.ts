import { flattenedEmojiTable } from "../../../core/Util";
import { PlayerActions, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { renderNumber, translateText } from "../../Utils";
import { BuildItemDisplay, flattenedBuildTable } from "./BuildMenu";
import { MenuItem } from "./RadialMenu";

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

export enum Slot {
  Info,
  Boat,
  Build,
  Ally,
  Back,
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

export class MenuBuilder {
  constructor(
    private game: GameView,
    private buildMenu: any,
  ) {}

  getRootMenuItems(): MenuItem[] {
    return [
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
  }

  createBuildSubMenu(
    onBuildAction: (unitType: UnitType, x: number, y: number) => void,
    tile: TileRef,
  ): MenuItem[] {
    return [
      ...flattenedBuildTable.map((item: BuildItemDisplay) => ({
        id: `build_${item.unitType}`,
        name: item.key
          ? item.key.replace("unit_type.", "")
          : item.unitType.toString(),
        disabled: !this.buildMenu.canBuild(item),
        action: () => {
          onBuildAction(item.unitType, this.game.x(tile), this.game.y(tile));
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
  }

  createEmojiSubMenu(): MenuItem[] {
    return [
      ...flattenedEmojiTable.slice(0, 15).map((emoji, index) => ({
        id: `emoji_${index}`,
        name: emoji,
        text: emoji,
        disabled: false,
        fontSize: "25px",
        action: () => {},
      })),
      {
        id: "emoji_more",
        name: "more",
        disabled: false,
        color: COLORS.infoEmoji,
        icon: emojiIcon,
        action: () => {},
      },
    ];
  }

  createInfoSubMenu(
    recipient: PlayerView | null,
    onPlayerInfoAction?: () => void,
    createQuickChatMenu?: (recipient: PlayerView) => MenuItem[],
  ): MenuItem[] {
    if (!recipient) return [];

    return [
      {
        id: "info_chat",
        name: "chat",
        disabled: false,
        action: () => {},
        color: COLORS.chat.default,
        icon: chatIcon,
        children: createQuickChatMenu ? createQuickChatMenu(recipient) : [],
      },
      {
        id: "info_emoji",
        name: "emoji",
        disabled: false,
        action: () => {},
        color: COLORS.infoEmoji,
        icon: emojiIcon,
        children: this.createEmojiSubMenu(),
      },
      {
        id: "info_player",
        name: "player",
        disabled: false,
        action: onPlayerInfoAction || (() => {}),
        color: COLORS.info,
        icon: infoIcon,
      },
    ];
  }

  createAllySubMenu(
    recipient: PlayerView | null,
    myPlayer: PlayerView,
    actions: PlayerActions,
    onTargetPlayer: (playerId: string) => void,
    onAllianceRequest: (myPlayer: PlayerView, recipient: PlayerView) => void,
    onBreakAlliance: (myPlayer: PlayerView, recipient: PlayerView) => void,
    onDonateGold: (recipient: PlayerView) => void,
    onDonateTroops: (recipient: PlayerView) => void,
    onEmbargo: (recipient: PlayerView, action: string) => void,
  ): MenuItem[] {
    if (!recipient) return [];

    const isAlly = !!actions?.interaction?.canBreakAlliance;

    return [
      {
        id: "ally_target",
        name: "target",
        disabled: false,
        action: () => onTargetPlayer(recipient.id()),
        color: COLORS.target,
        icon: targetIcon,
      },
      {
        id: "ally_request",
        name: "request",
        disabled: !actions?.interaction?.canSendAllianceRequest,
        displayed: !isAlly,
        action: () => onAllianceRequest(myPlayer, recipient),
        color: COLORS.ally,
        icon: allianceIcon,
      },
      {
        id: "ally_break",
        name: "break",
        disabled: !actions?.interaction?.canBreakAlliance,
        displayed: isAlly,
        action: () => onBreakAlliance(myPlayer, recipient),
        color: COLORS.breakAlly,
        icon: traitorIcon,
      },
      {
        id: "ally_donate_gold",
        name: "donate gold",
        disabled: !actions?.interaction?.canDonate,
        action: () => onDonateGold(recipient),
        color: COLORS.ally,
        icon: donateGoldIcon,
      },
      {
        id: "ally_donate_troops",
        name: "donate troops",
        disabled: !actions?.interaction?.canDonate,
        action: () => onDonateTroops(recipient),
        color: COLORS.ally,
        icon: donateTroopIcon,
      },
      {
        id: "ally_trade",
        name: "trade",
        disabled: !!actions?.interaction?.canEmbargo,
        displayed: !actions?.interaction?.canEmbargo,
        action: () => onEmbargo(recipient, "start"),
        color: COLORS.trade,
        text: translateText("player_panel.start_trade"),
      },
      {
        id: "ally_embargo",
        name: "embargo",
        disabled: !actions?.interaction?.canEmbargo,
        displayed: !!actions?.interaction?.canEmbargo,
        action: () => onEmbargo(recipient, "stop"),
        color: COLORS.embargo,
        text: translateText("player_panel.stop_trade"),
      },
    ].filter((item) => item.displayed !== false);
  }

  createUpdatedMenuItems(
    actions: PlayerActions,
    tile: TileRef,
    recipient: PlayerView | null,
    onBoatAction: () => void,
    allySubMenu: MenuItem[],
    buildSubMenu: MenuItem[],
  ): MenuItem[] {
    return [
      {
        id: Slot.Boat.toString(),
        name: "boat",
        disabled:
          !actions.buildableUnits.find(
            (bu) => bu.type === UnitType.TransportShip,
          )?.canBuild || !recipient,
        action: onBoatAction,
        color: COLORS.boat,
        icon: boatIcon,
      },
      {
        id: Slot.Ally.toString(),
        name: "ally",
        disabled:
          !(
            actions?.interaction?.canSendAllianceRequest ||
            actions?.interaction?.canBreakAlliance
          ) || !recipient,
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
        children: this.createInfoSubMenu(recipient),
      },
    ];
  }
}
