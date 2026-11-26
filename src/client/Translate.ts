// translateText() and the functions around it. Kept apart from Utils.ts, and
// importing nothing of the game's, so code shipped outside the game (the
// cosmetic preview package, src/client/cosmetic-preview) can use them without
// pulling in Utils' imports. Utils.ts re-exports all of it.

import IntlMessageFormat from "intl-messageformat";
import type { LangSelector } from "./LangSelector";

export function formatDebugTranslation(
  key: string,
  params: Record<string, string | number>,
): string {
  const entries = Object.entries(params);
  if (entries.length === 0) return key;
  const serializedParams = entries
    .map(([paramKey, value]) => `${paramKey}=${String(value)}`)
    .join(",");
  return `${key}::${serializedParams}`;
}

const EMPTY_TRANSLATION_PARAMS: Record<string, string | number> = {};

type TranslationSource = Pick<
  LangSelector,
  "currentLang" | "translations" | "defaultTranslations"
>;

// Used only where no <lang-selector> exists: components shipped outside the
// game (the cosmetic preview library, src/client/cosmetic-preview) register
// their English strings here so they never show raw keys. The game always
// has a <lang-selector>, which keeps precedence.
let standaloneTranslations: TranslationSource | null = null;

/** Register English fallback strings for pages without a <lang-selector>. */
export function setStandaloneTranslations(
  defaultTranslations: Record<string, string>,
): void {
  standaloneTranslations = {
    currentLang: "en",
    translations: undefined,
    defaultTranslations,
  };
}

/**
 * Return the connected language selector, or standalone strings if none exists.
 * Return null when no document or translation source is available.
 */
function getCachedLangSelector(): TranslationSource | null {
  const self = translateText as any;
  const cached = self.langSelector as LangSelector | null | undefined;
  if (cached && cached.isConnected) return cached;

  // A lit update is scheduled on a microtask, so a component can render once
  // more after its environment has gone -- which in tests means `document` is
  // no longer defined by the time this runs. Returning null makes
  // translateText fall back to the key instead of throwing an unhandled
  // rejection that fails the whole run.
  if (typeof document === "undefined") {
    self.langSelector = null;
    return null;
  }

  const found = document.querySelector("lang-selector") as LangSelector | null;
  self.langSelector = found ?? null;
  return found ?? standaloneTranslations;
}

/** The locale selected in OpenFront's language picker, with a safe UI fallback. */
export const getCurrentLanguage = (): string => {
  const lang = getCachedLangSelector()?.currentLang ?? "en";
  return lang === "debug" ? "en" : lang;
};

/** Language codes whose script reads right-to-left (resources/lang/metadata.json). */
const RTL_LANGUAGES = new Set(["ar", "fa", "he"]);

/**
 * True when the given language renders right-to-left. Defaults to the
 * currently selected UI language, so callers can simply write `isRTL()`.
 */
export const isRTL = (lang?: string): boolean => {
  const code = (lang ?? getCachedLangSelector()?.currentLang ?? "en").split(
    "-",
  )[0];
  return RTL_LANGUAGES.has(code);
};

/**
 * Value for the HTML `dir` attribute matching the current UI language.
 * Apply it to containers whose text comes from translateText() so Persian,
 * Arabic and Hebrew render right-to-left with correct mixed-content ordering.
 */
export const textDirection = (): "rtl" | "ltr" => (isRTL() ? "rtl" : "ltr");

export const translateText = (
  key: string,
  params?: Record<string, string | number>,
): string => {
  const self = translateText as any;
  self.formatterCache ??= new Map();
  self.lastLang ??= null;

  const langSelector = getCachedLangSelector();
  if (!langSelector) {
    return key;
  }

  const resolvedParams = params ?? EMPTY_TRANSLATION_PARAMS;

  if (langSelector.currentLang === "debug") {
    return formatDebugTranslation(key, resolvedParams);
  }

  const translations = langSelector.translations;
  const defaultTranslations = langSelector.defaultTranslations;
  if (!translations && !defaultTranslations) return key;

  if (self.lastLang !== langSelector.currentLang) {
    self.formatterCache.clear();
    self.lastLang = langSelector.currentLang;
  }

  let message = translations?.[key];
  const hasPrimaryTranslation = message !== undefined;

  message ??= defaultTranslations?.[key];

  if (message === undefined) return key;

  // Fast path: no params and no ICU placeholders.
  if (
    resolvedParams === EMPTY_TRANSLATION_PARAMS &&
    message.indexOf("{") === -1
  ) {
    return message;
  }

  try {
    const locale =
      !hasPrimaryTranslation && langSelector.currentLang !== "en"
        ? "en"
        : langSelector.currentLang;
    const cacheKey = `${key}:${locale}:${message}`;
    let formatter = self.formatterCache.get(cacheKey);

    if (!formatter) {
      formatter = new IntlMessageFormat(message, locale);
      self.formatterCache.set(cacheKey, formatter);
    }

    return formatter.format(resolvedParams) as string;
  } catch (e) {
    console.warn("ICU format error", e);
    return message;
  }
};

/**
 * Whether `key` is translated in the player's own language, rather than only
 * in the English that translateText falls back to.
 */
export const hasOwnTranslation = (key: string): boolean =>
  getCachedLangSelector()?.translations?.[key] !== undefined;

/**
 * The raw message templates of every key under `prefix`, in the player's
 * language over English, keyed without the prefix and not formatted. For a
 * page that formats its own text from them: the clan map frame, which is
 * served by the API and gets its strings over postMessage.
 */
export const translationTemplates = (
  prefix: string,
): Record<string, string> => {
  const langSelector = getCachedLangSelector();
  const out: Record<string, string> = {};
  for (const source of [
    langSelector?.defaultTranslations,
    langSelector?.translations,
  ]) {
    for (const key in source ?? {}) {
      if (key.startsWith(prefix)) out[key.slice(prefix.length)] = source![key];
    }
  }
  return out;
};
