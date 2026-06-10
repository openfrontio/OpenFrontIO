import { TemplateResult, html } from "lit";
import { GameMapType } from "../../../core/game/Game";

const FAVORITES_KEY = "map-favorites";

const validMaps = new Set<string>(Object.values(GameMapType));

export function getFavoriteMaps(): GameMapType[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is GameMapType => typeof m === "string" && validMaps.has(m),
    );
  } catch (error) {
    console.warn("Failed to read favorite maps from localStorage:", error);
    return [];
  }
}

export function isFavoriteMap(map: GameMapType): boolean {
  return getFavoriteMaps().includes(map);
}

export function toggleFavoriteMap(map: GameMapType): GameMapType[] {
  const favorites = getFavoriteMaps();
  const index = favorites.indexOf(map);
  if (index >= 0) {
    favorites.splice(index, 1);
  } else {
    favorites.push(map);
  }
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } catch (error) {
    console.warn("Failed to save favorite maps to localStorage:", error);
  }
  return favorites;
}

export function starIcon(filled: boolean, className = ""): TemplateResult {
  return html`<svg
    viewBox="0 0 24 24"
    class=${className}
    fill=${filled ? "currentColor" : "none"}
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path
      d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
    />
  </svg>`;
}
