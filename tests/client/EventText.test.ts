import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { eventText } from "../../src/client/hud/layers/EventText";

describe("eventText", () => {
  let langSelector: HTMLElement;

  function useLanguage(
    currentLang: string,
    translations: Record<string, string>,
  ) {
    Object.assign(langSelector, { currentLang, translations });
  }

  beforeEach(() => {
    langSelector = document.createElement("lang-selector");
    document.body.appendChild(langSelector);
  });

  afterEach(() => {
    langSelector.remove();
  });

  it("marks only the values it is asked to", () => {
    useLanguage("en", {
      status: "{name} {status} your alliance request",
    });

    expect(
      eventText("status", { name: "Bob", status: "accepted" }, ["name"]),
    ).toEqual([
      { text: "Bob", strong: true },
      { text: " accepted your alliance request", strong: false },
    ]);
  });

  it("marks two values where the translation puts them", () => {
    useLanguage("en", {
      request: "{name} requests you attack {target}",
    });

    expect(
      eventText("request", { name: "Ann", target: "Bob" }, ["name", "target"]),
    ).toEqual([
      { text: "Ann", strong: true },
      { text: " requests you attack ", strong: false },
      { text: "Bob", strong: true },
    ]);
  });

  it("keeps the translation's order", () => {
    useLanguage("de", {
      gold: "Gold erhalten von {name}: {gold}",
    });

    expect(
      eventText("gold", { gold: "1.2K", name: "Ann" }, ["gold", "name"]),
    ).toEqual([
      { text: "Gold erhalten von ", strong: false },
      { text: "Ann", strong: true },
      { text: ": ", strong: false },
      { text: "1.2K", strong: true },
    ]);
  });

  it("marks a value that is also a word of the sentence only where it was filled in", () => {
    useLanguage("en", {
      gold: "Received {gold} gold from {name}",
    });

    expect(
      eventText("gold", { gold: "5K", name: "gold" }, ["gold", "name"]),
    ).toEqual([
      { text: "Received ", strong: false },
      { text: "5K", strong: true },
      { text: " gold from ", strong: false },
      { text: "gold", strong: true },
    ]);
  });

  it("works in a language without spaces", () => {
    useLanguage("ja", {
      request: "{name}が{target}への攻撃を求めています",
    });

    expect(
      eventText("request", { name: "太郎", target: "花子" }, [
        "name",
        "target",
      ]),
    ).toEqual([
      { text: "太郎", strong: true },
      { text: "が", strong: false },
      { text: "花子", strong: true },
      { text: "への攻撃を求めています", strong: false },
    ]);
  });

  it("leaves a number unmarked, so its plural still works", () => {
    useLanguage("en", {
      bombs: "{name} - {count, plural, one {# atom bomb} other {# atom bombs}}",
    });

    expect(
      eventText("bombs", { name: "Ann", count: 3 }, ["name", "count"]),
    ).toEqual([
      { text: "Ann", strong: true },
      { text: " - 3 atom bombs", strong: false },
    ]);
  });

  it("is not thrown off by a value holding the marker characters", () => {
    useLanguage("en", {
      betrayed: "{name} broke their alliance with you",
    });

    expect(eventText("betrayed", { name: "Eve" }, ["name"])).toEqual([
      { text: "Eve", strong: true },
      { text: " broke their alliance with you", strong: false },
    ]);
  });

  it("marks an emoji as an emoji, where the translation puts it", () => {
    useLanguage("de", {
      sent: "{emoji} an {name} gesendet",
    });

    expect(
      eventText("sent", { name: "Ann", emoji: "😀" }, ["name"], "emoji"),
    ).toEqual([
      { text: "😀", strong: false, emoji: true },
      { text: " an ", strong: false },
      { text: "Ann", strong: true },
      { text: " gesendet", strong: false },
    ]);
  });

  it("returns the key as one plain part when it has no translation", () => {
    useLanguage("en", {});

    expect(
      eventText("events_display.missing", { name: "Ann" }, ["name"]),
    ).toEqual([{ text: "events_display.missing", strong: false }]);
  });

  it("does not break the debug language", () => {
    useLanguage("debug", {});

    const parts = eventText("events_display.betrayed_you", { name: "Ann" }, [
      "name",
    ]);

    expect(parts.map((part) => part.text).join("")).toBe(
      "events_display.betrayed_you::name=Ann",
    );
    expect(parts.filter((part) => part.strong)).toEqual([
      { text: "Ann", strong: true },
    ]);
  });
});
