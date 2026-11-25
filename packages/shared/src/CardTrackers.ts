import { z } from "zod/v4";

// The stats a player card can show, one paid `cardTracker` cosmetic each
// (the cosmetic's name is the stat). Its own module, with no imports of ours,
// so both the catalogue (CosmeticSchemas) and the card wire schema
// (PlayerCardSchemas) can use it without importing each other.
export const TRACKER_STATS = [
  "wins",
  "games_played",
  "nukes_launched",
  "conquests",
  "best_elo",
  "ffa_peak_rating",
] as const;

export const TrackerStatSchema = z.enum(TRACKER_STATS);
export type TrackerStat = z.infer<typeof TrackerStatSchema>;

// A card shows at most this many trackers.
export const MAX_CARD_TRACKERS = 3;
