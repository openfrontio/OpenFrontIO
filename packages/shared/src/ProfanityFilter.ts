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

// Name screening shared by the game server (which always masks hate terms
// before a name reaches anyone) and the client (which masks everything else
// for viewers who keep the profanity filter on, and warns a player while they
// type a name that will be masked).
//
// Two tiers:
//   - hate terms (slurs, extremist names and symbols): masked on the server
//     for everyone. The viewer's filter setting cannot reveal them.
//   - general profanity (obscenity's englishDataset): sent as typed, masked on
//     the client unless the viewer has opted out of the filter.
//
// Every word here is needed even when englishDataset also covers it: the
// dataset has no hate/extremism terms (hitler, nazi, spic, ...), and its
// patterns are partly word-anchored and keep double letters, so only the
// unanchored + deduped patterns built from this list catch substring and
// repeated-character bypasses ("xXfaggotXx", "niiiigger").
const hateWords = [
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

// A span of the input, inclusive on both ends (obscenity's convention).
export interface ProfanitySpan {
  startIndex: number;
  endIndex: number;
}

interface SpanMatcher {
  hasMatch(input: string): boolean;
  spans(input: string): ProfanitySpan[];
}

function buildDataset(dedup: boolean, includeEnglish: boolean) {
  const dataset = new DataSet<{ originalWord: string }>();
  if (includeEnglish) dataset.addAll(englishDataset);
  for (const word of hateWords) {
    const w = dedup ? word.replace(/(.)\1+/g, "$1") : word;
    dataset.addPhrase((phrase) =>
      phrase.setMetadata({ originalWord: word }).addPattern(pattern`${w}`),
    );
  }
  return dataset.build();
}

// "kkk" is matched literally: obscenity's collapse transformer folds it to
// "k", and a dataset pattern for it would also fire on every double k.
function kkkSpans(input: string): ProfanitySpan[] {
  const spans: ProfanitySpan[] = [];
  const lower = input.toLowerCase();
  let at = lower.indexOf("kkk");
  while (at !== -1) {
    spans.push({ startIndex: at, endIndex: at + 2 });
    at = lower.indexOf("kkk", at + 1);
  }
  return spans;
}

function createMatcher(includeEnglish: boolean): SpanMatcher {
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
    ...buildDataset(false, includeEnglish),
    blacklistMatcherTransformers: [
      ...baseTransformers,
      skipNonAlphabeticTransformer(),
    ],
  });
  const collapseMatcher = new RegExpMatcher({
    ...buildDataset(true, includeEnglish),
    blacklistMatcherTransformers: [
      ...baseTransformers,
      collapseDuplicatesTransformer(),
      skipNonAlphabeticTransformer(),
    ],
  });
  return {
    hasMatch: (input) =>
      input.toLowerCase().includes("kkk") ||
      substringMatcher.hasMatch(input) ||
      collapseMatcher.hasMatch(input),
    spans: (input) => [
      ...kkkSpans(input),
      ...substringMatcher.getAllMatches(input),
      ...collapseMatcher.getAllMatches(input),
    ],
  };
}

/** Hate terms only: what the server masks for every viewer. */
export const hateSpeechMatcher = createMatcher(false);

/** Everything the filter knows: hate terms plus general profanity. */
export const profanityMatcher = createMatcher(true);

// Replace every letter a span covers with "*". Whitespace inside a span is
// kept so "f u c k" stays readable as a masked phrase rather than one blob,
// and characters outside every span are untouched.
function maskSpans(input: string, spans: ProfanitySpan[]): string {
  if (spans.length === 0) return input;
  // Indexed by UTF-16 code unit, which is what obscenity reports.
  const chars = input.split("");
  for (const { startIndex, endIndex } of spans) {
    for (let i = startIndex; i <= endIndex && i < chars.length; i++) {
      if (!/\s/.test(chars[i])) chars[i] = "*";
    }
  }
  return chars.join("");
}

/** The input with every hate term masked as `***`. */
export function maskHateSpeech(input: string): string {
  return maskSpans(input, hateSpeechMatcher.spans(input));
}

/** The input with every hate term and general profanity masked as `***`. */
export function maskProfanity(input: string): string {
  return maskSpans(input, profanityMatcher.spans(input));
}

/** Whether the filter would mask any part of the input. */
export function containsProfanity(input: string): boolean {
  return profanityMatcher.hasMatch(input);
}
