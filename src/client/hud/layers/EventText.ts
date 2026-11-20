import { translateText } from "../../Utils";

export interface EventTextPart {
  text: string;
  /** A filled-in value (a name, an amount), drawn in bold. */
  strong: boolean;
}

// Private-use characters around each marked value. The translation puts the
// value where its language wants it, so the marks show where it ended up
// without searching the sentence for it.
const OPEN = "";
const CLOSE = "";
const MARKS = /[]/g;
const MARKED_VALUE = /([^]*)/;

/**
 * Translates `key` and returns the sentence in parts, with the values of the
 * params named in `strong` marked. Only string values can be marked: a number
 * goes to the translation as a number, so its plural forms keep working.
 */
export function eventText(
  key: string,
  params: Record<string, string | number>,
  strong: readonly string[],
): EventTextPart[] {
  const marked = { ...params };
  for (const name of strong) {
    const value = params[name];
    if (typeof value === "string") {
      marked[name] = OPEN + value.replace(MARKS, "") + CLOSE;
    }
  }
  // split() with a capture group: odd pieces are the marked values.
  return translateText(key, marked)
    .split(MARKED_VALUE)
    .map((text, i) => ({ text, strong: i % 2 === 1 }))
    .filter((part) => part.text !== "");
}
