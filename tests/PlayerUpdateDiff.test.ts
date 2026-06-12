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
    alice.addGold(123n);
    const diff = alice.toUpdate();
    expect(diff).not.toBeNull();
    expect(diff!.gold).toBe(alice.gold());
    // Unchanged collection fields must be absent from the diff.
    expect(diff!.allies).toBeUndefined();
    expect(diff!.embargoes).toBeUndefined();
    expect(diff!.outgoingAttacks).toBeUndefined();
    expect(diff!.alliances).toBeUndefined();
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

    // As the attack progresses, troop counts change and must keep flowing
    // through subsequent diffs.
    const nextUpdates = game.executeNextTick();
    const nextPlayerUpdates = nextUpdates[
      GameUpdateType.Player
    ] as PlayerUpdate[];
    const next = nextPlayerUpdates.find((u) => u.id === "alice_id");
    expect(next).toBeDefined();
    expect(
      next!.outgoingAttacks!.some((a) => a.targetID === bob.smallID()),
    ).toBe(true);
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
