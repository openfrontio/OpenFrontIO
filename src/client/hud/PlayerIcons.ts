import { assetUrl } from "../../core/AssetUrls";
import { AllPlayers, Nukes } from "../../core/game/Game";
import { GameView, PlayerView } from "../../core/game/GameView";
const allianceIcon = assetUrl("images/AllianceIcon.svg");
const allianceIconFaded = assetUrl("images/AllianceIconFaded.svg");
const allianceRequestBlackIcon = assetUrl(
  "images/AllianceRequestBlackIcon.svg",
);
const allianceRequestWhiteIcon = assetUrl(
  "images/AllianceRequestWhiteIcon.svg",
);
const crownIcon = assetUrl("images/CrownIcon.svg");
const disconnectedIcon = assetUrl("images/DisconnectedIcon.svg");
const embargoBlackIcon = assetUrl("images/EmbargoBlackIcon.svg");
const embargoWhiteIcon = assetUrl("images/EmbargoWhiteIcon.svg");
const nukeRedIcon = assetUrl("images/NukeIconRed.svg");
const nukeWhiteIcon = assetUrl("images/NukeIconWhite.svg");
const questionMarkIcon = assetUrl("images/QuestionMarkIcon.svg");
const targetIcon = assetUrl("images/TargetIcon.svg");
const traitorIcon = assetUrl("images/TraitorIcon.svg");

let allianceIconTemplate: HTMLDivElement | undefined;

export const ALLIANCE_ICON_ID = "alliance" as const;
const ALLIANCE_PROGRESS_OVERLAY_CLASS = "alliance-progress-overlay";
const ALLIANCE_QUESTION_MARK_CLASS = "alliance-question-mark";
export const TRAITOR_ICON_ID = "traitor" as const;
const CROWN_ICON_ID = "crown" as const;
const DISCONNECTED_ICON_ID = "disconnected" as const;
const ALLIANCE_REQUEST_ICON_ID = "alliance-request" as const;
const TARGET_ICON_ID = "target" as const;
const EMOJI_ICON_ID = "emoji" as const;
const EMBARGO_ICON_ID = "embargo" as const;
const NUKE_ICON_ID = "nuke" as const;

export const IMAGE_ICON_KIND = "image" as const;
export const EMOJI_ICON_KIND = "emoji" as const;

export type PlayerIconId =
  | typeof CROWN_ICON_ID
  | typeof TRAITOR_ICON_ID
  | typeof DISCONNECTED_ICON_ID
  | typeof ALLIANCE_ICON_ID
  | typeof ALLIANCE_REQUEST_ICON_ID
  | typeof TARGET_ICON_ID
  | typeof EMOJI_ICON_ID
  | typeof EMBARGO_ICON_ID
  | typeof NUKE_ICON_ID;

export type PlayerIconKind = typeof IMAGE_ICON_KIND | typeof EMOJI_ICON_KIND;

export type AllianceProgressIconRefs = {
  wrapper: HTMLDivElement;
  base: HTMLImageElement;
  overlay: HTMLDivElement;
  colored: HTMLImageElement;
  questionMark: HTMLImageElement;
};

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
  alliancesDisabled: boolean;
  darkMode?: boolean;
  transitiveTargets?: PlayerView[];
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
  const {
    game,
    player,
    includeAllianceIcon,
    firstPlace,
    alliancesDisabled,
    darkMode,
    transitiveTargets,
  } = params;

  const myPlayer = game.myPlayer();
  const userSettings = game.config().userSettings();
  const isDarkMode = darkMode ?? userSettings?.darkMode() ?? false;
  const emojisEnabled = userSettings?.emojis() ?? false;
  const alliancesOff = alliancesDisabled ?? game.config().disableAlliances();

  const icons: PlayerIconDescriptor[] = [];

  // Crown icon for first place
  if (player === firstPlace) {
    icons.push({ id: CROWN_ICON_ID, kind: IMAGE_ICON_KIND, src: crownIcon });
  }

  // Traitor icon
  if (player.isTraitor()) {
    icons.push({
      id: TRAITOR_ICON_ID,
      kind: IMAGE_ICON_KIND,
      src: traitorIcon,
    });
  }

  // Disconnected icon
  if (player.isDisconnected()) {
    icons.push({
      id: DISCONNECTED_ICON_ID,
      kind: IMAGE_ICON_KIND,
      src: disconnectedIcon,
    });
  }

  if (!alliancesOff) {
    // Alliance icon
    if (
      includeAllianceIcon &&
      myPlayer !== null &&
      myPlayer.isAlliedWith(player)
    ) {
      icons.push({
        id: ALLIANCE_ICON_ID,
        kind: IMAGE_ICON_KIND,
        src: allianceIcon,
      });
    }

    // Alliance request icon (theme dependent)
    if (myPlayer !== null && player.isRequestingAllianceWith(myPlayer)) {
      const allianceRequestIcon = isDarkMode
        ? allianceRequestWhiteIcon
        : allianceRequestBlackIcon;
      icons.push({
        id: ALLIANCE_REQUEST_ICON_ID,
        kind: IMAGE_ICON_KIND,
        src: allianceRequestIcon,
      });
    }
  }

  // Target icon (centered on the map, but regular in overlays)
  const targets = transitiveTargets ?? myPlayer?.transitiveTargets() ?? [];
  if (targets.includes(player)) {
    icons.push({
      id: TARGET_ICON_ID,
      kind: IMAGE_ICON_KIND,
      src: targetIcon,
      center: true,
    });
  }

  // Emoji handling
  if (emojisEnabled) {
    const emoji = player
      .outgoingEmojis()
      .find(
        (e) =>
          e.recipientID === AllPlayers || e.recipientID === myPlayer?.smallID(),
      );

    if (emoji) {
      icons.push({
        id: EMOJI_ICON_ID,
        kind: EMOJI_ICON_KIND,
        text: emoji.message,
      });
    }
  }

  // Embargo icon (theme dependent)
  if (myPlayer?.hasEmbargo(player)) {
    const embargoIcon = isDarkMode ? embargoWhiteIcon : embargoBlackIcon;
    icons.push({
      id: EMBARGO_ICON_ID,
      kind: IMAGE_ICON_KIND,
      src: embargoIcon,
    });
  }

  // Nuke icon (different color depending on whether the local player is the target)
  if (!myPlayer || player.id() !== myPlayer.id()) {
    let hasActiveNukes = false;
    let isMyPlayerTarget = false;
    const playerNukes = player.units(...Nukes.types);

    for (const nuke of playerNukes) {
      if (nuke.isActive()) {
        hasActiveNukes = true;

        const detonationDst = nuke.targetTile();
        if (
          myPlayer &&
          detonationDst &&
          game.owner(detonationDst).id() === myPlayer.id()
        ) {
          isMyPlayerTarget = true;
          break;
        }
      }
    }

    if (hasActiveNukes) {
      const icon = isMyPlayerTarget ? nukeRedIcon : nukeWhiteIcon;
      icons.push({ id: NUKE_ICON_ID, kind: IMAGE_ICON_KIND, src: icon });
    }
  }

  return icons;
}

export function createAllianceProgressIconRefs(
  size: number,
  fraction: number,
  hasExtensionRequest: boolean,
  darkMode: string,
): AllianceProgressIconRefs {
  if (!allianceIconTemplate) {
    allianceIconTemplate = document.createElement("div");
    allianceIconTemplate.setAttribute("data-icon", ALLIANCE_ICON_ID);
    allianceIconTemplate.style.position = "relative";
    allianceIconTemplate.style.display = "inline-block";
    allianceIconTemplate.style.flexShrink = "0";

    const base = document.createElement("img");
    base.src = allianceIconFaded;
    base.style.display = "block";
    allianceIconTemplate.appendChild(base);

    const overlay = document.createElement("div");
    overlay.className = ALLIANCE_PROGRESS_OVERLAY_CLASS;
    overlay.style.position = "absolute";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";

    const colored = document.createElement("img");
    colored.src = allianceIcon; // green icon
    colored.style.display = "block";
    overlay.appendChild(colored);

    allianceIconTemplate.appendChild(overlay);

    const questionMark = document.createElement("img");
    questionMark.className = ALLIANCE_QUESTION_MARK_CLASS;
    questionMark.src = questionMarkIcon;
    questionMark.style.position = "absolute";
    questionMark.style.left = "0";
    questionMark.style.top = "0";
    questionMark.style.pointerEvents = "none";
    allianceIconTemplate.appendChild(questionMark);
  }

  // Wrapper
  const wrapper = allianceIconTemplate.cloneNode(true) as HTMLDivElement;
  wrapper.setAttribute("dark-mode", darkMode);
  wrapper.style.width = `${size}px`;
  wrapper.style.height = `${size}px`;

  // Base faded icon (full)
  // No QuerySelector here since we know the structure and it avoids overhead each call
  const base = wrapper.childNodes[0] as HTMLImageElement;
  base.style.width = `${size}px`;
  base.style.height = `${size}px`;
  base.setAttribute("dark-mode", darkMode);

  // Overlay container for green portion, clipped from the top via clip-path
  const overlay = wrapper.childNodes[1] as HTMLDivElement;
  overlay.style.clipPath = computeAllianceClipPath(fraction);

  const colored = overlay.childNodes[0] as HTMLImageElement;
  colored.style.width = `${size}px`;
  colored.style.height = `${size}px`;
  colored.setAttribute("dark-mode", darkMode);

  // Question mark overlay (shown when there's a pending extension request)
  const questionMark = wrapper.childNodes[2] as HTMLImageElement;
  questionMark.style.width = `${size}px`;
  questionMark.style.height = `${size}px`;
  questionMark.style.display = hasExtensionRequest ? "block" : "none";
  questionMark.setAttribute("dark-mode", darkMode);

  return {
    wrapper,
    base,
    overlay,
    colored,
    questionMark,
  };
}

export function updateAllianceProgressIconRefs(
  refs: AllianceProgressIconRefs,
  size: number,
  fraction: number,
  hasExtensionRequest: boolean,
  darkMode: string,
): void {
  refs.wrapper.style.width = `${size}px`;
  refs.wrapper.style.height = `${size}px`;
  refs.wrapper.style.flexShrink = "0";

  refs.base.style.width = `${size}px`;
  refs.base.style.height = `${size}px`;
  refs.base.setAttribute("dark-mode", darkMode);

  refs.colored.style.width = `${size}px`;
  refs.colored.style.height = `${size}px`;
  refs.colored.setAttribute("dark-mode", darkMode);
  refs.overlay.style.clipPath = computeAllianceClipPath(fraction);

  if (!hasExtensionRequest) {
    refs.questionMark.style.display = "none";
  } else {
    refs.questionMark.style.width = `${size}px`;
    refs.questionMark.style.height = `${size}px`;
    refs.questionMark.style.display = "block";
    refs.questionMark.setAttribute("dark-mode", darkMode);
  }
}

export function computeAllianceClipPath(fraction: number): string {
  const topCut = 20 + (1 - fraction) * 80 * 0.78; // min 20%, max 82.40%
  return `inset(${topCut.toFixed(2)}% -2px 0 -2px)`;
}
