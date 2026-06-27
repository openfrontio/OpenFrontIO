import { AttackExecution } from "../src/core/execution/AttackExecution";
import { NationAllianceBehavior } from "../src/core/execution/nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import {
  Difficulty,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Conquer a rectangular region of land tiles for `player`. Skips water. */
function conquerRect(
  game: Game,
  player: Player,
  x0: number,
  y0: number,
  x1: number, // exclusive
  y1: number, // exclusive
) {
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) {
      const tile = game.ref(x, y);
      if (game.map().isLand(tile)) player.conquer(tile);
    }
  }
}

/**
 * Mark a rectangular region of unowned land as nuked (fallout).
 * `setFallout` throws on owned tiles, so already-conquered tiles are
 * naturally skipped.
 */
function nukeRect(game: Game, x0: number, y0: number, x1: number, y1: number) {
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) {
      const tile = game.ref(x, y);
      if (game.map().isLand(tile) && !game.hasOwner(tile)) {
        game.setFallout(tile, true);
      }
    }
  }
}

interface BehaviorEnv {
  game: Game;
  nation: Player;
  enemy: Player;
  attackBehavior: AiAttackBehavior;
}

/**
 * Build a nation surrounded by nuked TerraNullius, optionally with an enemy
 * sharing a land border on the west.
 *
 *   big_plains (200×200, all land).
 *
 *     ┌────────────────────────────────────┐
 *     │         NUKED TN (ring)             │
 *     │ ┌────────┐ ┌───────┐  ┌──────────┐ │
 *     │ │ ENEMY   │ │ NATION │  │ NUKED TN │ │
 *     │ │40..60   │ │60..80 │  │ 80..120  │ │
 *     │ └────────┘ └───────┘  └──────────┘ │
 *     │         NUKED TN (ring)            │
 *     └────────────────────────────────────┘
 *    x=40       x=60   x=80               x=120   (y from 40..100)
 *
 *  - Nation:  x∈[60,80), y∈[60,80)
 *  - Enemy:   x∈[40,60), y∈[60,80)  → shares a land border with the nation
 *  - Nuked TN ring: every other unowned tile in x∈[40,120), y∈[40,100)
 *
 * Layout invariants (asserted below):
 *  - With `withNuke`: every exposed nation border is nuked TN (no non-nuked TN).
 *  - With `withEnemy`: the nation's ONLY non-nuked border is the enemy.
 */
async function setupBehavior(
  difficulty: Difficulty = Difficulty.Impossible,
  opts: {
    withEnemy?: boolean;
    withNuke?: boolean;
    nationTroops?: number;
    enemyTroops?: number;
    disabledUnits?: UnitType[];
  } = {},
): Promise<BehaviorEnv> {
  const withEnemy = opts.withEnemy ?? true;
  const withNuke = opts.withNuke ?? true;
  const nationTroops = opts.nationTroops ?? 5_000_000;
  const enemyTroops = opts.enemyTroops ?? 50_000;

  const game = await setup(
    "big_plains",
    {
      difficulty,
      infiniteGold: true,
      instantBuild: true,
      infiniteTroops: true,
      ...(opts.disabledUnits ? { disabledUnits: opts.disabledUnits } : {}),
    },
    [
      new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
      new PlayerInfo("enemy", PlayerType.Human, null, "enemy_id"),
    ],
  );

  const nation = game.player("nation_id");
  const enemy = game.player("enemy_id");

  conquerRect(game, nation, 60, 60, 80, 80);
  if (withEnemy) conquerRect(game, enemy, 40, 60, 60, 80);
  if (withNuke) nukeRect(game, 40, 40, 120, 100);

  nation.addTroops(nationTroops);
  enemy.addTroops(enemyTroops);

  // Layout invariants.
  expect(nation.tiles().size).toBeGreaterThan(0);
  if (withNuke) {
    const bordersNuked = Array.from(nation.borderTiles()).some((t) =>
      game
        .neighbors(t)
        .some((n) => game.isLand(n) && !game.hasOwner(n) && game.hasFallout(n)),
    );
    expect(bordersNuked).toBe(true);

    // No non-nuked TN borders the nation (its only non-nuked neighbour is
    // the enemy, when present).
    const bordersNonNukedTN = Array.from(nation.borderTiles()).some((t) =>
      game
        .neighbors(t)
        .some(
          (n) => game.isLand(n) && !game.hasOwner(n) && !game.hasFallout(n),
        ),
    );
    expect(bordersNonNukedTN).toBe(false);
  }
  if (withEnemy) {
    expect(nation.sharesBorderWith(enemy)).toBe(true);
  }

  const emojiBehavior = new NationEmojiBehavior(
    new PseudoRandom(42),
    game,
    nation,
  );
  const allianceBehavior = new NationAllianceBehavior(
    new PseudoRandom(42),
    game,
    nation,
    emojiBehavior,
  );
  const attackBehavior = new AiAttackBehavior(
    new PseudoRandom(42),
    game,
    nation,
    0.0, // triggerRatio — always ready so strategy selection is deterministic
    0.0, // reserveRatio
    0.0, // expandRatio
    allianceBehavior,
    emojiBehavior,
  );

  return { game, nation, enemy, attackBehavior };
}

/** Count new outgoing attacks created since `before`. */
function newAttacks(player: Player, before: number) {
  return player.outgoingAttacks().slice(before);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AiAttackBehavior - nuked territory early-out", () => {
  // The bug: `maybeAttack()` has an early expansion gate
  //   hasNonNukedTerraNullius =
  //     border.some((t) => !hasOwner(t) && !hasFallout(t)) ||
  //     playerNeighbors.some((n) => !n.isPlayer());
  // The second disjunct uses `nearby()`, whose direct-neighbor loop did NOT
  // filter fallout — so a nation bordering *nuked* TerraNullius reported it
  // as a plain TerraNullius neighbour, making the gate fire and dispatch
  // `sendAttack(terraNullius())` *before* any attack strategy
  // (retaliate/bots/...) could run.  The fix: `nearby()`'s direct-neighbor
  // loop now skips nuked (fallout) unowned tiles, matching
  // `shoreReachableNeighbors()`.

  describe("regression: early gate no longer fires on nuked-only borders", () => {
    test("nearby() excludes directly-adjacent nuked TerraNullius", async () => {
      const { game, nation } = await setupBehavior(Difficulty.Impossible, {
        withEnemy: false,
      });

      // Sanity: the nation really borders nuked land.
      const bordersNuked = Array.from(nation.borderTiles()).some((t) =>
        game
          .neighbors(t)
          .some(
            (n) => game.isLand(n) && !game.hasOwner(n) && game.hasFallout(n),
          ),
      );
      expect(bordersNuked).toBe(true);

      // nearby() must NOT report TerraNullius (it's all nuked), and with no
      // enemy there are no player neighbours either.
      const nearby = nation.nearby();
      expect(nearby.some((n) => !n.isPlayer())).toBe(false);
      expect(nearby.filter((n) => n.isPlayer())).toHaveLength(0);
    });

    test("maybeAttack does NOT pre-empt retaliation with a nuked-TN attack", async () => {
      // Nation borders nuked TN (east/north/south) and an enemy (west). The
      // enemy attacks the nation. On Impossible `retaliate` is the first
      // strategy, but with the bug the early gate fires first and attacks
      // TerraNullius, so retaliation never runs.
      //
      // The nation has far more troops than the enemy so `retaliate`'s
      // attack is not rejected as "too weak".
      const { game, nation, enemy, attackBehavior } = await setupBehavior(
        Difficulty.Impossible,
        { withEnemy: true, nationTroops: 5_000_000, enemyTroops: 50_000 },
      );

      // Enemy launches an attack on the nation.
      game.addExecution(new AttackExecution(100_000, enemy, nation.id()));
      executeTicks(game, 1);
      expect(nation.incomingAttacks().length).toBeGreaterThan(0);

      const before = nation.outgoingAttacks().length;
      attackBehavior.maybeAttack();
      executeTicks(game, 1);

      const attacks = newAttacks(nation, before);
      expect(attacks.length).toBeGreaterThan(0);
      // Every new attack must target the enemy (retaliation), NOT
      // TerraNullius (the nuked territory).
      for (const attack of attacks) {
        expect(attack.target()).toBe(enemy);
      }
    });

    test("maybeAttack early gate is bypassed when only nuked TN borders the nation", async () => {
      // No enemy, no incoming attack. The early gate must NOT fire (there is
      // no non-nuked TN). `attackBestTarget` falls through to the `nuked`
      // strategy, which dispatches a land attack on TerraNullius — the
      // intended behaviour from commit 58ec8b280.
      const { game, nation, attackBehavior } = await setupBehavior(
        Difficulty.Impossible,
        { withEnemy: false },
      );

      expect(nation.incomingAttacks()).toHaveLength(0);

      const before = nation.outgoingAttacks().length;
      attackBehavior.maybeAttack();
      executeTicks(game, 1);

      const attacks = newAttacks(nation, before);
      expect(attacks.length).toBeGreaterThan(0);
      for (const attack of attacks) {
        expect(attack.target().isPlayer()).toBe(false);
      }
    });
  });

  describe("intended: nations still capture nuked territory when idle", () => {
    test("`nuked` strategy captures tiles when the nation has nothing better to do", async () => {
      const { game, nation, attackBehavior } = await setupBehavior(
        Difficulty.Impossible,
        { withEnemy: false },
      );

      const before = nation.outgoingAttacks().length;
      attackBehavior.maybeAttack();
      executeTicks(game, 1);

      const attacks = newAttacks(nation, before);
      expect(attacks.length).toBeGreaterThan(0);
      for (const attack of attacks) {
        expect(attack.target().isPlayer()).toBe(false);
      }

      // Let the AttackExecution make progress. The nation should conquer at
      // least one previously-nuked tile east of its territory (x >= 80).
      executeTicks(game, 60);
      const conqueredEast = Array.from(nation.tiles()).filter((t) => {
        return game.x(t) >= 80 && game.y(t) >= 60 && game.y(t) < 100;
      }).length;
      expect(conqueredEast).toBeGreaterThan(0);
    });

    test("Easy difficulty: `nuked` strategy still fires when idle", async () => {
      const { game, nation, attackBehavior } = await setupBehavior(
        Difficulty.Easy,
        { withEnemy: false },
      );

      const before = nation.outgoingAttacks().length;
      attackBehavior.maybeAttack();
      executeTicks(game, 1);

      const attacks = newAttacks(nation, before);
      // On Easy the `nuked` strategy is first, so it dispatches a TN attack.
      expect(attacks.length).toBeGreaterThan(0);
      for (const attack of attacks) {
        expect(attack.target().isPlayer()).toBe(false);
      }
    });
  });

  describe("MissileSilo disabled disables the `nuked` strategy", () => {
    test("isUnitDisabled(MissileSilo) short-circuits isBorderingNukedTerritory", async () => {
      // `isBorderingNukedTerritory` returns false when MissileSilo is
      // disabled, so even with nuked TN on the border the `nuked` strategy
      // does NOT fire and no attack is created.
      const { game, nation, attackBehavior } = await setupBehavior(
        Difficulty.Impossible,
        {
          withEnemy: false,
          disabledUnits: [UnitType.MissileSilo],
        },
      );

      const before = nation.outgoingAttacks().length;
      attackBehavior.maybeAttack();
      executeTicks(game, 1);

      const attacks = newAttacks(nation, before);
      expect(attacks).toHaveLength(0);
    });
  });
});
