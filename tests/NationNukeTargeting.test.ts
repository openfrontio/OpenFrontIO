import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Difficulty,
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
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import { NationNukeBehavior } from "@openfront/engine/execution/nation/NationNukeBehavior";
import { AiAttackBehavior } from "@openfront/engine/execution/utils/AiAttackBehavior";
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
  nation.addGold(10_000_000n);
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

function launchNukes(game: Game, nation: Player): Unit[] {
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
  const attackBehavior = new AiAttackBehavior(
    new PseudoRandom(1),
    game,
    nation,
    0.5,
    0.3,
    0.2,
    allianceBehavior,
    emojiBehavior,
  );
  new NationNukeBehavior(
    // Seed 2 doesn't roll a hydro-only nation
    new PseudoRandom(2),
    game,
    nation,
    attackBehavior,
    emojiBehavior,
  ).maybeSendNuke();
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
