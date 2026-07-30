import { assetUrl } from "../../core/AssetUrls";
import { AllPlayers, Nukes } from "../../core/game/Game";
import { GameView, PlayerView } from "../view";
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
const targetIcon = assetUrl("images/TargetIcon.svg");
const traitorIcon = assetUrl("images/TraitorIcon.svg");
const doomsdayClockIcon = assetUrl("images/DoomsdayClockSkull.svg");

const TRAITOR_ICON_ID = "traitor" as const;
const DOOMSDAY_CLOCK_ICON_ID = "doomsday-clock" as const;
const CROWN_ICON_ID = "crown" as const;
const DISCONNECTED_ICON_ID = "disconnected" as const;
const ALLIANCE_REQUEST_ICON_ID = "alliance-request" as const;
const TARGET_ICON_ID = "target" as const;
const EMOJI_ICON_ID = "emoji" as const;
const EMBARGO_ICON_ID = "embargo" as const;
const NUKE_ICON_ID = "nuke" as const;

export const IMAGE_ICON_KIND = "image" as const;
export const EMOJI_ICON_KIND = "emoji" as const;

interface PlayerIconDescriptor {
  id: string;
  kind: string;
  /** Image URL for image icons */
  src?: string;
  /** Text content for emoji icons */
  text?: string;
  /** Whether the icon should be visually centered over the name */
  center?: boolean;
}

interface PlayerIconParams {
  game: GameView;
  player: PlayerView;
  /** Player currently in first place, used for the crown icon */
  firstPlace: PlayerView | null;
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
  const { game, player, firstPlace, darkMode, transitiveTargets } = params;

  const myPlayer = game.myPlayer();
  const isDarkMode = darkMode ?? false;

  const icons: PlayerIconDescriptor[] = [];

  // Crown icon for first place — a crown cosmetic skins the default icon.
  if (player === firstPlace) {
    const crownUrl = player.cosmetics.crown?.url;
    icons.push({
      id: CROWN_ICON_ID,
      kind: IMAGE_ICON_KIND,
      src: crownUrl ? assetUrl(crownUrl) : crownIcon,
    });
  }

  // Traitor icon
  if (player.isTraitor()) {
    icons.push({
      id: TRAITOR_ICON_ID,
      kind: IMAGE_ICON_KIND,
      src: traitorIcon,
    });
  }

  // Doomsday Clock skull (anti-stall: below the rising territory bar)
  if (player.inDoomsdayClock()) {
    icons.push({
      id: DOOMSDAY_CLOCK_ICON_ID,
      kind: IMAGE_ICON_KIND,
      src: doomsdayClockIcon,
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

  // Alliance request icon (theme dependent)
  if (myPlayer !== null && player.isRequestingAllianceWith(myPlayer)) {
    // TODO: default white icon to align with name-pass, make Graphics preset default/night pick the black/white version for name-pass and here?
    const allianceRequestIcon = isDarkMode
      ? allianceRequestBlackIcon
      : allianceRequestWhiteIcon;
    icons.push({
      id: ALLIANCE_REQUEST_ICON_ID,
      kind: IMAGE_ICON_KIND,
      src: allianceRequestIcon,
    });
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

  // Embargo icon (theme dependent)
  if (myPlayer?.hasEmbargo(player)) {
    // TODO: default white icon to align with name-pass, make Graphics preset default/night pick the black/white version for name-pass and here?
    const embargoIcon = isDarkMode ? embargoBlackIcon : embargoWhiteIcon;
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
