import { MAX_USERNAME_LENGTH } from "@openfront/engine-api/Schemas";
import { simpleHash } from "@openfront/engine-lib/Util";
import {
  hateSpeechMatcher,
  maskHateSpeech,
  profanityMatcher,
} from "@openfront/shared/ProfanityFilter";

export { profanityMatcher };

// The pool the API's join_verify picks a replacement name from when it flags
// a username (same list and hash). The game server no longer hands these
// out itself; it only recognises them, so an API-issued replacement can be
// swapped back for the masked form (see unshadowApiName).
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

function shadowNameFor(username: string): string {
  return shadowNames[simpleHash(username) % shadowNames.length];
}

function clamp(name: string): string {
  return name.length > MAX_USERNAME_LENGTH
    ? name.slice(0, MAX_USERNAME_LENGTH).trim()
    : name;
}

/**
 * The join-time screen for a display name and clan tag.
 *
 * Profanity is masked with `*`, never replaced with a made-up name:
 *   - hate terms (slurs, extremist names) are masked here, for every viewer;
 *   - general profanity is left as typed and masked on each viewer's client,
 *     unless that viewer has turned the profanity filter off
 *     (UserSettings.profanityFilter).
 *
 * A clan tag is too short to mask legibly, so a profane tag (either tier),
 * the literal "ss", or a tag that completes a banned word across the
 * tag/name boundary (tag HIT + name LER) is dropped. In the boundary case the
 * part of the word that falls in the name is masked too when it is a hate
 * term. A surviving tag is uppercased.
 */
export function censorPlayer(
  username: string,
  clanTag: string | null,
): { username: string; clanTag: string | null } {
  const clanTagIsProfane = clanTag
    ? profanityMatcher.hasMatch(clanTag) || clanTag.toLowerCase() === "ss"
    : false;
  const crossesBoundary = (
    spans: { startIndex: number; endIndex: number }[],
    tag: string,
  ) =>
    // A span must start in the clan and extend into the name — otherwise
    // it's already handled by the clan-only or name-only checks.
    spans.filter(
      (s) => s.startIndex < tag.length && s.endIndex >= tag.length,
    );
  const boundaryProfanity = clanTag
    ? crossesBoundary(profanityMatcher.spans(clanTag + username), clanTag)
        .length > 0
    : false;

  let censoredName = maskHateSpeech(username);
  if (clanTag) {
    const hateAcross = crossesBoundary(
      hateSpeechMatcher.spans(clanTag + username),
      clanTag,
    );
    if (hateAcross.length > 0) {
      const chars = censoredName.split("");
      for (const span of hateAcross) {
        for (let i = span.startIndex; i <= span.endIndex; i++) {
          const nameIndex = i - clanTag.length;
          if (nameIndex >= 0 && nameIndex < chars.length) {
            if (!/\s/.test(chars[nameIndex])) chars[nameIndex] = "*";
          }
        }
      }
      censoredName = chars.join("");
    }
  }

  const censoredClanTag =
    clanTag && !clanTagIsProfane && !boundaryProfanity
      ? clanTag.toUpperCase()
      : null;

  return { username: clamp(censoredName), clanTag: censoredClanTag };
}

/**
 * The API's join_verify replaces a name it flags with one of shadowNames.
 * This server masks instead, so when the API's answer is exactly the shadow
 * name for what the player typed, use the locally masked name in its place.
 * Should the API have flagged a name the local filter finds nothing in (its
 * own list or a model caught it), the whole name is masked rather than shown
 * as typed. Any other answer from the API is kept.
 */
export function unshadowApiName(
  requested: string,
  approved: string,
  locallyCensored: string,
): string {
  if (approved === requested || approved !== shadowNameFor(requested)) {
    return approved;
  }
  if (profanityMatcher.hasMatch(requested)) return locallyCensored;
  return clamp(requested.replace(/\S/g, "*"));
}
