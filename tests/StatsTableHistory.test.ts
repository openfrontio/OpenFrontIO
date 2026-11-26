import {
  RankTrends,
  RefreshClock,
  RowMoves,
} from "../src/client/components/StatsTableHistory";
import type { GameView } from "../src/client/view";

describe("RefreshClock", () => {
  // A jump is 300 ticks, 30 seconds of play.
  const JUMP = 300;

  it("follows on from a refresh of the same sort a second earlier", () => {
    const clock = new RefreshClock(JUMP);
    expect(clock.next("tiles desc", 600, 1)).toBe(false);
    expect(clock.next("tiles desc", 610, 1)).toBe(true);
    expect(clock.next("tiles desc", 910, 1)).toBe(true);
  });

  it("does not follow on after a jump, a new sort or a clock gone back", () => {
    const clock = new RefreshClock(JUMP);
    clock.next("tiles desc", 600, 1);
    expect(clock.next("tiles desc", 901, 1)).toBe(false);
    expect(clock.next("gold desc", 911, 1)).toBe(false);
    expect(clock.next("gold desc", 900, 1)).toBe(false);
    expect(clock.next("gold desc", 910, 1)).toBe(true);
  });

  it("allows as many times more ticks as the game plays faster", () => {
    const clock = new RefreshClock(JUMP);
    clock.next("tiles desc", 600, 32);
    expect(clock.next("tiles desc", 600 + 32 * JUMP, 32)).toBe(true);
    expect(clock.next("tiles desc", 601 + 64 * JUMP, 32)).toBe(false);
  });

  it("follows on when a replay slows down between two refreshes", () => {
    const clock = new RefreshClock(JUMP);
    // 0.7 s at 32x, then the viewer picks 0.5x.
    clock.next("tiles desc", 600, 32);
    expect(clock.next("tiles desc", 825, 0.5)).toBe(true);
    // From there the gap builds up at 0.5x.
    expect(clock.next("tiles desc", 976, 0.5)).toBe(false);
  });

  it("does not follow on once it forgot, however close the tick", () => {
    const clock = new RefreshClock(JUMP);
    clock.next("tiles desc", 600, 32);
    clock.forget();
    expect(clock.next("tiles desc", 610, 32)).toBe(false);
    expect(clock.next("tiles desc", 620, 32)).toBe(true);
  });
});

describe("RowMoves", () => {
  it("gives the rows that changed place since the last order, once", () => {
    const moves = new RowMoves();
    moves.note(["a", "b", "c", "d"]);
    expect(moves.take().size).toBe(0);

    // c overtakes b; e is new and has nowhere to come from.
    moves.note(["a", "c", "b", "d", "e"]);
    expect([...moves.take()]).toEqual([
      ["c", { from: 2, to: 1 }],
      ["b", { from: 1, to: 2 }],
    ]);
    expect(moves.take().size).toBe(0);
  });

  it("drops the moves noted, and keeps the order for the next refresh", () => {
    const moves = new RowMoves();
    moves.note(["a", "b", "c"]);
    moves.note(["b", "a", "c"]);
    moves.drop();
    expect(moves.take().size).toBe(0);

    moves.note(["b", "c", "a"]);
    expect([...moves.take()]).toEqual([
      ["c", { from: 2, to: 1 }],
      ["a", { from: 1, to: 2 }],
    ]);
  });

  it("gives no moves after it forgot the order", () => {
    const moves = new RowMoves();
    moves.note(["a", "b", "c"]);
    moves.forget();
    moves.note(["c", "b", "a"]);
    expect(moves.take().size).toBe(0);
  });
});

describe("RankTrends", () => {
  const KEYS = ["a", "b", "c", "d", "e", "f"];
  let tick: number;
  let startTick: number;
  const game = {
    ticks: () => tick,
    ticksSinceStart: () => tick - startTick,
  } as unknown as GameView;

  // Each key's rank in `order`, the first ranked first.
  function ranks(order: readonly string[]) {
    return new Map(order.map((key, rank) => [key, rank + 1]));
  }

  // Notes `order` once a second for `seconds`.
  function play(trends: RankTrends, seconds: number, order = KEYS) {
    for (let i = 0; i < seconds; i++) {
      tick += 10;
      trends.note(ranks(order), game);
    }
  }

  // c overtakes b.
  const OVERTAKE = ["a", "c", "b", "d", "e", "f"];

  beforeEach(() => {
    // Two minutes into the game.
    startTick = 0;
    tick = 1200;
  });

  it("marks a move that held for five seconds against the ranks 30 seconds ago", () => {
    const trends = new RankTrends();
    play(trends, 30);
    play(trends, 4, OVERTAKE);
    expect(trends.shown(KEYS).size).toBe(0);

    play(trends, 1, OVERTAKE);
    expect([...trends.shown(KEYS)]).toEqual([
      ["b", "down"],
      ["c", "up"],
    ]);
  });

  it("counts the five seconds in game time, not in refreshes", () => {
    const trends = new RankTrends();
    play(trends, 30);
    // Refreshes a tick apart, as when the mouse leaves the list.
    for (let i = 0; i < 10; i++) {
      tick += 1;
      trends.note(ranks(OVERTAKE), game);
    }
    expect(trends.shown(KEYS).size).toBe(0);
  });

  it("marks after one refresh of a replay played 32 times faster", () => {
    const trends = new RankTrends();
    play(trends, 30);
    tick += 320;
    trends.note(ranks(OVERTAKE), game);
    expect(trends.shown(KEYS).size).toBe(2);
  });

  it("marks nothing until it has ranks 30 seconds old", () => {
    const trends = new RankTrends();
    play(trends, 20);
    play(trends, 9, OVERTAKE);
    expect(trends.shown(KEYS).size).toBe(0);
  });

  it("marks nothing in the first minute of play", () => {
    startTick = tick;
    const trends = new RankTrends();
    play(trends, 30);
    play(trends, 29, OVERTAKE);
    expect(trends.shown(KEYS).size).toBe(0);

    play(trends, 1, OVERTAKE);
    expect(trends.shown(KEYS).size).toBe(2);
  });

  it("keeps the marks while the clock stands still", () => {
    const trends = new RankTrends();
    play(trends, 30);
    play(trends, 5, OVERTAKE);
    trends.note(ranks(KEYS), game);
    expect(trends.shown(KEYS).size).toBe(2);
  });

  it("shows no marks when more than half of the drawn rows would carry one", () => {
    const trends = new RankTrends();
    play(trends, 30);
    play(trends, 5, OVERTAKE);
    expect(trends.shown(["b", "c", "d", "e"]).size).toBe(2);
    expect(trends.shown(["b", "c", "d"]).size).toBe(0);
  });

  it("marks nothing after it forgot the ranks", () => {
    const trends = new RankTrends();
    play(trends, 30);
    play(trends, 5, OVERTAKE);
    trends.forget();
    expect(trends.shown(KEYS).size).toBe(0);

    play(trends, 5, OVERTAKE);
    expect(trends.shown(KEYS).size).toBe(0);
  });
});
