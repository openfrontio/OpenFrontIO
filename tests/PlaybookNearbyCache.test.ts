import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { DEFAULT_PLAYBOOK } from "../src/core/execution/playbook/Params";
import { SituationQueries } from "../src/core/execution/playbook/Situation";
import { Game, Player, PlayerType } from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { playerInfo, setup } from "./util/Setup";

// SituationQueries.neighbours() memoises me.nearby() for `nearbyEvery` ticks (it was ~28 % of a lab game).
// nearbyEvery = 1 must behave exactly like the uncached code across ticks, and the friend/rival split must
// never be stale within a tick.
let game: Game;
let me: Player;
let p2: Player;
let p3: Player;

function queries(nearbyEvery: number): SituationQueries {
  return new SituationQueries({
    mg: game,
    me,
    p: { ...DEFAULT_PLAYBOOK, nearbyEvery },
    sit: undefined as never,
    random: new PseudoRandom(1),
    send: () => 0,
    boat: () => 0,
    log: () => {},
    fire: () => {},
  });
}

describe("PlaybookBot neighbour cache", () => {
  beforeEach(async () => {
    game = await setup("plains", {}, [
      playerInfo("me", PlayerType.Human),
      playerInfo("p2", PlayerType.Human),
      playerInfo("p3", PlayerType.Human),
    ]);
    me = game.player("me");
    p2 = game.player("p2");
    p3 = game.player("p3");
    me.conquer(game.ref(10, 10));
    p2.conquer(game.ref(11, 10));
    p3.conquer(game.ref(30, 30)); // not adjacent yet
    game.executeNextTick();
  });

  test("nearbyEvery = 1 sees a new neighbour on the next tick", () => {
    const q = queries(1);
    expect(q.neighbours().rivals).toEqual([p2]);
    p3.conquer(game.ref(10, 11));
    game.executeNextTick();
    expect(q.neighbours().rivals.sort()).toEqual([p2, p3].sort());
  });

  test("nearbyEvery = 10 holds the neighbour set for ten ticks", () => {
    const q = queries(10);
    expect(q.neighbours().rivals).toEqual([p2]);
    p3.conquer(game.ref(10, 11));
    for (let i = 0; i < 9; i++) {
      game.executeNextTick();
      expect(q.neighbours().rivals).toEqual([p2]);
    }
    game.executeNextTick();
    expect(q.neighbours().rivals.sort()).toEqual([p2, p3].sort());
  });

  test("the friend/rival split is recomputed on every call, even inside the cache window", () => {
    const q = queries(10);
    expect(q.neighbours().rivals).toEqual([p2]);
    expect(q.neighbours().friends).toEqual([]);
    game.addExecution(new AllianceRequestExecution(me, p2.id()));
    game.executeNextTick();
    game.addExecution(new AllianceRequestExecution(p2, me.id()));
    game.executeNextTick();
    expect(me.isFriendly(p2)).toBe(true);
    expect(q.neighbours().friends).toEqual([p2]);
    expect(q.neighbours().rivals).toEqual([]);
  });
});
