import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Difficulty,
  GameMode,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  Config,
  NukeMagnitude,
} from "@openfront/engine-lib/configuration/Config";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { NationAllianceBehavior } from "@openfront/engine/execution/nation/NationAllianceBehavior";
import { NationAttackBehavior } from "@openfront/engine/execution/nation/NationAttackBehavior";
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import { NationNukeBehavior } from "@openfront/engine/execution/nation/NationNukeBehavior";
import { NationWarshipBehavior } from "@openfront/engine/execution/nation/NationWarshipBehavior";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";

class RealNukeRadiusConfig extends TestConfig {
  nukeMagnitudes(unitType: UnitType): NukeMagnitude {
    return Config.prototype.nukeMagnitudes.call(this, unitType);
  }
}

const ISLAND = { min: 130, max: 170 };

/**
 * Hard FFA on the 200x200 all-land map. The nation owns the top-left corner
 * with a silo, the human owns a 40x40 block in the bottom-right.
 */
async function setupDuel(withThirdPlayer = false) {
  const infos = [
    new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
    new PlayerInfo("human", PlayerType.Human, null, "human_id"),
  ];
  if (withThirdPlayer) {
    infos.push(new PlayerInfo("other", PlayerType.Nation, null, "other_id"));
  }
  const game = await setup(
    "big_plains",
    { difficulty: Difficulty.Hard },
    infos,
    undefined,
    RealNukeRadiusConfig,
  );
  const nation = game.player("nation_id");
  const human = game.player("human_id");

  conquerRect(game, nation, 0, 0, 15, 15);
  nation.buildUnit(UnitType.MissileSilo, game.ref(5, 5), {});
  // More than a MIRV and a hydrogen bomb cost, so it isn't saving up for one
  nation.addGold(40_000_000n);
  conquerRect(game, human, ISLAND.min, ISLAND.min, ISLAND.max, ISLAND.max);

  return { game, nation, human };
}

function conquerRect(
  game: Game,
  player: Player,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) {
      player.conquer(game.ref(x, y));
    }
  }
}

function nukeBehavior(game: Game, nation: Player): NationNukeBehavior {
  const emojiBehavior = new NationEmojiBehavior(
    new PseudoRandom(1),
    game,
    nation,
  );
  const allianceBehavior = new NationAllianceBehavior(
    new PseudoRandom(1),
    game,
    nation,
    emojiBehavior,
  );
  const attackBehavior = new NationAttackBehavior(
    new PseudoRandom(1),
    game,
    nation,
    0.5,
    0.3,
    0.2,
    allianceBehavior,
    emojiBehavior,
    new NationWarshipBehavior(new PseudoRandom(1), game, nation, emojiBehavior),
  );
  return new NationNukeBehavior(
    new PseudoRandom(2),
    game,
    nation,
    attackBehavior,
    emojiBehavior,
  );
}

function launchNukes(game: Game, nation: Player): Unit[] {
  nukeBehavior(game, nation).maybeSendNuke();
  // First tick initializes the NukeExecution, the second launches the bomb
  game.executeNextTick();
  game.executeNextTick();
  return nation.units(UnitType.AtomBomb, UnitType.HydrogenBomb);
}

function isOnIsland(game: Game, tile: TileRef): boolean {
  const [x, y] = [game.x(tile), game.y(tile)];
  return x >= ISLAND.min && x < ISLAND.max && y >= ISLAND.min && y < ISLAND.max;
}

describe("Nation nuke targeting", () => {
  it("uses an atom bomb instead of a hydrogen bomb on a small island", async () => {
    const { game, nation, human } = await setupDuel();
    game.map().forEachTile((tile) => {
      if (!game.hasOwner(tile)) game.setWater(tile);
    });

    const nukes = launchNukes(game, nation);

    expect(nukes).toHaveLength(1);
    expect(nukes[0].type()).toBe(UnitType.AtomBomb);
    expect(game.owner(nukes[0].targetTile()!)).toBe(human);
  });

  it("does not nuke land that is mostly fallout already", async () => {
    const { game, nation, human } = await setupDuel();
    // Leave the human a 4-tile rim around a fallout crater
    for (let x = ISLAND.min + 4; x < ISLAND.max - 4; x++) {
      for (let y = ISLAND.min + 4; y < ISLAND.max - 4; y++) {
        const tile = game.ref(x, y);
        human.relinquish(tile);
        game.setFallout(tile, true);
      }
    }

    expect(launchNukes(game, nation)).toHaveLength(0);
  });

  it("does not nuke a spot where another player's nuke is already landing", async () => {
    const { game, nation, human } = await setupDuel(true);
    const other = game.player("other_id");
    conquerRect(game, other, 0, 185, 15, 200);
    // Hostile, so the nation picks the human as its target among three players
    nation.updateRelation(human, -100);
    other.buildUnit(UnitType.HydrogenBomb, game.ref(5, 190), {
      targetTile: game.ref(150, 150),
      trajectory: [],
    });

    expect(launchNukes(game, nation)).toHaveLength(0);
  });

  it.each([false, true])(
    "nukes back a player whose bomb is flying at it (bomb in flight: %s)",
    async (bombInFlight) => {
      const { game, nation, human } = await setupDuel(true);
      const other = game.player("other_id");
      conquerRect(game, other, 20, 150, 60, 190);
      nation.updateRelation(other, -100);
      if (bombInFlight) {
        human.buildUnit(UnitType.HydrogenBomb, game.ref(150, 150), {
          targetTile: game.ref(5, 5),
          trajectory: [],
        });
      }

      const nukes = launchNukes(game, nation);
      expect(nukes).toHaveLength(1);
      expect(game.owner(nukes[0].targetTile()!)).toBe(
        bombInFlight ? human : other,
      );
    },
  );

  it.each([
    [false, 1],
    [true, 0],
  ])(
    "hits a third player around the target unless allied with them (allied: %s)",
    async (allied, expectedNukes) => {
      const { game, nation, human } = await setupDuel(true);
      const other = game.player("other_id");
      for (let x = 100; x < 200; x++) {
        for (let y = 100; y < 200; y++) {
          const tile = game.ref(x, y);
          if (game.owner(tile) !== human) other.conquer(tile);
        }
      }
      nation.updateRelation(human, -100);
      if (allied) nation.createAllianceRequest(other)?.accept();

      const nukes = launchNukes(game, nation);
      expect(nukes).toHaveLength(expectedNukes);
      for (const nuke of nukes) {
        expect(game.owner(nuke.targetTile()!)).toBe(human);
      }
    },
  );

  it.each(["own", "allied"])(
    "never nukes an %s enclave inside the target's land",
    async (enclave) => {
      const { game, nation, human } = await setupDuel(true);
      const other = game.player("other_id");
      conquerRect(game, other, 0, 185, 15, 200);
      nation.updateRelation(human, -100);
      if (enclave === "allied") nation.createAllianceRequest(other)?.accept();
      const enclaveOwner = enclave === "own" ? nation : other;
      conquerRect(game, enclaveOwner, 149, 149, 151, 151);

      expect(launchNukes(game, nation)).toHaveLength(0);
    },
  );

  it("nukes the same spot when no other nuke is landing there", async () => {
    const { game, nation, human } = await setupDuel(true);
    conquerRect(game, game.player("other_id"), 0, 185, 15, 200);
    nation.updateRelation(human, -100);

    const nukes = launchNukes(game, nation);
    expect(nukes).toHaveLength(1);
    expect(isOnIsland(game, nukes[0].targetTile()!)).toBe(true);
  });
});

describe("Nation nuke targets in team games", () => {
  it("Hard: nukes the most built-up player of the biggest other team", async () => {
    // Columns: our team holds half the map, the "wide"/"built" team 30%, "third" 20%
    const stripes: [string, number][] = [
      ["nation", 50],
      ["mate", 100],
      ["wide", 150],
      ["built", 160],
      ["third", 200],
    ];
    const teams: Record<string, number> = {
      nation: 0,
      mate: 0,
      wide: 1,
      built: 1,
      third: 2,
    };
    const game = await setup(
      "big_plains",
      { difficulty: Difficulty.Hard, gameMode: GameMode.Team, playerTeams: 3 },
      stripes.map(
        ([id]) =>
          new PlayerInfo(
            id,
            id === "nation" ? PlayerType.Nation : PlayerType.Human,
            null,
            id,
            false,
            null,
            [],
            teams[id],
          ),
      ),
    );
    game.map().forEachTile((tile) => {
      const [id] = stripes.find(([, end]) => game.x(tile) < end)!;
      game.player(id).conquer(tile);
    });
    const city = (id: string, x: number, level: number) => {
      const unit = game
        .player(id)
        .buildUnit(UnitType.City, game.ref(x, 10), {});
      for (let l = 1; l < level; l++) unit.increaseLevel();
    };
    city("built", 155, 2);
    // More structure levels, but on the smaller team
    city("third", 180, 5);
    const nation = game.player("nation");
    nation.setTroops(1_000_000);

    expect(nukeBehavior(game, nation).findBestNukeTarget()).toBe(
      game.player("built"),
    );
  });
});

describe("Nuke tile scores around SAMs", () => {
  // The nation's silo sits in the top-left corner, the human holds the bottom-right quarter
  async function setupScore(difficulty: Difficulty) {
    const game = await setup(
      "big_plains",
      { difficulty },
      [
        new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
        new PlayerInfo("human", PlayerType.Human, null, "human_id"),
      ],
      undefined,
      RealNukeRadiusConfig,
    );
    const nation = game.player("nation_id");
    const human = game.player("human_id");
    conquerRect(game, nation, 0, 0, 15, 15);
    nation.buildUnit(UnitType.MissileSilo, game.ref(5, 5), {});
    conquerRect(game, human, 100, 100, 200, 200);
    const score = (
      tile: TileRef,
      nukeType: UnitType.AtomBomb | UnitType.HydrogenBomb,
    ): number =>
      nukeBehavior(game, nation)["nukeTileScore"](
        tile,
        nation.units(UnitType.MissileSilo),
        human.units(),
        nukeType,
      );
    return { game, human, score };
  }

  it("Medium won't nuke a city within 50 tiles of a SAM", async () => {
    const { game, human, score } = await setupScore(Difficulty.Medium);
    const target = game.ref(120, 120);
    human.buildUnit(UnitType.City, target, {});
    expect(score(target, UnitType.AtomBomb)).toBeGreaterThan(0);

    human.buildUnit(UnitType.SAMLauncher, game.ref(190, 190), {});
    expect(score(target, UnitType.AtomBomb)).toBeGreaterThan(0);
    human.buildUnit(UnitType.SAMLauncher, game.ref(130, 120), {});
    expect(score(target, UnitType.AtomBomb)).toBe(-1);
  });

  // The test config gives SAMs a 20-tile range, a hydrogen bomb blasts 100 tiles wide
  it.each([
    [1, 50, true],
    [1, 10, false],
    [5, 50, false],
  ])(
    "Impossible values a hydrogen bomb on a level %i SAM %i tiles away: %s",
    async (level, distance, valued) => {
      const { game, human, score } = await setupScore(Difficulty.Impossible);
      const sam = human.buildUnit(
        UnitType.SAMLauncher,
        game.ref(130 + distance, 150),
        {},
      );
      for (let l = 1; l < level; l++) sam.increaseLevel();
      const value = score(game.ref(130, 150), UnitType.HydrogenBomb);
      if (valued) {
        expect(value).toBeGreaterThan(0);
      } else {
        expect(value).toBeLessThanOrEqual(0);
      }
    },
  );
});
