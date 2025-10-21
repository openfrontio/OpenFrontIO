import {
  DataSet,
  RegExpMatcher,
  collapseDuplicatesTransformer,
  englishDataset,
  pattern,
  resolveConfusablesTransformer,
  resolveLeetSpeakTransformer,
  skipNonAlphabeticTransformer,
  toAsciiLowerCaseTransformer,
} from "obscenity";
import { translateText } from "../../client/Utils";
import { simpleHash } from "../Util";
import { getRandomUsername } from "../utilities/UsernameGenerator";

const customDataset = new DataSet()
  .addAll(englishDataset)
  /* similarity to racial slur */
  .addPhrase((phrase) =>
    phrase
      .setMetadata({ originalWord: "nigg" })
      /* Not used by any english words */
      .addPattern(pattern`niqq`),
  )
  /* historic significance / edgy */
  .addPhrase((phrase) =>
    phrase
      .setMetadata({ originalWord: "hitler" })
      .addPattern(pattern`hitl?r`)
      .addPattern(pattern`hiti?r`)
      .addPattern(pattern`hltl?r`),
  )
  .addPhrase((phrase) =>
    phrase.setMetadata({ originalWord: "nazi" }).addPattern(pattern`|nazi`),
  )
  /* aggressive / edgy */
  .addPhrase((phrase) =>
    phrase.setMetadata({ originalWord: "hang" }).addPattern(pattern`|hang|`),
  )
  .addPhrase((phrase) =>
    phrase
      .setMetadata({ originalWord: "kill" })
      .addPattern(pattern`|kill`)
      /* not used by any english words */
      .addPattern(pattern`ikill`),
  )
  .addPhrase((phrase) =>
    phrase
      .setMetadata({ originalWord: "murder" })
      /* only used by a few english words */
      .addPattern(pattern`murd`)
      .addPattern(pattern`mard`),
  )
  .addPhrase((phrase) =>
    phrase
      .setMetadata({ originalWord: "shoot" })
      .addPattern(pattern`|shoot`)
      .addPattern(pattern`|shot`)
      /* only used by a few english words */
      .addPattern(pattern`ishoot`)
      .addPattern(pattern`ishot`),
  );

const matcher = new RegExpMatcher({
  ...customDataset.build(),

  blacklistMatcherTransformers: [
    resolveConfusablesTransformer(),
    resolveLeetSpeakTransformer(),
    skipNonAlphabeticTransformer(),
    toAsciiLowerCaseTransformer(),
    collapseDuplicatesTransformer({
      customThresholds: new Map([
        ["b", 2],
        ["e", 2],
        ["o", 2],
        ["l", 2],
        ["s", 2],
        ["g", 2],
        ["q", 2],
      ]),
    }),
  ],
});

export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 27;

const validPattern = /^[a-zA-Z0-9_[\] 🐈🍀üÜ]+$/u;

export function fixProfaneUsername(username: string): string {
  if (isProfaneUsername(username)) {
    return getRandomUsername(simpleHash(username));
  }
  return username;
}

export function isProfaneUsername(username: string): boolean {
  return matcher.hasMatch(username);
}

export function validateUsername(username: string): {
  isValid: boolean;
  error?: string;
} {
  if (typeof username !== "string") {
    return { isValid: false, error: translateText("username.not_string") };
  }

  if (username.length < MIN_USERNAME_LENGTH) {
    return {
      isValid: false,
      error: translateText("username.too_short", {
        min: MIN_USERNAME_LENGTH,
      }),
    };
  }

  if (username.length > MAX_USERNAME_LENGTH) {
    return {
      isValid: false,
      error: translateText("username.too_long", {
        max: MAX_USERNAME_LENGTH,
      }),
    };
  }

  if (!validPattern.test(username)) {
    return {
      isValid: false,
      error: translateText("username.invalid_chars", {
        max: MAX_USERNAME_LENGTH,
      }),
    };
  }

  // All checks passed
  return { isValid: true };
}

export function sanitizeUsername(str: string): string {
  const sanitized = Array.from(str)
    .filter((ch) => validPattern.test(ch))
    .join("")
    .slice(0, MAX_USERNAME_LENGTH);
  return sanitized.padEnd(MIN_USERNAME_LENGTH, "x");
}
