import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type PlayerInfo,
  RankType,
} from "../../src/client/components/baseComponents/ranking/GameInfoRanking";
import { PlayerRow } from "../../src/client/components/baseComponents/ranking/PlayerRow";

const basePlayer: PlayerInfo = {
  id: "player-1",
  username: "Ada Lovelace",
  clanTag: null,
  gold: [],
  conquests: [],
  winner: false,
  atoms: 0,
  hydros: 0,
  mirv: 0,
};

type RowOptions = {
  player?: Partial<PlayerInfo>;
  rankType?: RankType;
  score?: number;
  bestScore?: number;
};

async function mountRow({
  player = {},
  rankType = RankType.Lifetime,
  score = 100,
  bestScore = 100,
}: RowOptions = {}): Promise<PlayerRow> {
  const row = document.createElement("player-row") as PlayerRow;
  row.player = { ...basePlayer, ...player };
  row.rankType = rankType;
  row.score = score;
  row.bestScore = bestScore;
  document.body.appendChild(row);
  await row.updateComplete;
  return row;
}

describe("PlayerRow", () => {
  let row: PlayerRow | null = null;

  beforeAll(() => {
    if (!customElements.get("player-row")) {
      customElements.define("player-row", PlayerRow);
    }
  });

  beforeEach(() => {
    window.BOOTSTRAP_CONFIG = undefined;
  });

  afterEach(() => {
    row?.remove();
    window.BOOTSTRAP_CONFIG = undefined;
  });

  it("resolves a valid flag through the asset manifest", async () => {
    window.BOOTSTRAP_CONFIG = {
      assetManifest: {
        "flags/test.svg": "/_assets/flags/test.abc123.svg",
      },
      cdnBase: "https://cdn.example.test/game-assets",
    };

    row = await mountRow({ player: { flag: "/flags/test.svg" } });

    const flag = row.querySelector<HTMLImageElement>(
      '[data-player-avatar="flag"]',
    );
    expect(flag?.getAttribute("src")).toBe(
      "https://cdn.example.test/game-assets/_assets/flags/test.abc123.svg",
    );
    expect(row.querySelector('[data-player-avatar="fallback"]')).toBeNull();
  });

  it("replaces a failed flag with the player's initials", async () => {
    row = await mountRow({
      player: { username: "  alice wonder  ", flag: "/flags/missing.svg" },
    });

    row
      .querySelector<HTMLImageElement>('[data-player-avatar="flag"]')!
      .dispatchEvent(new Event("error"));
    await row.updateComplete;

    expect(row.querySelector('[data-player-avatar="flag"]')).toBeNull();
    expect(
      row.querySelector('[data-player-avatar="fallback"]')?.textContent?.trim(),
    ).toBe("AL");
  });

  it("uses the initials fallback for an invalid asset path", async () => {
    row = await mountRow({ player: { flag: "../invalid.svg" } });

    expect(row.querySelector('[data-player-avatar="flag"]')).toBeNull();
    expect(
      row.querySelector('[data-player-avatar="fallback"]')?.textContent?.trim(),
    ).toBe("AD");
  });

  it("renders the clan tag inline before the username", async () => {
    row = await mountRow({
      player: { clanTag: "UN", username: "kazz" },
    });

    const identity = row.querySelector("[data-player-identity]")!;
    const clanTag = row.querySelector("[data-player-clan-tag]")!;
    const username = row.querySelector("[data-player-name]")!;

    expect(identity.children[0]).toBe(clanTag);
    expect(identity.children[1]).toBe(username);
    expect(clanTag.textContent?.trim()).toBe("UN");
    expect(username.textContent?.trim()).toBe("kazz");
  });

  it("preserves an eliminated player's flag and adds eliminated status", async () => {
    row = await mountRow({
      player: { flag: "/flags/test.svg", killedAt: 42 },
    });

    expect(row.querySelector('[data-player-avatar="flag"]')).not.toBeNull();
    expect(
      row.querySelector('[data-player-status="eliminated"]')?.textContent,
    ).toContain("💀");
  });

  it("treats killedAt zero as eliminated while leaving absent values active", async () => {
    row = await mountRow({ player: { killedAt: 0 } });

    expect(
      row.querySelector('[data-player-status="eliminated"]'),
    ).not.toBeNull();

    row.player = { ...basePlayer };
    await row.updateComplete;

    expect(row.querySelector('[data-player-status="eliminated"]')).toBeNull();
  });

  it("shows the winner crown instead of eliminated status", async () => {
    row = await mountRow({
      player: { winner: true, killedAt: 42 },
    });

    expect(row.querySelector('[data-player-status="winner"]')).not.toBeNull();
    expect(row.querySelector('[data-player-status="eliminated"]')).toBeNull();
  });

  it("displays lifetime scores as rounded percentages", async () => {
    row = await mountRow({
      rankType: RankType.Lifetime,
      score: 87.6,
      bestScore: 100,
    });

    expect(row.textContent).toContain("88%");
    const progress = row.querySelector('[role="progressbar"]');
    expect(progress?.getAttribute("aria-valuenow")).toBe("87.6");
    expect(progress?.getAttribute("aria-valuetext")).toBe("88%");
    expect(progress?.getAttribute("aria-label")).toContain("Ada Lovelace");
    const score = row.querySelector("[data-player-score]")!;
    expect(score.classList.contains("border")).toBe(false);
    expect(score.classList.contains("rounded-lg")).toBe(false);
    expect(score.classList.contains("text-sm")).toBe(true);
    expect(score.classList.contains("text-white/75")).toBe(true);
  });

  it.each([
    RankType.ConquestHumans,
    RankType.ConquestNations,
    RankType.ConquestBots,
  ])("renders %s with the plain metric typography", async (rankType) => {
    row = await mountRow({ rankType, score: 7 });

    const score = row.querySelector("[data-player-score]")!;
    expect(score.textContent?.trim()).toBe("7");
    expect(score.classList.contains("border")).toBe(false);
    expect(score.classList.contains("text-sm")).toBe(true);
    expect(score.classList.contains("font-mono")).toBe(true);
  });

  it("uses the same typography for kill, bomb, and economy values", async () => {
    const sharedClasses = ["text-sm", "font-mono", "font-bold", "tabular-nums"];
    const rankTypes = [
      RankType.ConquestHumans,
      RankType.Atoms,
      RankType.TotalGold,
    ];

    for (const rankType of rankTypes) {
      row?.remove();
      row = await mountRow({ rankType, score: 7 });
      const score = row.querySelector("[data-player-score]")!;
      expect(
        sharedClasses.every((name) => score.classList.contains(name)),
      ).toBe(true);
    }
  });

  it("shows only the selected bomb metric", async () => {
    row = await mountRow({
      player: { atoms: 11, hydros: 22, mirv: 33 },
      rankType: RankType.Hydros,
      score: 22,
    });

    const scores = row.querySelectorAll("[data-player-score]");
    expect(scores).toHaveLength(1);
    expect(scores[0].textContent?.trim()).toBe("22");
    expect(scores[0].getAttribute("aria-label")).toContain(
      "game_info_modal.hydros",
    );
    expect(scores[0].textContent).not.toContain("11");
    expect(scores[0].textContent).not.toContain("33");
    expect(scores[0].classList.contains("border")).toBe(false);
  });

  it("renders economy values without a surrounding card", async () => {
    row = await mountRow({ rankType: RankType.TotalGold, score: 12_345 });

    const score = row.querySelector("[data-player-score]")!;
    expect(score.textContent).toContain("12.3K");
    expect(score.classList.contains("border")).toBe(false);
    expect(score.classList.contains("rounded-lg")).toBe(false);
    const coin = score.querySelector("img")!;
    expect(coin.getAttribute("src")).toContain("GoldCoinIcon.svg");
    expect(coin.getAttribute("width")).toBe("18");
    expect(coin.getAttribute("height")).toBe("18");
  });

  it.each([RankType.TrainTrade, RankType.NavalTrade])(
    "shows one selected trade score for %s",
    async (rankType) => {
      row = await mountRow({ rankType, score: 12_345 });

      const scores = row.querySelectorAll("[data-player-score]");
      expect(scores).toHaveLength(1);
      expect(scores[0].textContent).toContain("12.3K");
      expect(scores[0].getAttribute("aria-label")).toContain(
        rankType === RankType.TrainTrade
          ? "game_info_modal.train_trade"
          : "game_info_modal.naval_trade",
      );
    },
  );

  it.each([RankType.Atoms, RankType.Hydros, RankType.MIRV])(
    "labels the selected bomb score for %s",
    async (rankType) => {
      row = await mountRow({ rankType, score: 7 });

      expect(
        row.querySelector("[data-player-score]")?.getAttribute("aria-label"),
      ).toContain(`game_info_modal.${rankType.toLowerCase()}`);
    },
  );
});
