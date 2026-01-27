import { GameMapType } from "../core/game/Game";
import { publicLobbyMaps } from "../core/game/PublicLobbyMaps";

const MAP_VOTE_STORAGE_KEY = "publicLobby.mapVotes";

export function loadStoredMapVotes(): GameMapType[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(MAP_VOTE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const allowedMaps = new Set(publicLobbyMaps);
    return parsed.filter(
      (map): map is GameMapType =>
        typeof map === "string" && allowedMaps.has(map as GameMapType),
    );
  } catch (error) {
    console.warn("Failed to read map votes from localStorage:", error);
    return [];
  }
}

export function saveStoredMapVotes(maps: GameMapType[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    const allowedMaps = new Set(publicLobbyMaps);
    const unique = Array.from(
      new Set(maps.filter((map) => allowedMaps.has(map))),
    );
    localStorage.setItem(MAP_VOTE_STORAGE_KEY, JSON.stringify(unique));
  } catch (error) {
    console.warn("Failed to save map votes to localStorage:", error);
  }
}
