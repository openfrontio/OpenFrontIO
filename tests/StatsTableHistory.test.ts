import { RefreshClock } from "../src/client/components/StatsTableHistory";

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
});
