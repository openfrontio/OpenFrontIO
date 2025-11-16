import allianceIcon from "../../../../resources/images/AllianceIcon.svg";
import allianceRequestBlackIcon from "../../../../resources/images/AllianceRequestBlackIcon.svg";
import allianceRequestWhiteIcon from "../../../../resources/images/AllianceRequestWhiteIcon.svg";
import crownIcon from "../../../../resources/images/CrownIcon.svg";
import disconnectedIcon from "../../../../resources/images/DisconnectedIcon.svg";
import embargoBlackIcon from "../../../../resources/images/EmbargoBlackIcon.svg";
import embargoWhiteIcon from "../../../../resources/images/EmbargoWhiteIcon.svg";
import nukeRedIcon from "../../../../resources/images/NukeIconRed.svg";
import nukeWhiteIcon from "../../../../resources/images/NukeIconWhite.svg";
import targetIcon from "../../../../resources/images/TargetIcon.svg";
import traitorIcon from "../../../../resources/images/TraitorIcon.svg";
import { AllPlayers, nukeTypes } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";

export type PlayerIconId =
  | "crown"
  | "traitor"
  | "disconnected"
  | "alliance"
  | "alliance-request"
  | "target"
  | "emoji"
  | "embargo"
  | "nuke";

export type PlayerIconKind = "image" | "emoji";

export interface PlayerIconDescriptor {
  id: PlayerIconId;
  kind: PlayerIconKind;
  /** Image URL for image icons */
  src?: string;
  /** Text content for emoji icons */
  text?: string;
  /** Whether the icon should be visually centered over the name */
  center?: boolean;
}

export interface PlayerIconParams {
  game: GameView;
  player: PlayerView;
  /** Whether the alliance icon (handshake) should be included */
  includeAllianceIcon: boolean;
  /** Player currently in first place, used for the crown icon */
  firstPlace: PlayerView | null;
}

export function getFirstPlacePlayer(game: GameView): PlayerView | null {
  const sorted = game
    .playerViews()
    .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());

  return sorted.length > 0 ? sorted[0] : null;
}

export function getPlayerIcons(
  params: PlayerIconParams,
): PlayerIconDescriptor[] {
  const { game, player, includeAllianceIcon, firstPlace } = params;

  const myPlayer = game.myPlayer();
  const userSettings = game.config().userSettings();
  const isDarkMode = userSettings?.darkMode() ?? false;
  const emojisEnabled = userSettings?.emojis() ?? false;

  const icons: PlayerIconDescriptor[] = [];

  // Crown icon for first place
  if (player === firstPlace) {
    icons.push({ id: "crown", kind: "image", src: crownIcon });
  }

  // Traitor icon
  if (player.isTraitor()) {
    icons.push({ id: "traitor", kind: "image", src: traitorIcon });
  }

  // Disconnected icon
  if (player.isDisconnected()) {
    icons.push({ id: "disconnected", kind: "image", src: disconnectedIcon });
  }

  // Alliance icon
  if (
    includeAllianceIcon &&
    myPlayer !== null &&
    myPlayer.isAlliedWith(player)
  ) {
    icons.push({ id: "alliance", kind: "image", src: allianceIcon });
  }

  // Alliance request icon (theme dependent)
  if (myPlayer !== null && player.isRequestingAllianceWith(myPlayer)) {
    const allianceRequestIcon = isDarkMode
      ? allianceRequestWhiteIcon
      : allianceRequestBlackIcon;
    icons.push({
      id: "alliance-request",
      kind: "image",
      src: allianceRequestIcon,
    });
  }

  // Target icon (centered on the map, but regular in overlays)
  if (myPlayer !== null && new Set(myPlayer.transitiveTargets()).has(player)) {
    icons.push({ id: "target", kind: "image", src: targetIcon, center: true });
  }

  // Emoji handling
  if (emojisEnabled) {
    const emojis = player
      .outgoingEmojis()
      .filter(
        (emoji) =>
          emoji.recipientID === AllPlayers ||
          emoji.recipientID === myPlayer?.smallID(),
      );

    if (emojis.length > 0) {
      icons.push({
        id: "emoji",
        kind: "emoji",
        text: emojis[0].message,
      });
    }
  }

  // Embargo icon (theme dependent)
  if (myPlayer?.hasEmbargo(player)) {
    const embargoIcon = isDarkMode ? embargoWhiteIcon : embargoBlackIcon;
    icons.push({ id: "embargo", kind: "image", src: embargoIcon });
  }

  // Nuke icon (different color depending on whether the local player is the target)
  const nukesSentByOtherPlayer = game.units(...nukeTypes).filter((unit) => {
    const isSendingNuke = player.id() === unit.owner().id();
    const notMyPlayer = !myPlayer || unit.owner().id() !== myPlayer.id();
    return isSendingNuke && notMyPlayer && unit.isActive();
  });

  const isMyPlayerTarget = nukesSentByOtherPlayer.some((unit) => {
    const detonationDst = unit.targetTile();
    if (!detonationDst || !myPlayer) return false;
    const targetId = game.owner(detonationDst).id();
    return targetId === myPlayer.id();
  });

  if (nukesSentByOtherPlayer.length > 0) {
    const icon = isMyPlayerTarget ? nukeRedIcon : nukeWhiteIcon;
    icons.push({ id: "nuke", kind: "image", src: icon });
  }

  return icons;
}
