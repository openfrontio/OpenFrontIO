import { zb } from "@openfront/zbin";
import { z } from "zod/v4";
import { MAX_CARD_TRACKERS, TrackerStatSchema } from "./CardTrackers";
import { CosmeticNameSchema } from "./CosmeticSchemas";

export {
  MAX_CARD_TRACKERS,
  TRACKER_STATS,
  TrackerStatSchema,
} from "./CardTrackers";
export type { TrackerStat } from "./CardTrackers";

// A nemesis is someone who eliminated you this many times in this window
// (this game included). Placeholders from the spec, kept in one place.
export const NEMESIS_MIN_ELIMINATIONS = 3;
export const NEMESIS_WINDOW_DAYS = 7;

export const CardTrackerValueSchema = z.object({
  stat: TrackerStatSchema,
  value: zb.uint(),
});
export type CardTrackerValue = z.infer<typeof CardTrackerValueSchema>;

// A player's card loadout as /users/@me returns it: equipped cosmetic names
// (each resolved through the catalogue) and the values of up to three owned
// trackers. Only players who own the card have one.
export const PlayerCardRefsSchema = z.object({
  background: CosmeticNameSchema.optional(),
  title: CosmeticNameSchema.optional(),
  taunt: CosmeticNameSchema.optional(),
  trackers: CardTrackerValueSchema.array().max(MAX_CARD_TRACKERS),
});
export type PlayerCardRefs = z.infer<typeof PlayerCardRefsSchema>;

// The card as GET /users/@me sends it, read into PlayerCardRefs: an empty
// slot is null there, and a tracker stat this client doesn't know (a newer
// API) is dropped alone rather than failing the whole card.
export const UserMeCardSchema = z
  .object({
    background: CosmeticNameSchema.nullish(),
    title: CosmeticNameSchema.nullish(),
    taunt: CosmeticNameSchema.nullish(),
    trackers: z.array(z.unknown()),
  })
  .transform((c): PlayerCardRefs => {
    const out: PlayerCardRefs = {
      trackers: c.trackers
        .flatMap((t) => {
          const parsed = CardTrackerValueSchema.safeParse(t);
          return parsed.success ? [parsed.data] : [];
        })
        .slice(0, MAX_CARD_TRACKERS),
    };
    if (c.background) out.background = c.background;
    if (c.title) out.title = c.title;
    if (c.taunt) out.taunt = c.taunt;
    return out;
  });

// The card as the game server sends it with each player: the loadout checked
// against what the player owns, plus their public profile id so a player they
// eliminate can look up the nemesis count. Never sent to a viewer the
// player's name is hidden from.
export const PlayerCardSchema = PlayerCardRefsSchema.extend({
  publicId: z.string().optional(),
});
export type PlayerCard = z.infer<typeof PlayerCardSchema>;
