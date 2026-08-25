import { GameConfig } from "../core/Schemas";

// The host edits its lobby through update_game_config, which carries a
// partial GameConfig. Only the keys listed here are taken from it. gameType,
// maxPlayers and the listing flag are deliberately absent: each has its own
// guarded path (handleIntent rejects a switch to Public; listing goes through
// the authenticated listing endpoint).

// Copied whenever the patch carries them.
const COPIED_KEYS = [
  "gameMap",
  "gameMapSize",
  "difficulty",
  "nations",
  "bots",
  "infiniteGold",
  "donateGold",
  "infiniteTroops",
  "donateTroops",
  "instantBuild",
  "randomSpawn",
  "gameMode",
  "disabledUnits",
  "playerTeams",
  "allowedPublicIds",
  "doomsdayClock",
  "overtime",
  "anonymizeNames",
  "nameReveals",
  "nameRevealPublicIds",
] as const satisfies readonly (keyof GameConfig)[];

// `.nullable().optional()` in the schema: the wire says null to clear a
// value, the stored config says undefined.
const NULLABLE_KEYS = [
  "maxTimerValue",
  "startDelay",
  "spawnImmunityDuration",
  "goldMultiplier",
  "startingGold",
  "disableAlliances",
  "customAllianceDuration",
  "waterNukes",
] as const satisfies readonly (keyof GameConfig)[];

type NullableKey = (typeof NULLABLE_KEYS)[number];

function copy<K extends keyof GameConfig>(
  target: GameConfig,
  patch: Partial<GameConfig>,
  key: K,
): void {
  const value = patch[key];
  if (value !== undefined) {
    target[key] = value;
  }
}

function copyNullable<K extends NullableKey>(
  target: GameConfig,
  patch: Partial<GameConfig>,
  key: K,
): void {
  const value = patch[key];
  if (value !== undefined) {
    // Every NULLABLE_KEY is optional in GameConfig, so undefined is legal
    // for it; TypeScript cannot see that through the generic key.
    target[key] = (value ?? undefined) as GameConfig[K];
  }
}

// Applies a host's config patch to a game's stored config, in place.
export function applyGameConfigPatch(
  target: GameConfig,
  patch: Partial<GameConfig>,
): void {
  for (const key of COPIED_KEYS) {
    copy(target, patch, key);
  }
  for (const key of NULLABLE_KEYS) {
    copyNullable(target, patch, key);
  }
  // Unconditional on purpose: the host clears cheats by omitting hostCheats
  // (the full config it sends has hostCheats: undefined when the toggle is
  // off), so `undefined` here means "clear", not "leave unchanged".
  target.hostCheats = patch.hostCheats;
}

// Whether the host-only cheat block actually grants anything: mere presence
// isn't enough, the client can send hostCheats with every field off.
export function hostCheatsEnabled(hc: GameConfig["hostCheats"]): boolean {
  return (
    hc !== undefined &&
    (hc.infiniteGold === true ||
      hc.infiniteTroops === true ||
      typeof hc.goldMultiplier === "number" ||
      typeof hc.startingGold === "number")
  );
}
