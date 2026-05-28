import { Pattern, Skin } from "../core/CosmeticSchemas";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../core/game/Game";
import { GameConfig, PlayerCosmetics } from "../core/Schemas";
import { generateID } from "../core/Util";
import { ResolvedCosmetic } from "./Cosmetics";
import { JoinLobbyEvent } from "./Main";
import { UsernameInput } from "./UsernameInput";

// The cosmetic currently being previewed, stashed so the "Preview Complete"
// modal can show it (and its buy button) when the user finishes. Set the moment
// a preview is launched and read by <preview-complete-modal>.
let previewCosmetic: ResolvedCosmetic | null = null;

export function getPreviewCosmetic(): ResolvedCosmetic | null {
  return previewCosmetic;
}

/** Build a PlayerCosmetics that forces the previewed pattern/skin onto the
 * player, regardless of ownership. Returns null for non-previewable types. */
function playerCosmeticsFor(
  resolved: ResolvedCosmetic,
): PlayerCosmetics | null {
  const c = resolved.cosmetic;
  if (c === null) return null;
  if (resolved.type === "pattern") {
    return {
      pattern: {
        name: c.name,
        patternData: (c as Pattern).pattern,
        colorPalette: resolved.colorPalette ?? undefined,
      },
    };
  }
  if (resolved.type === "skin") {
    return {
      skin: {
        name: c.name,
        url: (c as Skin).url,
      },
    };
  }
  return null;
}

/**
 * Launches a singleplayer skin-preview sandbox for the given cosmetic: the
 * player auto-spawns in the centre of Australia with a 100M-strong army and
 * floods their (skinned) territory across the empty map. Nothing is saved.
 *
 * Patterns and image skins are previewable; other cosmetic types are ignored.
 */
export function launchSkinPreview(resolved: ResolvedCosmetic): void {
  const cosmetics = playerCosmeticsFor(resolved);
  if (cosmetics === null) return;

  previewCosmetic = resolved;

  const clientID = generateID();
  const gameID = generateID();
  const usernameInput = document.querySelector(
    "username-input",
  ) as UsernameInput | null;

  const config: GameConfig = {
    gameMap: GameMapType.Australia,
    gameMapSize: GameMapSize.Normal,
    gameType: GameType.Singleplayer,
    gameMode: GameMode.FFA,
    difficulty: Difficulty.Easy,
    nations: "disabled",
    bots: 0,
    donateGold: false,
    donateTroops: false,
    infiniteGold: true,
    infiniteTroops: true,
    instantBuild: true,
    randomSpawn: false,
    disableAlliances: true,
    isPreview: true,
  };

  document.dispatchEvent(
    new CustomEvent("join-lobby", {
      detail: {
        gameID,
        gameStartInfo: {
          gameID,
          players: [
            {
              clientID,
              username: usernameInput?.getUsername() ?? "Preview",
              clanTag: usernameInput?.getClanTag() ?? null,
              cosmetics,
            },
          ],
          config,
          lobbyCreatedAt: Date.now(),
        },
        source: "singleplayer",
      } satisfies JoinLobbyEvent,
      bubbles: true,
      composed: true,
    }),
  );
}
