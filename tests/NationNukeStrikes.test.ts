import {
  Difficulty,
  GameMode,
  HumansVsNations,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  Config,
  NukeMagnitude,
} from "@openfront/engine-lib/configuration/Config";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { NationAllianceBehavior } from "@openfront/engine/execution/nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import { NationMIRVBehavior } from "@openfront/engine/execution/nation/NationMIRVBehavior";
import { NationNukeBehavior } from "@openfront/engine/execution/nation/NationNukeBehavior";
import { AiAttackBehavior } from "@openfront/engine/execution/utils/AiAttackBehavior";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";

class RealNukeRadiusConfig extends TestConfig {
  nukeMagnitudes(unitType: UnitType): NukeMagnitude {
    return Config.prototype.nukeMagnitudes.call(this, unitType);
  }
}

const RESERVE_RATIO = 0.3;

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

/**
 * FFA on the 200x200 all-land map. The nation (with a silo and gold) owns the
 * columns left of `split`, the human the rest from `humanFrom` on, and a third
 * player a corner far from both, so nobody is a runaway leader.
 */
async function setupFront(
  difficulty: Difficulty,
  { split = 100, humanFrom = 100 } = {},
) {
  const game = await setup(
    "big_plains",
    { difficulty },
    [
      new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
      new PlayerInfo("human", PlayerType.Human, null, "human_id"),
      new PlayerInfo("other", PlayerType.Human, null, "other_id"),
    ],
    undefined,
    RealNukeRadiusConfig,
  );
  const nation = game.player("nation_id");
  const human = game.player("human_id");
  conquerRect(game, nation, 0, 0, split, 190);
  conquerRect(game, human, humanFrom, 0, 200, 190);
  conquerRect(game, game.player("other_id"), 0, 195, 10, 200);
  return { game, nation, human, nukeBehavior: nukeBehavior(game, nation) };
}

/** A nuke behavior for a nation with a silo at (5, 5) and 10M gold. */
function nukeBehavior(
  game: Game,
  nation: Player,
  seed = 2,
): NationNukeBehavior {
  nation.buildUnit(UnitType.MissileSilo, game.ref(5, 5), {});
  nation.addGold(10_000_000n);
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
    RESERVE_RATIO,
    0.2,
    allianceBehavior,
    emojiBehavior,
  );
  return new NationNukeBehavior(
    new PseudoRandom(seed),
    game,
    nation,
    attackBehavior,
    emojiBehavior,
  );
}

/** Gives the nation `spare` troops above its reserve and the human `humanTroops`. */
function setTroops(
  game: Game,
  nation: Player,
  human: Player,
  spare: number,
  humanTroops: number,
) {
  nation.addTroops(
    game.config().maxTroops(nation) * RESERVE_RATIO + spare - nation.troops(),
  );
  human.addTroops(humanTroops - human.troops());
}

function attacksOn(attacker: Player, target: Player) {
  return attacker.outgoingAttacks().filter((a) => a.target() === target);
}

describe("Nation strike nukes", () => {
  it.each([Difficulty.Hard, Difficulty.Impossible])(
    "%s: nukes a neighbor about as strong as it and attacks it the moment the bomb lands",
    async (difficulty) => {
      const { game, nation, human, nukeBehavior } =
        await setupFront(difficulty);
      setTroops(game, nation, human, 1_000_000, 1_000_000);

      nukeBehavior.maybeSendNuke();

      let landedAt: number | null = null;
      let attackedAt: number | null = null;
      for (let i = 0; i < 300 && attackedAt === null; i++) {
        const inFlight = nation.units(UnitType.AtomBomb).length;
        game.executeNextTick();
        nukeBehavior.followUpStrikes();
        if (
          landedAt === null &&
          inFlight > 0 &&
          nation.units(UnitType.AtomBomb).length === 0
        ) {
          landedAt = game.ticks();
        }
        if (attacksOn(nation, human).length > 0) attackedAt = game.ticks();
      }

      expect(landedAt).not.toBeNull();
      expect(attackedAt).not.toBeNull();
      // The attack execution starts the tick after the bomb lands
      expect(attackedAt! - landedAt!).toBeLessThanOrEqual(1);
      // The blast left the front intact
      expect(nation.sharesBorderWith(human)).toBe(true);
    },
  );

  it("Hard: doesn't attack after a bomb that SAMs shot down", async () => {
    const { game, nation, human, nukeBehavior } = await setupFront(
      Difficulty.Hard,
    );
    setTroops(game, nation, human, 1_000_000, 1_000_000);

    nukeBehavior.maybeSendNuke();
    game.executeNextTick();
    game.executeNextTick();
    const [bomb] = nation.units(UnitType.AtomBomb);
    expect(bomb).toBeDefined();
    bomb.delete();
    for (let i = 0; i < 20; i++) {
      game.executeNextTick();
      nukeBehavior.followUpStrikes();
    }

    expect(attacksOn(nation, human)).toHaveLength(0);
  });

  it("Hard: leaves a much weaker neighbor to plain attacks", async () => {
    const { game, nation, human, nukeBehavior } = await setupFront(
      Difficulty.Hard,
    );
    setTroops(game, nation, human, 1_000_000, 200_000);

    expect(nukeBehavior.findBestNukeTarget()).toBeNull();
  });

  it("Hard: doesn't strike a neighbor it couldn't follow up on", async () => {
    const { game, nation, human, nukeBehavior } = await setupFront(
      Difficulty.Hard,
    );
    // Half the human's troops is more than we could send
    setTroops(game, nation, human, 400_000, 1_000_000);

    expect(nukeBehavior.findBestNukeTarget()).toBeNull();
  });

  it.each([
    [Difficulty.Easy, false],
    [Difficulty.Medium, true],
  ])(
    "%s: nukes a neighbor about as strong as it once attacking it: %s",
    async (difficulty, strikes) => {
      const { game, nation, human, nukeBehavior } =
        await setupFront(difficulty);
      setTroops(game, nation, human, 1_000_000, 1_000_000);
      expect(nukeBehavior.findBestNukeTarget()).toBeNull();

      game.addExecution(new AttackExecution(100_000, nation, human.id()));
      game.executeNextTick();
      expect(attacksOn(nation, human)).toHaveLength(1);

      expect(nukeBehavior.findBestNukeTarget()?.id() ?? null).toBe(
        strikes ? human.id() : null,
      );
    },
  );

  it.each([Difficulty.Medium, Difficulty.Hard, Difficulty.Impossible])(
    "%s, Humans vs Nations: nukes the human fighting a teammate rather than another one",
    async (difficulty) => {
      const game = await setup(
        "big_plains",
        { difficulty, gameMode: GameMode.Team, playerTeams: HumansVsNations },
        [
          new PlayerInfo("raider", PlayerType.Human, null, "raider_id"),
          new PlayerInfo("big", PlayerType.Human, null, "big_id"),
          new PlayerInfo("bystander1", PlayerType.Human, null, "bystander1_id"),
          new PlayerInfo("bystander2", PlayerType.Human, null, "bystander2_id"),
        ],
        undefined,
        TestConfig,
        true,
        [
          new Nation(
            undefined,
            new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
          ),
          new Nation(
            undefined,
            new PlayerInfo("mate", PlayerType.Nation, null, "mate_id"),
          ),
        ],
      );
      const [nation, mate, raider, big] = [
        "nation_id",
        "mate_id",
        "raider_id",
        "big_id",
      ].map((id) => game.player(id));
      conquerRect(game, nation, 0, 0, 20, 20);
      conquerRect(game, mate, 0, 140, 60, 200);
      conquerRect(game, raider, 60, 140, 80, 200);
      conquerRect(game, big, 120, 0, 200, 120);
      conquerRect(game, game.player("bystander1_id"), 120, 140, 140, 160);
      conquerRect(game, game.player("bystander2_id"), 160, 140, 180, 160);
      mate.addTroops(100_000);
      raider.addTroops(100_000);
      big.addTroops(1_000_000);

      game.addExecution(new AttackExecution(50_000, raider, mate.id()));
      game.executeNextTick();
      expect(mate.incomingAttacks()).toHaveLength(1);

      // Any seed, so it isn't the strongest-team fallback rolling the raider
      for (let seed = 1; seed <= 8; seed++) {
        expect(
          nukeBehavior(game, nation, seed).findBestNukeTarget()?.id(),
        ).toBe(raider.id());
      }
    },
  );

  it("Impossible: the leader leaves alone a runner-up it isn't fighting", async () => {
    // Nation 60% of the land, the human 30%, with no border between them
    const { game, nation, human, nukeBehavior } = await setupFront(
      Difficulty.Impossible,
      { split: 120, humanFrom: 140 },
    );
    setTroops(game, nation, human, 1_000_000, 1_000_000);

    expect(nukeBehavior.findBestNukeTarget()).toBeNull();
  });
});

describe("Nation nuke saving", () => {
  // The 10M the nation got counts as income; a MIRV and a hydrogen bomb cost 30M
  it.each([
    [Difficulty.Hard, 0, 10_000_000n],
    [Difficulty.Hard, 3, 750_000n],
    [Difficulty.Medium, 3, 10_000_000n],
  ])(
    "%s: %i minutes in, an atom bomb that feels like 10M after many launches feels like %i",
    async (difficulty, minutes, perceived) => {
      const { game, nation, nukeBehavior } = await setupFront(difficulty);
      for (let i = 0; i < minutes * 600; i++) game.executeNextTick();
      nation.removeGold(nation.gold() - 1_000_000n);
      nukeBehavior["atomBombPerceivedCost"] = 10_000_000n;

      expect(nukeBehavior["getPerceivedNukeCost"](UnitType.AtomBomb)).toBe(
        perceived,
      );
    },
  );
});

describe("Nation rival MIRVs", () => {
  function mirvBehavior(game: Game, nation: Player) {
    nation.addGold(100_000_000n);
    return new NationMIRVBehavior(
      new PseudoRandom(1),
      game,
      nation,
      new NationEmojiBehavior(new PseudoRandom(1), game, nation),
    );
  }

  // Hesitation skips a few calls
  function considerMirv(behavior: NationMIRVBehavior): boolean {
    for (let i = 0; i < 20; i++) {
      if (behavior.considerMIRV()) return true;
    }
    return false;
  }

  it("Hard: MIRVs a neighbor about its size and attacks once the last warhead lands", async () => {
    const { game, nation, human, nukeBehavior } = await setupFront(
      Difficulty.Hard,
    );
    setTroops(game, nation, human, 1_000_000, 1_000_000);
    expect(considerMirv(mirvBehavior(game, nation))).toBe(true);

    let flying = false;
    let landedAt: number | null = null;
    let attackedAt: number | null = null;
    for (let i = 0; i < 1000 && attackedAt === null; i++) {
      game.executeNextTick();
      nukeBehavior.followUpStrikes();
      const inFlight =
        nation.units(UnitType.MIRV, UnitType.MIRVWarhead).length > 0;
      flying ||= inFlight;
      if (flying && !inFlight && landedAt === null) landedAt = game.ticks();
      if (attacksOn(nation, human).length > 0) attackedAt = game.ticks();
    }

    expect(landedAt).not.toBeNull();
    expect(attackedAt).not.toBeNull();
    expect(attackedAt! - landedAt!).toBeLessThanOrEqual(1);
  });

  it.each([
    ["Medium", Difficulty.Medium, 100],
    ["Hard, a neighbor under half its size", Difficulty.Hard, 140],
  ])("%s: holds its MIRV", async (_, difficulty, split) => {
    const { game, nation, human } = await setupFront(difficulty, {
      split,
      humanFrom: split,
    });
    setTroops(game, nation, human, 1_000_000, 1_000_000);

    expect(considerMirv(mirvBehavior(game, nation))).toBe(false);
  });
});
