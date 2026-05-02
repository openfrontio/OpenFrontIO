import {
  DataSet,
  RegExpMatcher,
  collapseDuplicatesTransformer,
  englishDataset,
  pattern,
  resolveConfusablesTransformer,
  resolveLeetSpeakTransformer,
  toAsciiLowerCaseTransformer,
} from "obscenity";
import countries from "resources/countries.json";

import { Cosmetics } from "../core/CosmeticSchemas";
import { decodePatternData } from "../core/PatternDecoder";
import {
  PlayerColor,
  PlayerCosmeticRefs,
  PlayerCosmetics,
  PlayerPattern,
} from "../core/Schemas";
import { simpleHash } from "../core/Util";

const countryCodes = countries.filter((c) => !c.restricted).map((c) => c.code);

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

function buildDataset(bannedWords: string[], dedup: boolean) {
  const dataset = new DataSet<{ originalWord: string }>().addAll(
    englishDataset,
  );
  for (const word of bannedWords) {
    try {
      const w = dedup ? word.toLowerCase().replace(/(.)\1+/g, "$1") : word;
      dataset.addPhrase((phrase) =>
        phrase.setMetadata({ originalWord: word }).addPattern(pattern`${w}`),
      );
    } catch (e) {
      console.error(`Invalid banned word pattern "${word}": ${e}`);
    }
  }
  return dataset.build();
}

export function createMatcher(bannedWords: string[]): RegExpMatcher {
  const baseTransformers = [
    toAsciiLowerCaseTransformer(),
    resolveConfusablesTransformer(),
    resolveLeetSpeakTransformer(),
  ];
  // substringMatcher: literal patterns, no collapse — catches "niggertesting" as a substring
  // collapseMatcher: deduped patterns + collapse transformer — catches "niiiigger", "hiiitler"
  const substringMatcher = new RegExpMatcher({
    ...buildDataset(bannedWords, false),
    blacklistMatcherTransformers: baseTransformers,
  });
  const collapseMatcher = new RegExpMatcher({
    ...buildDataset(bannedWords, true),
    blacklistMatcherTransformers: [
      ...baseTransformers,
      collapseDuplicatesTransformer(),
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

/**
 * Sanitizes and censors profane usernames and clan tags separately.
 * Profane username is overwritten, profane clan tag is removed.
 *
 * Removing bad clan tags won't hurt existing clans nor cause desyncs:
 * - full name including clan tag was overwritten in the past, if any part of name was bad
 * - only each separate local player name with a profane clan tag will remain, no clan team assignment
 *
 * Examples:
 * - username="GoodName", clanTag=null -> { username: "GoodName", clanTag: null }
 * - username="BadName", clanTag=null -> { username: "Censored", clanTag: null }
 * - username="GoodName", clanTag="CLaN" -> { username: "GoodName", clanTag: "CLAN" }
 * - username="GoodName", clanTag="BAD" -> { username: "GoodName", clanTag: null }
 * - username="BadName", clanTag="BAD" -> { username: "Censored", clanTag: null }
 */

function censorWithMatcher(
  username: string,
  clanTag: string | null,
  matcher: RegExpMatcher,
): { username: string; clanTag: string | null } {
  const usernameIsProfane = matcher.hasMatch(username);
  const clanTagIsProfane = clanTag
    ? matcher.hasMatch(clanTag) || clanTag.toLowerCase() === "ss"
    : false;
  // Catch slurs split across clan tag and username (e.g. clanTag="HIT", username="LER")
  // by looking for a match that spans the clan/name boundary.
  const combinedSlurAcrossBoundary = clanTag
    ? matcher.getAllMatches(clanTag + username).some(
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

type CosmeticResult =
  | { type: "allowed"; cosmetics: PlayerCosmetics }
  | { type: "forbidden"; reason: string };

export interface PrivilegeChecker {
  isAllowed(flares: string[], refs: PlayerCosmeticRefs): CosmeticResult;
  censor(
    username: string,
    clanTag: string | null,
  ): { username: string; clanTag: string | null };
}

export class PrivilegeCheckerImpl implements PrivilegeChecker {
  private matcher: RegExpMatcher;

  constructor(
    private cosmetics: Cosmetics,
    private b64urlDecode: (base64: string) => Uint8Array,
    bannedWords: string[],
  ) {
    this.matcher = createMatcher(bannedWords);
  }

  isAllowed(flares: string[], refs: PlayerCosmeticRefs): CosmeticResult {
    const cosmetics: PlayerCosmetics = {};
    if (refs.patternName) {
      try {
        cosmetics.pattern = this.isPatternAllowed(
          flares,
          refs.patternName,
          refs.patternColorPaletteName ?? null,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { type: "forbidden", reason: "invalid pattern: " + message };
      }
    }
    if (refs.color) {
      try {
        cosmetics.color = this.isColorAllowed(flares, refs.color);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { type: "forbidden", reason: "invalid color: " + message };
      }
    }
    if (refs.flag) {
      try {
        cosmetics.flag = this.isFlagAllowed(flares, refs.flag);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { type: "forbidden", reason: "invalid flag: " + message };
      }
    }

    return { type: "allowed", cosmetics };
  }

  isPatternAllowed(
    flares: readonly string[],
    name: string,
    colorPaletteName: string | null,
  ): PlayerPattern {
    // Look for the pattern in the cosmetics.json config
    const found = this.cosmetics.patterns[name];
    if (!found) throw new Error(`Pattern ${name} not found`);

    try {
      decodePatternData(found.pattern, this.b64urlDecode);
    } catch (e) {
      // can be enabled once we can use {cause: error} in Error constructor starting with ES2022
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`Invalid pattern ${name}`);
    }

    const colorPalette = this.cosmetics.colorPalettes?.[colorPaletteName ?? ""];

    if (flares.includes("pattern:*")) {
      return {
        name: found.name,
        patternData: found.pattern,
        colorPalette,
      } satisfies PlayerPattern;
    }

    const flareName =
      `pattern:${found.name}` +
      (colorPaletteName ? `:${colorPaletteName}` : "");

    if (flares.includes(flareName)) {
      // Player has a flare for this pattern
      return {
        name: found.name,
        patternData: found.pattern,
        colorPalette,
      } satisfies PlayerPattern;
    } else {
      throw new Error(`No flares for pattern ${name}`);
    }
  }

  isFlagAllowed(flares: string[], flagRef: string): string {
    if (flagRef.startsWith("flag:")) {
      const key = flagRef.slice("flag:".length);
      const found = this.cosmetics.flags[key];
      if (!found) throw new Error(`Flag ${key} not found`);

      if (flares.includes("flag:*") || flares.includes(`flag:${found.name}`)) {
        return found.url;
      }

      throw new Error(`No flares for flag ${key}`);
    } else if (flagRef.startsWith("country:")) {
      const code = flagRef.slice("country:".length);
      if (!countryCodes.includes(code)) {
        throw new Error(`invalid country code`);
      }
      return `/flags/${code}.svg`;
    } else {
      throw new Error(`invalid flag prefix`);
    }
  }

  isColorAllowed(flares: string[], color: string): PlayerColor {
    const allowedColors = flares
      .filter((flare) => flare.startsWith("color:"))
      .map((flare) => flare.split(":")[1]);
    if (!allowedColors.includes(color)) {
      throw new Error(`Color ${color} not allowed`);
    }
    return { color };
  }

  censor(
    username: string,
    clanTag: string | null,
  ): { username: string; clanTag: string | null } {
    return censorWithMatcher(username, clanTag, this.matcher);
  }
}

// Words the englishDataset misses or only catches as standalone tokens.
// These are always enforced even when the remote banned-words list is unavailable.
const baselineBannedWords = ["nigger", "nigga", "chink", "spic", "kike"];

const defaultMatcher = createMatcher(baselineBannedWords);

export class FailOpenPrivilegeChecker implements PrivilegeChecker {
  isAllowed(flares: string[], refs: PlayerCosmeticRefs): CosmeticResult {
    return { type: "allowed", cosmetics: {} };
  }

  censor(
    username: string,
    clanTag: string | null,
  ): { username: string; clanTag: string | null } {
    return censorWithMatcher(username, clanTag, defaultMatcher);
  }
}
