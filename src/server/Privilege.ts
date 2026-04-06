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
import { getClanTagOriginalCase, simpleHash } from "../core/Util";

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
 * Sanitizes and censors profane usernames and clan tags.
 * Profane username is overwritten, profane clan tag is removed.
 *
 * Removing bad clan tags won't hurt existing clans nor cause desyncs:
 * - full name including clan tag was overwritten in the past, if any part of name was bad
 * - only each separate local player name with a profane clan tag will remain, no clan team assignment
 *
 * Examples:
 * - "GoodName" -> "GoodName"
 * - "BadName" -> "Censored"
 * - "[CLAN]GoodName" -> "[CLAN]GoodName"
 * - "[CLaN]BadName" -> "[CLAN] Censored"
 * - "[BAD]GoodName" -> "GoodName"
 * - "[BAD]BadName" -> "Censored"
 */
function censorUsernameWithMatcher(
  username: string,
  matcher: RegExpMatcher,
): string {
  const clanTag = getClanTagOriginalCase(username);

  const nameWithoutClan = clanTag
    ? username.replace(`[${clanTag}]`, "").trim()
    : username;

  const clanTagIsProfane = clanTag
    ? matcher.hasMatch(clanTag) || clanTag.toLowerCase() === "ss"
    : false;
  const usernameIsProfane = matcher.hasMatch(nameWithoutClan);

  const censoredName = usernameIsProfane
    ? shadowNames[simpleHash(nameWithoutClan) % shadowNames.length]
    : nameWithoutClan;

  // Restore clan tag only if it's clean, otherwise remove it entirely
  if (clanTag && !clanTagIsProfane) {
    return `[${clanTag.toUpperCase()}] ${censoredName}`;
  }

  return censoredName;
}

type CosmeticResult =
  | { type: "allowed"; cosmetics: PlayerCosmetics }
  | { type: "forbidden"; reason: string };

export interface PrivilegeChecker {
  isAllowed(flares: string[], refs: PlayerCosmeticRefs): CosmeticResult;
  censorUsername(username: string): string;
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
        return { type: "forbidden", reason: "invalid pattern: " + e.message };
      }
    }
    if (refs.color) {
      try {
        cosmetics.color = this.isColorAllowed(flares, refs.color);
      } catch (e) {
        return { type: "forbidden", reason: "invalid color: " + e.message };
      }
    }
    if (refs.flag) {
      try {
        cosmetics.flag = this.isFlagAllowed(flares, refs.flag);
      } catch (e) {
        return { type: "forbidden", reason: "invalid flag: " + e.message };
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

  censorUsername(username: string): string {
    return censorUsernameWithMatcher(username, this.matcher);
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

  censorUsername(username: string): string {
    // Fail open: use matcher with just the built-in English profanity dataset
    return censorUsernameWithMatcher(username, defaultMatcher);
  }
}
