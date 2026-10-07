import { Emoji } from "@openfront/engine-api/Schemas";

export interface EmojiSection {
  /** translateText key for the section heading. */
  title: string;
  emojis: readonly Emoji[];
  /** Fixed column count; full-width sections leave it unset. */
  columns?: 2 | 3;
}

// How the emoji table groups emojis, top to bottom, below the player's
// favorites. Display order only: an emoji goes over the wire as its index in
// flattenedEmojiTable, so that table must not be reordered. Every emoji
// appears here exactly once.
export const emojiSections: readonly EmojiSection[] = [
  {
    title: "emoji_table.faces",
    emojis: [
      "😀",
      "😊",
      "🥰",
      "😇",
      "😎",
      "😞",
      "🥺",
      "😭",
      "😱",
      "😡",
      "😈",
      "🤡",
      "🥱",
      "🫡",
      "🤦‍♂️",
    ],
  },
  {
    title: "emoji_table.gestures",
    emojis: ["👍", "👎", "👋", "👏", "✋", "🙏", "💪", "🫴", "🤌", "🖕"],
  },
  {
    title: "emoji_table.diplomacy",
    emojis: ["🤝", "🆘", "🕊️", "🏳️", "⏳", "⚠️", "❓", "❤️", "💔"],
  },
  {
    title: "emoji_table.things",
    emojis: [
      "🔥",
      "💥",
      "💀",
      "☢️",
      "🛡️",
      "⚓",
      "⛵",
      "💰",
      "🏡",
      "🏭",
      "🚂",
      "🐔",
      "🐀",
    ],
  },
  {
    title: "emoji_table.directions",
    emojis: ["↖️", "⬆️", "↗️", "⬅️", "🎯", "➡️", "↙️", "⬇️", "↘️"],
    columns: 3,
  },
  {
    title: "emoji_table.ranks",
    emojis: ["👑", "🥇", "🥈", "🥉"],
    columns: 2,
  },
];

// One key per favorites slot, in slot order: the keys under the left hand,
// which is already near F (the default open key) while the right holds the
// mouse. Matched by physical key (e.code), like every other keybind.
const FAVORITE_KEYS = "qweasd";

/** How many favorites slots the emoji table has. */
export const FAVORITE_SLOTS = FAVORITE_KEYS.length;

/** The key shown on favorites slot `slot`. */
export function favoriteKeyLabel(slot: number): string {
  return FAVORITE_KEYS[slot];
}

/** The favorites slot a key selects, or null if it selects none. */
export function favoriteSlotForKey(e: {
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): number | null {
  if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (!/^Key[A-Z]$/.test(e.code)) return null;
  const slot = FAVORITE_KEYS.indexOf(e.code[3].toLowerCase());
  return slot === -1 ? null : slot;
}

/**
 * Puts `emoji` in favorites slot `slot`. An emoji that is already a favorite
 * moves, swapping places with whatever was in `slot`.
 */
export function placeFavorite(
  slots: readonly (Emoji | null)[],
  emoji: Emoji,
  slot: number,
): (Emoji | null)[] {
  const next = [...slots];
  const from = next.indexOf(emoji);
  if (from !== -1) next[from] = next[slot] ?? null;
  next[slot] = emoji;
  return next;
}
