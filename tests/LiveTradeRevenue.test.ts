import { Game, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

// Live leaderboard gold-rate columns ("Ship Trade Gold/min", "Train Trade
// Gold/min", "Piracy Gold/min") need cumulative per-source revenue on the live
// PlayerUpdate. These tests pin the PlayerImpl counters and their wire
// behavior; the crediting sites themselves are TradeShipExecution.complete()
// (normal arrivals → tradeGold, captured-ship payouts → piracyGold) and
// TrainStation's TradeStationStopHandler (train stops → trainGold).
describe("live trade revenue counters", () => {
  let game: Game;

  beforeEach(async () => {
    game = await setup("ocean_and_land");
  });

  function addHuman(id: string) {
    game.addPlayer(new PlayerInfo(id, PlayerType.Human, `${id}_client`, id));
    return game.player(id);
  }

  test("counters start at zero and accumulate independently", () => {
    const p = addHuman("trader");
    expect(p.tradeGold()).toBe(0n);
    expect(p.trainGold()).toBe(0n);
    expect(p.piracyGold()).toBe(0n);
    expect(p.goldEarned()).toBe(0n);

    p.addTradeGold(100n);
    p.addTrainGold(40n);
    p.addTradeGold(50n);
    p.addPiracyGold(15n);

    expect(p.tradeGold()).toBe(150n);
    expect(p.trainGold()).toBe(40n);
    expect(p.piracyGold()).toBe(15n);
  });

  test("goldEarned counts every addGold and excludes starting gold", () => {
    const p = addHuman("earner");
    const startingGold = p.gold();
    expect(p.goldEarned()).toBe(0n); // constructor sets the field directly

    p.addGold(500n);
    p.addGold(250n);
    expect(p.goldEarned()).toBe(750n);

    // Spending does not reduce lifetime income.
    p.removeGold(600n);
    expect(p.goldEarned()).toBe(750n);
    expect(p.gold()).toBe(startingGold + 150n);
  });

  test("goldEarned rides the PlayerUpdate like the other counters", () => {
    const p = addHuman("wires");
    p.addGold(300n);
    const full = p.toUpdate();
    expect(full?.goldEarned).toBe(300n);

    // Later changes travel via the packed statsOut quint, not the object
    // diff — goldEarned churns every tick (worker income) and must not put
    // every player on the object channel.
    p.addGold(200n);
    const statsOut: number[] = [];
    const diff = p.toUpdate(statsOut);
    expect(diff).toBeNull();
    expect(diff?.goldEarned).toBeUndefined();
    expect(statsOut).toEqual([
      p.smallID(),
      p.numTilesOwned(),
      Number(p.gold()),
      p.troops(),
      Number(p.goldEarned()),
    ]);
  });

  test("counters ride the first (full) PlayerUpdate snapshot", () => {
    const p = addHuman("snapshot");
    p.addTradeGold(120n);
    p.addTrainGold(30n);
    p.addPiracyGold(5n);

    const update = p.toUpdate();
    expect(update?.tradeGold).toBe(120n);
    expect(update?.trainGold).toBe(30n);
    expect(update?.piracyGold).toBe(5n);
  });

  test("changed counters appear in subsequent partial updates", () => {
    const p = addHuman("partial");
    p.toUpdate(); // first emission = full snapshot

    // Nothing changed -> no update at all.
    expect(p.toUpdate()).toBeNull();

    p.addTrainGold(75n);
    const diff = p.toUpdate();
    expect(diff?.trainGold).toBe(75n);
    expect(diff?.tradeGold).toBeUndefined();
    expect(diff?.piracyGold).toBeUndefined();

    p.addPiracyGold(20n);
    const piracyDiff = p.toUpdate();
    expect(piracyDiff?.piracyGold).toBe(20n);
    expect(piracyDiff?.trainGold).toBeUndefined();
  });
});
