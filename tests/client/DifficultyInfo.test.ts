import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../resources/lang/en.json";
import {
  DIFFICULTY_TROOP_PERCENT,
  DifficultyInfo,
} from "../../src/client/components/DifficultyInfo";
import { Difficulty, PlayerType } from "../../src/core/game/Game";
import { playerInfo, setup } from "../util/Setup";

const DIFFICULTIES = [
  Difficulty.Easy,
  Difficulty.Medium,
  Difficulty.Hard,
  Difficulty.Impossible,
];

/** What the bubble should read, composed from en.json the way the UI does. */
function expectedText(difficulty: Difficulty): string {
  const d = en.difficulty as Record<string, string>;
  const percent = DIFFICULTY_TROOP_PERCENT[difficulty];
  const troops =
    percent === 100
      ? d.info_troops_same
      : d.info_troops.replace("{percent}", String(percent));
  const main = d.info
    .replace("{smarts}", d[`info_smarts_${difficulty.toLowerCase()}`])
    .replace("{troops}", troops);
  const note = d[`info_note_${difficulty.toLowerCase()}`];
  return note === undefined ? main : `${main} ${note}`;
}

describe("DIFFICULTY_TROOP_PERCENT", () => {
  it.each(DIFFICULTIES)("matches the simulation on %s", async (difficulty) => {
    const game = await setup("plains", { difficulty });
    const human = game.addPlayer(playerInfo("human", PlayerType.Human));
    const nation = game.addPlayer(playerInfo("nation", PlayerType.Nation));
    const percent = DIFFICULTY_TROOP_PERCENT[difficulty];

    const startRatio = nation.troops() / human.troops();
    const capRatio =
      game.config().maxTroops(nation) / game.config().maxTroops(human);

    expect(startRatio * 100).toBeCloseTo(percent);
    expect(capRatio * 100).toBeCloseTo(percent);
  });
});

describe("<difficulty-info>", () => {
  let info: DifficultyInfo | undefined;
  let languageFixture: HTMLElement | undefined;

  afterEach(() => {
    info?.remove();
    languageFixture?.remove();
    info = undefined;
    languageFixture = undefined;
  });

  function installTranslations() {
    const translations = Object.fromEntries(
      Object.entries(en.difficulty).map(([key, value]) => [
        `difficulty.${key}`,
        value,
      ]),
    );
    languageFixture = document.createElement("lang-selector");
    Object.assign(languageFixture, {
      translations,
      defaultTranslations: translations,
      currentLang: "en",
    });
    document.body.appendChild(languageFixture);
  }

  async function createInfo(difficultyKey: string) {
    installTranslations();
    info = document.createElement("difficulty-info") as DifficultyInfo;
    info.difficultyKey = difficultyKey;
    document.body.appendChild(info);
    await info.updateComplete;
    return info;
  }

  it.each(DIFFICULTIES)(
    "sums up the nation in a bubble on %s",
    async (difficulty) => {
      const el = await createInfo(difficulty);
      const text = el
        .querySelector('[role="tooltip"]')
        ?.textContent?.trim()
        .replace(/\s+/g, " ");

      expect(el.querySelector("button")).toBeTruthy();
      expect(text).toBe(expectedText(difficulty));
    },
  );

  // Hard nations get a human's troop cap exactly, so it reads as "the same"
  // rather than "100%"; the public-game difficulties say so (MapPlaylist hosts
  // HvN on Hard and everything else on Medium).
  it("words Hard as matching humans and flags the public difficulties", () => {
    expect(expectedText(Difficulty.Hard)).not.toContain("%");
    expect(expectedText(Difficulty.Hard)).toContain("HvN");
    expect(expectedText(Difficulty.Medium)).toContain("FFA");
    expect(expectedText(Difficulty.Easy)).not.toContain("public");
    expect(expectedText(Difficulty.Impossible)).not.toContain("public");
  });

  // The bubble's text comes from translateText() at render time, and the
  // element's only property never changes -- so nothing re-renders it once the
  // language files finish loading. LangSelector.applyTranslation() has to
  // requestUpdate() it by tag, or it keeps showing raw keys (as <cosmetic-info>
  // does for the same reason).
  it("recovers from rendering before the translations loaded", async () => {
    info = document.createElement("difficulty-info") as DifficultyInfo;
    info.difficultyKey = Difficulty.Easy;
    document.body.appendChild(info);
    await info.updateComplete;
    expect(info.querySelector('[role="tooltip"]')?.textContent?.trim()).toBe(
      "difficulty.info",
    );

    installTranslations();
    info.requestUpdate();
    await info.updateComplete;

    expect(info.querySelector('[role="tooltip"]')?.textContent?.trim()).toBe(
      "Dumb, 50% of a human's max troops",
    );
  });

  it("is registered for re-translation in LangSelector", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "..", "src", "client", "LangSelector.ts"),
      "utf8",
    );
    expect(source).toContain('"difficulty-info",');
  });

  it("keeps the badge hidden until the card is hovered", async () => {
    const el = await createInfo(Difficulty.Easy);
    const badge = el.querySelector("button")!;

    expect(badge.className).toContain("opacity-0");
    expect(badge.className).toContain(
      "group-hover/difficulty-card:opacity-100",
    );
  });

  // The card's DISABLED_CARD styling sits on its <button>, and the badge is a
  // sibling of it -- so a badge left rendered would be the one crisp, clickable
  // thing on a card that is greyed out as unavailable.
  it("renders nothing while the card is disabled", async () => {
    const el = await createInfo(Difficulty.Easy);
    expect(el.querySelector("button")).toBeTruthy();

    el.disabled = true;
    await el.updateComplete;

    expect(el.querySelector("button")).toBeNull();
    expect(el.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("renders nothing for an unknown difficulty", async () => {
    const el = await createInfo("Nightmare");
    expect(el.querySelector("button")).toBeNull();
  });
});
