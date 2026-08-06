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
import { simpleHash } from "../core/Util";

export const shadowNames = [
  "UnhuggedToday",
  "DaddysLilChamp",
  "BunnyKisses67",
  "SnugglePuppy",
  "CuddleMonster67",
  "DaddysLilStar",
  "SnuggleMuffin",
  "PeesALittle",
  "PleaseFullSendMe",
  "NanasLilMan",
  "NoAlliances",
  "TryingTooHard67",
  "MommysLilStinker",
  "NeedHugs",
  "MommysLilPeanut",
  "IWillBetrayU",
  "DaddysLilTater",
  "PreciousBubbles",
  "67 Cringelord",
  "Peace And Love",
  "AlmostPottyTrained",
];

// Basic obscenity check. Full username moderation happens in the API
// (join_verify); this static list plus the obscenity englishDataset only
// screens the paths that call never covers: Dev, API failure (fail-open
// joins), and re-admitted reconnects with no stored identity.
//
// Every word here is needed even when englishDataset also covers it: the
// dataset has no hate/extremism terms (hitler, nazi, spic, ...), and its
// patterns are partly word-anchored and keep double letters, so only the
// unanchored + deduped patterns built from this list catch substring and
// repeated-character bypasses ("xXfaggotXx", "niiiigger").
const bannedWords = [
  "nigger",
  "nigga",
  "chink",
  "spic",
  "kike",
  "faggot",
  "retard",
  "hitler",
  "adolf",
  "nazi",
  "auschwitz",
  "whitepower",
  "heil",
];

function buildDataset(dedup: boolean) {
  const dataset = new DataSet<{ originalWord: string }>().addAll(
    englishDataset,
  );
  for (const word of bannedWords) {
    const w = dedup ? word.replace(/(.)\1+/g, "$1") : word;
    dataset.addPhrase((phrase) =>
      phrase.setMetadata({ originalWord: word }).addPattern(pattern`${w}`),
    );
  }
  return dataset.build();
}

function createMatcher(): RegExpMatcher {
  const baseTransformers = [
    toAsciiLowerCaseTransformer(),
    resolveConfusablesTransformer(),
    resolveLeetSpeakTransformer(),
  ];
  // substringMatcher: literal patterns, no collapse — catches "niggertesting" as a substring
  // collapseMatcher: deduped patterns + collapse transformer — catches "niiiigger", "hiiitler"
  // skipNonAlphabeticTransformer is applied last to catch punctuation-separated bypasses
  // like "n.i.g.g.e.r".
  const substringMatcher = new RegExpMatcher({
    ...buildDataset(false),
    blacklistMatcherTransformers: [
      ...baseTransformers,
      skipNonAlphabeticTransformer(),
    ],
  });
  const collapseMatcher = new RegExpMatcher({
    ...buildDataset(true),
    blacklistMatcherTransformers: [
      ...baseTransformers,
      collapseDuplicatesTransformer(),
      skipNonAlphabeticTransformer(),
    ],
  });
  return {
    hasMatch: (input: string) =>
      input.toLowerCase().includes("kkk") ||
      substringMatcher.hasMatch(input) ||
      collapseMatcher.hasMatch(input),
    getAllMatches: (input: string, sorted?: boolean) => [
      ...substringMatcher.getAllMatches(input, sorted),
      ...collapseMatcher.getAllMatches(input, sorted),
    ],
  } as unknown as RegExpMatcher;
}

export const profanityMatcher = createMatcher();

/**
 * Same censoring semantics as the API's join_verify: a profane username is
 * replaced with its deterministic shadow name (same pool and hash the API
 * uses); a profane clan tag, the literal "ss", or a banned word completed
 * across the tag/name boundary (tag HIT + name LER — which also shadow-names
 * the username) drops the tag; a surviving tag is uppercased.
 */
export function censorPlayer(
  username: string,
  clanTag: string | null,
): { username: string; clanTag: string | null } {
  const usernameIsProfane = profanityMatcher.hasMatch(username);
  const clanTagIsProfane = clanTag
    ? profanityMatcher.hasMatch(clanTag) || clanTag.toLowerCase() === "ss"
    : false;
  const combinedSlurAcrossBoundary = clanTag
    ? profanityMatcher.getAllMatches(clanTag + username).some(
        (match) =>
          // Match must start in the clan and extend into the name — otherwise
          // it's already handled by the clan-only or name-only checks above.
          match.startIndex < clanTag.length && match.endIndex >= clanTag.length,
      )
    : false;

  const censoredName =
    usernameIsProfane || combinedSlurAcrossBoundary
      ? shadowNames[simpleHash(username) % shadowNames.length]
      : username;

  const censoredClanTag =
    clanTag && !clanTagIsProfane && !combinedSlurAcrossBoundary
      ? clanTag.toUpperCase()
      : null;

  return { username: censoredName, clanTag: censoredClanTag };
}
