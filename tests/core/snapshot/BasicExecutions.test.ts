import { AllianceExtensionExecution } from "../../../src/core/execution/alliance/AllianceExtensionExecution";
import { AllianceRejectExecution } from "../../../src/core/execution/alliance/AllianceRejectExecution";
import { AllianceRequestExecution } from "../../../src/core/execution/alliance/AllianceRequestExecution";
import { BreakAllianceExecution } from "../../../src/core/execution/alliance/BreakAllianceExecution";
import { BoatRetreatExecution } from "../../../src/core/execution/BoatRetreatExecution";
import { CityExecution } from "../../../src/core/execution/CityExecution";
import { DefensePostExecution } from "../../../src/core/execution/DefensePostExecution";
import { DeleteUnitExecution } from "../../../src/core/execution/DeleteUnitExecution";
import { DonateGoldExecution } from "../../../src/core/execution/DonateGoldExecution";
import { DonateTroopsExecution } from "../../../src/core/execution/DonateTroopExecution";
import { EmbargoAllExecution } from "../../../src/core/execution/EmbargoAllExecution";
import { EmbargoExecution } from "../../../src/core/execution/EmbargoExecution";
import { EmojiExecution } from "../../../src/core/execution/EmojiExecution";
import { FactoryExecution } from "../../../src/core/execution/FactoryExecution";
import { MarkDisconnectedExecution } from "../../../src/core/execution/MarkDisconnectedExecution";
import { MissileSiloExecution } from "../../../src/core/execution/MissileSiloExecution";
import { MoveWarshipExecution } from "../../../src/core/execution/MoveWarshipExecution";
import { PauseExecution } from "../../../src/core/execution/PauseExecution";
import { PlayerExecution } from "../../../src/core/execution/PlayerExecution";
import { QuickChatExecution } from "../../../src/core/execution/QuickChatExecution";
import { RetreatExecution } from "../../../src/core/execution/RetreatExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import { TargetPlayerExecution } from "../../../src/core/execution/TargetPlayerExecution";
import { UpgradeStructureExecution } from "../../../src/core/execution/UpgradeStructureExecution";
import {
  AllPlayers,
  Game,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { expectSnapshotRoundTrip } from "../../util/Snapshot";

const MAP = "plains";

function human(name: string): PlayerInfo {
  return new PlayerInfo(name, PlayerType.Human, null, name);
}

function conquerBox(
  game: Game,
  p: Player,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) p.conquer(game.ref(x, y));
  }
}

describe("basic execution snapshots", () => {
  test("spawn phase: pending, initialized and completed spawns", async () => {
    const alice = human("alice");
    const game = await setup(
      MAP,
      { gameType: GameType.Public },
      [alice],
      undefined,
      undefined,
      false,
    );
    // An intent spawn for a lobby human, and a random-tile spawn whose
    // PlayerInfo is not registered with the game.
    game.addExecution(
      new SpawnExecution("game_id", alice, game.ref(20, 20), true),
      new SpawnExecution("game_id", human("zed"), undefined),
    );
    // Pending in unInitExecs.
    await expectSnapshotRoundTrip(game, MAP, 0);

    game.executeNextTick(); // init
    await expectSnapshotRoundTrip(game, MAP, 3);

    // Both spawned; queue non-spawn-phase executions, which wait in
    // unInitExecs until the spawn phase ends, plus a re-spawn.
    const a = game.player("alice");
    const z = game.player("zed");
    game.addExecution(
      new SpawnExecution("game_id", alice, game.ref(60, 60), true),
      new EmojiExecution(a, "zed", 0),
      new EmojiExecution(a, AllPlayers, 1),
      new PauseExecution(a, true),
      new TargetPlayerExecution(a, z.id()),
      new MarkDisconnectedExecution(z, true),
    );
    const restored = await expectSnapshotRoundTrip(game, MAP, 6, (g, i) => {
      if (i === 3) g.endSpawnPhase();
    });
    expect(game.inSpawnPhase()).toBe(false);
    expect(restored.player("alice").spawnTile()).toBe(game.ref(60, 60));
    expect(restored.player("zed").isDisconnected()).toBe(true);
  });

  describe("in game", () => {
    let game: Game;
    let a: Player;
    let b: Player;
    let c: Player;
    let d: Player;

    beforeEach(async () => {
      game = await setup(MAP, {
        infiniteGold: true,
        instantBuild: true,
        donateGold: true,
        donateTroops: true,
      });
      a = game.addPlayer(human("alice"));
      b = game.addPlayer(human("bob"));
      c = game.addPlayer(human("carol"));
      d = game.addPlayer(human("dave"));
      conquerBox(game, a, 5, 5, 30, 30);
      conquerBox(game, b, 40, 5, 60, 30);
      conquerBox(game, c, 5, 40, 30, 60);
      conquerBox(game, d, 40, 40, 60, 60);
      for (const p of [a, b, c, d]) {
        p.setSpawnTile(p.tiles().values().next().value!);
        game.addExecution(new PlayerExecution(p));
      }
      game.executeNextTick();
      game.executeNextTick();
    });

    test("player executions across a cluster capture", async () => {
      // PlayerExecution is mid-cycle (lastCalc) for everyone.
      await expectSnapshotRoundTrip(game, MAP, 5);
      // Carol grabs an enclave inside Alice's land; Alice's PlayerExecution
      // must later capture it, on both games.
      await expectSnapshotRoundTrip(game, MAP, 30, (g, i) => {
        if (i === 2) {
          conquerBox(g, g.player("carol"), 15, 15, 18, 18);
        }
        if (i === 10) {
          for (const t of Array.from(g.player("dave").tiles())) {
            g.player("dave").relinquish(t);
          }
        }
      });
      // The enclave went back to Alice, and Dave died.
      expect(game.owner(game.ref(16, 16))).toBe(game.player("alice"));
      expect(game.player("dave").isAlive()).toBe(false);
    });

    test("diplomacy executions: pending, initialized, finished", async () => {
      game.addExecution(
        new AllianceRequestExecution(a, b.id()),
        new AllianceRequestExecution(c, d.id()),
        new EmojiExecution(a, b.id(), 2),
        new EmojiExecution(c, AllPlayers, 3),
        new EmojiExecution(c, "nobody", 3),
        new QuickChatExecution(a, b.id(), "greet.hello", c.id()),
        new QuickChatExecution(b, a.id(), "greet.hello", undefined),
        new EmbargoExecution(a, c.id(), "start"),
        new EmbargoExecution(a, "nobody", "stop"),
        new EmbargoAllExecution(b, "start"),
        new TargetPlayerExecution(c, d.id()),
        new TargetPlayerExecution(c, "nobody"),
        new MarkDisconnectedExecution(d, true),
        new PauseExecution(a, true),
        new RetreatExecution(a, "no_such_attack"),
        new BoatRetreatExecution(b, 12345),
        new MoveWarshipExecution(a, [1, 2, 2], game.ref(1, 1)),
        new DonateGoldExecution(a, b.id(), null),
        new DonateTroopsExecution(a, "nobody", 100),
      );
      // Everything pending.
      await expectSnapshotRoundTrip(game, MAP, 0);

      game.executeNextTick(); // init
      await expectSnapshotRoundTrip(game, MAP, 2);

      // Bob accepts, Dave rejects, then donations inside the alliance,
      // an extension and a break, all queued on both games.
      await expectSnapshotRoundTrip(game, MAP, 30, (g, i) => {
        const [ga, gb, gc, gd] = ["alice", "bob", "carol", "dave"].map((id) =>
          g.player(id),
        );
        if (i === 0) {
          g.addExecution(
            new AllianceRequestExecution(gb, ga.id()),
            new AllianceRejectExecution(gc.id(), gd),
          );
        }
        if (i === 3) {
          g.addExecution(
            new DonateGoldExecution(ga, gb.id(), 5000),
            new DonateTroopsExecution(ga, gb.id(), null),
            new AllianceExtensionExecution(ga, gb.id()),
            new AllianceExtensionExecution(gb, ga.id()),
          );
        }
        if (i === 8) {
          expect(ga.isAlliedWith(gb)).toBe(true);
          expect(gc.isAlliedWith(gd)).toBe(false);
          g.addExecution(new BreakAllianceExecution(ga, gb.id()));
        }
      });

      const ga = game.player("alice");
      const gb = game.player("bob");
      expect(ga.isAlliedWith(gb)).toBe(false);
      expect(gb.relation(ga)).toBeDefined();
      expect(ga.hasEmbargoAgainst(game.player("carol"))).toBe(true);

      // Retreat is still waiting out its cancel delay here.
      game.addExecution(new BreakAllianceExecution(a, "nobody"));
      game.executeNextTick();
      await expectSnapshotRoundTrip(game, MAP, 10);
    });

    test("structure executions", async () => {
      const city = a.buildUnit(UnitType.City, game.ref(10, 10), {});
      const post = a.buildUnit(UnitType.DefensePost, game.ref(15, 10), {});
      const silo = b.buildUnit(UnitType.MissileSilo, game.ref(50, 10), {});
      const factory = c.buildUnit(UnitType.Factory, game.ref(10, 50), {});
      game.addExecution(
        new CityExecution(city),
        new DefensePostExecution(post),
        new MissileSiloExecution(silo),
        new FactoryExecution(factory),
        new UpgradeStructureExecution(a, city.id(), 2),
        new UpgradeStructureExecution(a, 99999),
      );
      await expectSnapshotRoundTrip(game, MAP, 0);

      game.executeNextTick(); // init
      await expectSnapshotRoundTrip(game, MAP, 3);

      // Deleting the city: marked in init, removed after the mark expires.
      // Wait out the initial delete cooldown first.
      while (!a.canDeleteUnit()) game.executeNextTick();
      game.addExecution(
        new DeleteUnitExecution(a, city.id()),
        new DeleteUnitExecution(a, silo.id()),
      );
      await expectSnapshotRoundTrip(game, MAP, 0);
      game.executeNextTick();
      game.executeNextTick();
      await expectSnapshotRoundTrip(game, MAP, 12);
      expect(city.isActive()).toBe(false);
      expect(silo.isActive()).toBe(true); // Not Alice's to delete.

      // The dead city is still referenced by the finished CityExecution.
      post.delete();
      await expectSnapshotRoundTrip(game, MAP, 3);
    });
  });
});
