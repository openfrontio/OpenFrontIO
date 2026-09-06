import { describe, expect, it } from "vitest";
import {
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import {
  BASE_RESEARCH_COST,
  researchBonusBasisPoints,
  researchFirstLevelBasisPoints,
  researchProductionBasisPoints,
  researchRequirement,
  ResearchType,
} from "../../../src/core/game/Research";
import { setup } from "../../util/Setup";

async function playerOfType(type: PlayerType, id: string) {
  const info = new PlayerInfo(id, type, null, id);
  const game = await setup("ocean_and_land", {}, [info]);
  const player = game.player(info.id)!;
  for (let tile = 0; tile < game.width() * game.height(); tile++) {
    if (game.isLand(tile) && !game.isImpassable(tile)) {
      player.conquer(tile);
      return { game, player, tile };
    }
  }
  throw new Error("test map has no buildable land");
}

async function human(id = "researcher") {
  return playerOfType(PlayerType.Human, id);
}

function tickResearch(player: Player, ticks: number): void {
  for (let i = 0; i < ticks; i++) player.research().tick();
}

describe("research", () => {
  it("generates one point per completed facility level per second", async () => {
    const { player, tile } = await human();
    const facility = player.buildUnit(UnitType.ResearchFacility, tile, {});

    tickResearch(player, 9);
    expect(player.research().points()).toBe(0n);
    tickResearch(player, 1);
    expect(player.research().points()).toBe(1n);

    facility.increaseLevel();
    tickResearch(player, 10);
    expect(player.research().points()).toBe(3n);
  });

  it("does not generate points while a facility is under construction", async () => {
    const { player, tile } = await human();
    const facility = player.buildUnit(UnitType.ResearchFacility, tile, {});
    facility.setUnderConstruction(true);

    tickResearch(player, 20);
    expect(player.research().points()).toBe(0n);

    facility.setUnderConstruction(false);
    tickResearch(player, 10);
    expect(player.research().points()).toBe(1n);
  });

  it("purchases one level using the authoritative current price", async () => {
    const { player, tile } = await human();
    player.buildUnit(UnitType.ResearchFacility, tile, {});
    tickResearch(player, 250);

    expect(player.research().points()).toBe(25n);
    expect(player.research().purchase(ResearchType.Economy)).toBe(true);
    expect(player.researchLevel(ResearchType.Economy)).toBe(1);
    expect(player.research().points()).toBe(0n);
    expect(player.research().purchase(ResearchType.Economy)).toBe(false);
    expect(player.researchLevel(ResearchType.Economy)).toBe(1);
  });

  it("applies fractional Scientific production without losing remainder", async () => {
    const { player, tile } = await human();
    player.buildUnit(UnitType.ResearchFacility, tile, {});
    tickResearch(player, 250);
    expect(player.research().purchase(ResearchType.Scientific)).toBe(true);

    tickResearch(player, 400);
    expect(player.research().points()).toBe(41n);
  });

  it("moves future production on capture while keeping earned points", async () => {
    const firstInfo = new PlayerInfo("first", PlayerType.Human, null, "first");
    const secondInfo = new PlayerInfo(
      "second",
      PlayerType.Human,
      null,
      "second",
    );
    const game = await setup("ocean_and_land", {}, [firstInfo, secondInfo]);
    const first = game.player(firstInfo.id)!;
    const second = game.player(secondInfo.id)!;
    const tiles = Array.from(
      { length: game.width() * game.height() },
      (_, tile) => tile,
    ).filter((tile) => game.isLand(tile) && !game.isImpassable(tile));
    first.conquer(tiles[0]);
    second.conquer(tiles[tiles.length - 1]);
    const facility = first.buildUnit(UnitType.ResearchFacility, tiles[0], {});

    tickResearch(first, 10);
    second.captureUnit(facility);
    tickResearch(first, 10);
    tickResearch(second, 10);

    expect(first.research().points()).toBe(1n);
    expect(second.research().points()).toBe(1n);
  });

  it("excludes tribe bots from production and purchases", async () => {
    const { player, tile } = await playerOfType(
      PlayerType.Bot,
      "tribe_researcher",
    );
    player.buildUnit(UnitType.ResearchFacility, tile, {});
    tickResearch(player, 1_000);

    expect(player.research().points()).toBe(0n);
    expect(player.research().purchase(ResearchType.Military)).toBe(false);
  });

  it("uses compact escalating prices and reduced diminishing bonuses", () => {
    expect(researchRequirement(BASE_RESEARCH_COST, 0)).toBe(25n);
    expect(researchRequirement(BASE_RESEARCH_COST, 1)).toBe(32n);
    expect(researchRequirement(BASE_RESEARCH_COST, 2)).toBe(40n);
    expect(researchFirstLevelBasisPoints(ResearchType.PopulationDensity)).toBe(
      500,
    );
    expect(researchFirstLevelBasisPoints(ResearchType.Economy)).toBe(250);
    expect(researchBonusBasisPoints(2, 250)).toBe(495);
    expect(researchProductionBasisPoints(2, 1)).toBe(20_500n);
  });

  it("includes fractional production in deterministic hashes", async () => {
    const { player, tile } = await human();
    player.buildUnit(UnitType.ResearchFacility, tile, {});
    const before = player.research().hash();
    player.research().tick();
    expect(player.research().hash()).not.toBe(before);
  });
});
