import allianceIcon from "../../../resources/images/AllianceIcon.svg";
import allianceIconFaded from "../../../resources/images/AllianceIconFaded.svg";
import allianceRequestBlackIcon from "../../../resources/images/AllianceRequestBlackIcon.svg";
import allianceRequestWhiteIcon from "../../../resources/images/AllianceRequestWhiteIcon.svg";
import crownIcon from "../../../resources/images/CrownIcon.svg";
import disconnectedIcon from "../../../resources/images/DisconnectedIcon.svg";
import embargoBlackIcon from "../../../resources/images/EmbargoBlackIcon.svg";
import embargoWhiteIcon from "../../../resources/images/EmbargoWhiteIcon.svg";
import nukeRedIcon from "../../../resources/images/NukeIconRed.svg";
import nukeWhiteIcon from "../../../resources/images/NukeIconWhite.svg";
import questionMarkIcon from "../../../resources/images/QuestionMarkIcon.svg";
import targetIcon from "../../../resources/images/TargetIcon.svg";
import traitorIcon from "../../../resources/images/TraitorIcon.svg";
import { AllPlayers, nukeTypes } from "../../core/game/Game";
import { GameView, PlayerView } from "../../core/game/GameView";

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

export function createAllianceProgressIcon(
  size: number,
  fraction: number,
  hasExtensionRequest: boolean,
  darkMode: boolean,
): HTMLDivElement {
  // Wrapper
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-icon", "alliance");
  wrapper.setAttribute("dark-mode", darkMode.toString());
  wrapper.style.position = "relative";
  wrapper.style.width = `${size}px`;
  wrapper.style.height = `${size}px`;
  wrapper.style.display = "inline-block";
  wrapper.style.flexShrink = "0";

  // Base faded icon (full)
  const base = document.createElement("img");
  base.src = allianceIconFaded;
  base.style.width = `${size}px`;
  base.style.height = `${size}px`;
  base.style.display = "block";
  base.setAttribute("dark-mode", darkMode.toString());
  wrapper.appendChild(base);

  // Overlay container for green portion, clipped from the top via clip-path
  const overlay = document.createElement("div");
  overlay.className = "alliance-progress-overlay";
  overlay.style.position = "absolute";
  overlay.style.left = "0";
  overlay.style.top = "0";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.clipPath = computeAllianceClipPath(fraction);

  const colored = document.createElement("img");
  colored.src = allianceIcon; // green icon
  colored.style.width = `${size}px`;
  colored.style.height = `${size}px`;
  colored.style.display = "block";
  colored.setAttribute("dark-mode", darkMode.toString());
  overlay.appendChild(colored);

  wrapper.appendChild(overlay);

  // Question mark overlay (shown when there's a pending extension request)
  const questionMark = document.createElement("img");
  questionMark.className = "alliance-question-mark";
  questionMark.src = questionMarkIcon;
  questionMark.style.position = "absolute";
  questionMark.style.left = "0";
  questionMark.style.top = "0";
  questionMark.style.width = `${size}px`;
  questionMark.style.height = `${size}px`;
  questionMark.style.display = hasExtensionRequest ? "block" : "none";
  questionMark.style.pointerEvents = "none";
  questionMark.setAttribute("dark-mode", darkMode.toString());
  wrapper.appendChild(questionMark);

  return wrapper;
}

export function computeAllianceClipPath(fraction: number): string {
  const topCut = 20 + (1 - fraction) * 80 * 0.78; // min 20%, max 82.40%
  return `inset(${topCut.toFixed(2)}% -2px 0 -2px)`;
}
