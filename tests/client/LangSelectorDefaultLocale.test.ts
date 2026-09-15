import { afterEach, describe, expect, it, vi } from "vitest";
import { LangSelector } from "../../src/client/LangSelector";

// defaultLocale is private; drive it through a cast, the same way
// LangSelectorTranslate.test.ts and GameInfoView.test.ts do. Constructing
// without attaching skips connectedCallback's full language bootstrap.
function defaultLocale(): string {
  const selector = new LangSelector();
  return (selector as unknown as { defaultLocale(): string }).defaultLocale();
}

/** What the Steam shell's preload would expose, or nothing off the shell. */
function withShellLocale(locale: string | null): void {
  window.openfrontDesktop =
    locale === null ? undefined : { steamLocale: locale };
}

function withOsLocale(locale: string): void {
  vi.spyOn(navigator, "language", "get").mockReturnValue(locale);
}

afterEach(() => {
  window.openfrontDesktop = undefined;
  vi.restoreAllMocks();
});

describe("LangSelector default locale", () => {
  // The web client, and any desktop launch where Steam is absent: unchanged
  // from before the shell reported anything.
  it("uses the OS locale when the shell reports nothing", () => {
    withShellLocale(null);
    withOsLocale("et-EE");
    expect(defaultLocale()).toBe("et-EE");
  });

  // The whole point of consulting Steam: a player whose system is English but
  // whose Steam is Ukrainian gets Ukrainian.
  it("prefers a real Steam locale over the OS locale", () => {
    withShellLocale("uk");
    withOsLocale("en-GB");
    expect(defaultLocale()).toBe("uk");
  });

  // The regression this exists to fix. Steam offers ~30 UI languages and we
  // ship 40, so a player whose system is Estonian CANNOT have Estonian Steam
  // -- theirs reports English. Taking that at face value handed them English
  // and threw away the OS locale that names a language we actually ship.
  it("yields to the OS locale when Steam says English", () => {
    withShellLocale("en");
    withOsLocale("et-EE");
    expect(defaultLocale()).toBe("et-EE");
  });

  // Every language we ship that Steam has no UI language for. Each of these
  // reaches us only via the OS locale, so each is a player the unfixed
  // behaviour silently moved to English.
  it("yields for every language Steam cannot express", () => {
    for (const locale of [
      "bn",
      "ca",
      "eo",
      "et",
      "fa",
      "gl",
      "he",
      "hi",
      "mk",
      "sh",
      "sk",
      "sl",
      "tp",
    ]) {
      withShellLocale("en");
      withOsLocale(locale);
      expect(defaultLocale(), locale).toBe(locale);
    }
  });

  // Tested on the RESOLVED language, not the raw tag, so a Steam language we
  // ship no translation for is uninformative by the same path: it lands on
  // English, so the OS locale gets its turn.
  it("yields for a Steam language we ship no translation for", () => {
    withShellLocale("th");
    withOsLocale("sk-SK");
    expect(defaultLocale()).toBe("sk-SK");
  });

  // Both say English, or neither says anything useful: English either way, and
  // the OS locale is the one returned because Steam's answer was discarded.
  it("returns the OS locale when neither names a language we ship", () => {
    withShellLocale("en");
    withOsLocale("en-US");
    expect(defaultLocale()).toBe("en-US");
  });

  // The accepted imperfection, pinned so it is a decision rather than a
  // surprise: someone who genuinely wants English on a German system gets
  // German. That is what they got before the shell reported anything, and a
  // saved choice -- which outranks all of this -- settles it permanently.
  it("gives German to an English-Steam player on a German system", () => {
    withShellLocale("en");
    withOsLocale("de-DE");
    expect(defaultLocale()).toBe("de-DE");
  });
});
