import { AttackExecution } from "../src/core/execution/AttackExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { GameUpdateType, PlayerUpdate } from "../src/core/game/GameUpdates";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";

let game: Game;
const gameID: GameID = "game_id";
let alice: Player;
let bob: Player;

describe("Player update diffing (toUpdate)", () => {
  beforeEach(async () => {
    game = await setup("plains", { infiniteTroops: true });
    const aliceInfo = new PlayerInfo(
      "alice",
      PlayerType.Human,
      "alice_client",
      "alice_id",
    );
    const bobInfo = new PlayerInfo(
      "bob",
      PlayerType.Human,
      "bob_client",
      "bob_id",
    );
    game.addPlayer(aliceInfo);
    game.addPlayer(bobInfo);
    game.addExecution(
      new SpawnExecution(gameID, aliceInfo, game.ref(10, 10)),
      new SpawnExecution(gameID, bobInfo, game.ref(16, 10)),
    );
    game.executeNextTick();
    game.executeNextTick();
    alice = game.player("alice_id");
    bob = game.player("bob_id");
  });

  test("first toUpdate returns a full snapshot with empty collections", () => {
    // executeNextTick calls toUpdate() for every player, so use a freshly
    // added player whose update has never been built.
    const charlieInfo = new PlayerInfo(
      "charlie",
      PlayerType.Human,
      "charlie_client",
      "charlie_id",
    );
    game.addPlayer(charlieInfo);
    const charlie = game.player("charlie_id");

    const full = charlie.toUpdate();
    expect(full).not.toBeNull();
    expect(full!.id).toBe("charlie_id");
    expect(full!.name).toBe("charlie");
    expect(full!.smallID).toBe(charlie.smallID());
    expect(full!.allies).toEqual([]);
    expect(full!.targets).toEqual([]);
    expect(full!.embargoes).toEqual(new Set());
    expect(full!.outgoingAttacks).toEqual([]);
    expect(full!.incomingAttacks).toEqual([]);
    expect(full!.outgoingAllianceRequests).toEqual([]);
    expect(full!.alliances).toEqual([]);
    expect(full!.outgoingEmojis).toEqual([]);
  });

  test("toUpdate returns null when nothing changed", () => {
    alice.toUpdate(); // first full snapshot
    expect(alice.toUpdate()).toBeNull();
    expect(alice.toUpdate()).toBeNull();
  });

  test("primitive changes appear in the diff without unchanged collections", () => {
    alice.toUpdate();
    alice.markTraitor();
    const diff = alice.toUpdate();
    expect(diff).not.toBeNull();
    expect(diff!.isTraitor).toBe(true);
    // Unchanged collection fields must be absent from the diff.
    expect(diff!.allies).toBeUndefined();
    expect(diff!.embargoes).toBeUndefined();
    expect(diff!.outgoingAttacks).toBeUndefined();
    expect(diff!.alliances).toBeUndefined();
  });

  test("stat churn (gold/troops/tilesOwned) travels via statsOut, not the diff", () => {
    const statsOut: number[] = [];
    alice.toUpdate(statsOut);
    statsOut.length = 0;

    alice.addGold(123n);
    const diff = alice.toUpdate(statsOut);
    // No object diff — gold alone must not put the player on the object
    // channel (that's the whole point of the packed stats channel).
    expect(diff).toBeNull();
    expect(statsOut).toEqual([
      alice.smallID(),
      alice.numTilesOwned(),
      Number(alice.gold()),
      alice.troops(),
    ]);

    // Nothing changed → no quad, no diff.
    statsOut.length = 0;
    expect(alice.toUpdate(statsOut)).toBeNull();
    expect(statsOut).toEqual([]);

    // A non-stat change produces an object diff but no quad.
    alice.markTraitor();
    expect(alice.toUpdate(statsOut)).not.toBeNull();
    expect(statsOut).toEqual([]);
  });

  test("first emission carries the stats in the full snapshot, not statsOut", () => {
    const info = new PlayerInfo(
      "dora",
      PlayerType.Human,
      "dora_client",
      "dora_id",
    );
    game.addPlayer(info);
    const dora = game.player("dora_id");
    const statsOut: number[] = [];
    const full = dora.toUpdate(statsOut);
    expect(full).not.toBeNull();
    expect(full!.gold).toBe(dora.gold());
    expect(full!.troops).toBe(dora.troops());
    expect(full!.tilesOwned).toBe(dora.numTilesOwned());
    expect(statsOut).toEqual([]);
  });

  test("adding and removing an embargo shows up in consecutive diffs", () => {
    alice.toUpdate();
    alice.addEmbargo(bob, false);
    let diff = alice.toUpdate();
    expect(diff).not.toBeNull();
    expect(diff!.embargoes).toEqual(new Set(["bob_id"]));

    expect(alice.toUpdate()).toBeNull(); // stable until something changes

    alice.stopEmbargo(bob);
    diff = alice.toUpdate();
    expect(diff).not.toBeNull();
    expect(diff!.embargoes).toEqual(new Set());
  });

  test("an alliance shows up in allies and alliance views", () => {
    alice.toUpdate();
    bob.toUpdate();
    const request = alice.createAllianceRequest(bob);
    expect(request).not.toBeNull();
    request!.accept();

    const aliceDiff = alice.toUpdate();
    expect(aliceDiff).not.toBeNull();
    expect(aliceDiff!.allies).toEqual([bob.smallID()]);
    expect(aliceDiff!.alliances).toHaveLength(1);
    expect(aliceDiff!.alliances![0].other).toBe("bob_id");

    const bobDiff = bob.toUpdate();
    expect(bobDiff).not.toBeNull();
    expect(bobDiff!.allies).toEqual([alice.smallID()]);
  });

  test("targeting a player appears in the diff", () => {
    alice.toUpdate();
    alice.target(bob);
    const diff = alice.toUpdate();
    expect(diff).not.toBeNull();
    expect(diff!.targets).toEqual([bob.smallID()]);
  });

  test("attacks appear for attacker and defender through the tick pipeline", () => {
    // Expand alice into terra nullius until she borders bob — a land attack
    // on a non-adjacent player retreats immediately.
    game.addExecution(
      new AttackExecution(2000, alice, game.terraNullius().id()),
    );
    for (let i = 0; i < 30 && !alice.sharesBorderWith(bob); i++) {
      game.executeNextTick();
    }
    expect(alice.sharesBorderWith(bob)).toBe(true);

    game.addExecution(new AttackExecution(5000, alice, bob.id()));
    // executeNextTick integrates toUpdate(), so read the emitted updates.
    const updates = game.executeNextTick(); // attack initializes
    const playerUpdates = updates[GameUpdateType.Player] as PlayerUpdate[];

    const attackerUpdate = playerUpdates.find((u) => u.id === "alice_id");
    expect(attackerUpdate).toBeDefined();
    // The terra nullius expansion attack may still be running; assert on the
    // attack against bob specifically.
    const bobAttack = attackerUpdate!.outgoingAttacks!.find(
      (a) => a.targetID === bob.smallID(),
    );
    expect(bobAttack).toBeDefined();

    const defenderUpdate = playerUpdates.find((u) => u.id === "bob_id");
    expect(defenderUpdate).toBeDefined();
    expect(defenderUpdate!.incomingAttacks).toHaveLength(1);
    expect(defenderUpdate!.incomingAttacks![0].attackerID).toBe(
      alice.smallID(),
    );

    // As the attack progresses, troop counts change — but attack arrays are
    // NOT resent for troop-only changes. Troops flow as packed
    // [ownerSmallID, direction, index, troops] quads instead.
    game.drainPackedAttackUpdates(); // discard quads from earlier ticks
    const nextUpdates = game.executeNextTick();
    const nextPlayerUpdates = nextUpdates[
      GameUpdateType.Player
    ] as PlayerUpdate[];
    const next = nextPlayerUpdates.find((u) => u.id === "alice_id");
    if (next !== undefined) {
      // Alice may appear for other field changes, but not for attack arrays.
      expect(next.outgoingAttacks).toBeUndefined();
    }
    const packed = game.drainPackedAttackUpdates();
    expect(packed).not.toBeNull();
    // Find alice's outgoing quads and check one matches her current attack.
    const aliceQuads: number[][] = [];
    for (let i = 0; i + 3 < packed!.length; i += 4) {
      if (packed![i] === alice.smallID() && packed![i + 1] === 0) {
        aliceQuads.push(Array.from(packed!.subarray(i, i + 4)));
      }
    }
    expect(aliceQuads.length).toBeGreaterThan(0);
    const aliceAttacks = alice.outgoingAttacks();
    for (const [, , index, troops] of aliceQuads) {
      expect(troops).toBe(aliceAttacks[index].troops());
    }
  });

  test("in-worker mutation of shared empty collections fails loudly", () => {
    const charlieInfo = new PlayerInfo(
      "charlie2",
      PlayerType.Human,
      "charlie2_client",
      "charlie2_id",
    );
    game.addPlayer(charlieInfo);
    const full = game.player("charlie2_id").toUpdate()!;
    // Empty collections are shared frozen singletons; a sloppy in-worker
    // consumer must throw instead of silently corrupting every player's
    // updates. (Updates crossing to the main thread are structured-cloned,
    // so real consumers get mutable copies.)
    expect(() => full.allies!.push(999)).toThrow();
    expect(() => full.outgoingAttacks!.pop()).toThrow();

    // And other players see no spurious changes.
    expect(bob.toUpdate()).toBeNull();
  });
});
