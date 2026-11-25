import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import type { LevelBadge } from "@openfront/shared/LevelBadgeWire";
import type {
  PlayerCard,
  PlayerCardRefs,
  TrackerStat,
} from "@openfront/shared/PlayerCardSchemas";

// Everything one player card shows, resolved: equipped items looked up in
// the catalogue (an item the catalogue doesn't have is null, so the card
// shows the default for that slot rather than nothing at all). Titles and
// taunts are held back: a saved one stays on the loadout, but isn't shown.
export interface PlayerCardView {
  username: string;
  clanTag: string | null;
  // The resolved flag asset path, as PlayerCosmetics.flag carries it.
  flag?: string;
  // Null for a player without a level (progression off, level hidden).
  badge: LevelBadge | null;
  background: {
    name: string;
    url: string;
    rarity: string;
    animation?: unknown;
  } | null;
  trackers: { stat: TrackerStat; value: number }[];
}

export interface PlayerCardInput {
  username: string;
  clanTag: string | null;
  flag?: string;
  badge: LevelBadge | null;
  card?: PlayerCard | PlayerCardRefs | null;
}

export function buildPlayerCardView(
  input: PlayerCardInput,
  cosmetics: Cosmetics | null,
): PlayerCardView {
  const card = input.card ?? null;
  const bg =
    card?.background !== undefined
      ? cosmetics?.cardBackgrounds?.[card.background]
      : undefined;
  return {
    username: input.username,
    clanTag: input.clanTag,
    flag: input.flag,
    badge: input.badge,
    background:
      bg === undefined
        ? null
        : {
            name: bg.name,
            url: bg.url,
            rarity: String(bg.rarity),
            animation: bg.animation,
          },
    trackers:
      card?.trackers.map((t) => ({ stat: t.stat, value: t.value })) ?? [],
  };
}

// The Standard card with nothing equipped: a preview of the card for a
// player who doesn't own one yet.
export function defaultPlayerCardView(
  username: string,
  clanTag: string | null,
  flag?: string,
  badge: LevelBadge | null = null,
): PlayerCardView {
  return {
    username,
    clanTag,
    flag,
    badge,
    background: null,
    trackers: [],
  };
}

// A tracker's value: "38,912", or "38.9k" / "1.2M" where space is short.
// "—" for a value that isn't known (NaN: the Inventory's preview of a stat
// the server hasn't sent).
export function formatTracker(value: number, compact: boolean): string {
  if (!Number.isFinite(value)) return "—";
  if (!compact || Math.abs(value) < 1000) return value.toLocaleString();
  const [divisor, suffix] =
    Math.abs(value) >= 1_000_000 ? [1_000_000, "M"] : [1000, "k"];
  const shown = Math.floor((value / divisor) * 10) / 10;
  return `${shown % 1 === 0 ? shown.toFixed(0) : shown.toFixed(1)}${suffix}`;
}
