import { translateText } from "../../Utils";

export interface EventTextPart {
  text: string;
  /** A filled-in value (a name, an amount), drawn in bold. */
  strong: boolean;
  /** An emoji, drawn larger than the text. */
  emoji?: boolean;
}

// Private-use characters around each marked value: one opens a bold value,
// one opens an emoji, one closes either. The translation puts the value where
// its language wants it, so the marks show where it ended up without
// searching the sentence for it.
const STRONG = "";
const CLOSE = "";
const EMOJI = "";
const MARKS = /[-]/g;
// The opening mark stays in the captured piece, to tell its kind.
const MARKED_VALUE = /([][^-]*)/;

/**
 * Translates `key` and returns the sentence in parts, with the values of the
 * params named in `strong` marked, and the value of the param named `emoji`
 * marked as an emoji. Only string values can be marked: a number goes to the
 * translation as a number, so its plural forms keep working.
 */
export function eventText(
  key: string,
  params: Record<string, string | number>,
  strong: readonly string[],
  emoji?: string,
): EventTextPart[] {
  const marked = { ...params };
  const mark = (name: string, open: string) => {
    const value = params[name];
    if (typeof value === "string") {
      marked[name] = open + value.replace(MARKS, "") + CLOSE;
    }
  };
  strong.forEach((name) => mark(name, STRONG));
  if (emoji !== undefined) {
    mark(emoji, EMOJI);
  }
  // split() with a capture group: odd pieces are the marked values.
  return translateText(key, marked)
    .split(MARKED_VALUE)
    .map((piece, i): EventTextPart => {
      if (i % 2 === 0) {
        return { text: piece, strong: false };
      }
      const text = piece.slice(1);
      return piece[0] === EMOJI
        ? { text, strong: false, emoji: true }
        : { text, strong: true };
    })
    .filter((part) => part.text !== "");
}
