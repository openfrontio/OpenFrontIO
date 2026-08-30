// B3: scored spending. The value functions are pure (Spend.ts) so the lab-known choices are checked with fixed
// inputs; the escrow arithmetic and the flag-on Economy pass are checked on a real game from tests/util/Setup.ts.

import { beforeEach, describe, expect, test } from "vitest";
import { PlaybookBotExecution } from "../../src/core/execution/playbook/PlaybookBotExecution";
import { DEFAULT_PLAYBOOK } from "../../src/core/execution/playbook/Params";
import * as Spend from "../../src/core/execution/playbook/Spend";
import { SpawnExecution } from "../../src/core/execution/SpawnExecution";
import { Game, Player, PlayerInfo, PlayerType, UnitType } from "../../src/core/game/Game";
import { setup } from "../util/Setup";

const H = Spend.horizon(3000); // opening/mid horizon: 6000 ticks
const CITY = 250_000; // config.cityTroopIncrease()
const partnered: Spend.PortInputs = { shipGold: 100_000, mapShips: 50, seaFullShips: 400, ownLevels: 1, partner: true };

describe("Spend value model", () => {
  test("(a) early: the first city outranks a partnerless port", () => {
    // 125k first city, troops at 60 % of cap (fullness 1 at capFullShare 0.6)
    const city = Spend.valueOf(Spend.capReturn(CITY, 0.6, 0.6, H), 125_000n);
    // a speculative port (no partner) is worth NO_PARTNER_SHARE of a partnered lane
    const port = Spend.valueOf(Spend.newPortReturn({ ...partnered, ownLevels: 0, partner: false }, 0, 3, H, 50), 125_000n);
    expect(city).toBeGreaterThanOrEqual(1);
    expect(city).toBeGreaterThan(port);
  });

  test("(a') a full army buys cap before another port level; a half-empty one buys the port", () => {
    const level = Spend.valueOf(Spend.portLevelReturn(partnered, H), 250_000n);
    const cityFull = Spend.valueOf(Spend.capReturn(CITY, 0.85, 0.6, H), 250_000n);
    const cityLow = Spend.valueOf(Spend.capReturn(CITY, 0.4, 0.6, H), 250_000n);
    expect(cityFull).toBeGreaterThan(level);
    expect(cityLow).toBeLessThan(level);
  });

  test("(b) a level-1 port with a partner: level it to 3 before a second port", () => {
    const level = Spend.valueOf(Spend.portLevelReturn(partnered, H), 250_000n);
    const second = Spend.valueOf(Spend.newPortReturn(partnered, 1, 3, H, 50), 250_000n);
    expect(level).toBeGreaterThan(second);
    // ... and once it is level 3 the second port wins
    const secondAt3 = Spend.valueOf(Spend.newPortReturn({ ...partnered, ownLevels: 3 }, 3, 3, H, 50), 250_000n);
    const levelAt3 = Spend.valueOf(Spend.portLevelReturn({ ...partnered, ownLevels: 3 }, H), 250_000n);
    expect(secondAt3).toBeGreaterThan(levelAt3);
  });

  test("(c) endgame: nothing whose payback is longer than the horizon scores 1", () => {
    const tick = 15500;
    const h = Spend.horizon(tick);
    expect(h).toBe(1000);
    const late: Spend.PortInputs = { shipGold: 100_000, mapShips: 450, seaFullShips: 400, ownLevels: 30, partner: true };
    expect(Spend.valueOf(Spend.portLevelReturn(late, h), 1_000_000n)).toBeLessThan(1);
    expect(Spend.valueOf(Spend.newPortReturn(late, 3, 3, h, 50), 1_000_000n)).toBeLessThan(1);
    const rail: Spend.RailInputs = { factories: 2, ownStops: 4, allyStops: 0, selfStopGold: 10_000, allyStopGold: 35_000 };
    expect(Spend.railValue(rail, (2 + 10) * 15, 1_000_000n + 4n * 1_000_000n, h, 120)).toBeLessThan(1);
    expect(Spend.valueOf(Spend.warshipReturn(2000, h), 1_000_000n)).toBeLessThan(1);
    // the same purchases pay back over a mid-game horizon
    expect(Spend.valueOf(Spend.portLevelReturn(partnered, H), 250_000n)).toBeGreaterThan(1);
    expect(Spend.railValue({ ...rail, factories: 0 }, 10 * 15, 125_000n + 4n * 250_000n, H, 120)).toBeGreaterThan(1); // while cities are cheap
  });

  test("rail only pays with stations on the line", () => {
    const none: Spend.RailInputs = { factories: 0, ownStops: 0, allyStops: 0, selfStopGold: 10_000, allyStopGold: 35_000 };
    expect(Spend.railValue(none, 150, 500_000n, H, 120)).toBe(0);
    expect(Spend.railReturnPerTick({ ...none, allyStops: 1 }, 150)).toBeGreaterThan(Spend.railReturnPerTick({ ...none, ownStops: 1 }, 150));
  });

  test("silo and SAM value comes from threat and readiness, not the clock", () => {
    const base: Spend.SiloInputs = { enemySilos: false, rank: 99, idleAtCap: false, cityUnits: 4, economy: true, tick: 6000 };
    const calm = Spend.siloReturn(base, H);
    expect(Spend.siloReturn({ ...base, enemySilos: true }, H)).toBeGreaterThan(calm);
    expect(Spend.siloReturn({ ...base, rank: 2 }, H)).toBeGreaterThan(calm);
    expect(Spend.siloReturn({ ...base, cityUnits: 1, economy: false }, H)).toBeLessThan(calm);
    expect(Spend.siloReturn({ ...base, tick: 2000 }, H)).toBe(0);
    const sam: Spend.SamInputs = { enemySilos: false, rank: 99, tick: 3000, cityUnits: 6 };
    expect(Spend.samReturn(sam, "build", H)).toBe(0);
    expect(Spend.samReturn({ ...sam, enemySilos: true }, "build", H)).toBeGreaterThan(Spend.samReturn({ ...sam, rank: 2 }, "build", H));
    expect(Spend.samReturn({ ...sam, enemySilos: true }, "upgrade", H)).toBeLessThan(Spend.samReturn({ ...sam, enemySilos: true }, "build", H));
  });

  test("(d) escrow is subtracted exactly once, and a purpose can spend its own reservation", () => {
    const escrow: Spend.Escrow[] = [
      { purpose: "silo", amount: 1_400_000n, until: 1000 },
      { purpose: "bomb", amount: 250_000n, until: 1000 },
      { purpose: "mirv", amount: 25_000_000n, until: 1e9 },
    ];
    expect(Spend.available(30_000_000n, escrow)).toBe(30_000_000n - 26_650_000n);
    expect(Spend.available(30_000_000n, escrow, "silo")).toBe(30_000_000n - 25_250_000n);
    expect(Spend.available(1_000_000n, [])).toBe(1_000_000n);
  });

  test("ranking and the log line", () => {
    const cands: Spend.Candidate[] = [
      { kind: "build", type: UnitType.MissileSilo, cost: 1_000_000n, value: 0.4, why: "Silo" },
      { kind: "build", type: UnitType.City, cost: 125_000n, value: 1.8, why: "City" },
      { kind: "upgrade", type: UnitType.Port, cost: 125_000n, value: 1.3, why: "Port lvl" },
      { kind: "build", type: UnitType.Warship, cost: 250_000n, value: 0.1, why: "Warship" },
    ];
    expect(Spend.rankCandidates(cands).map((c) => c.why)).toEqual(["City", "Port lvl", "Silo", "Warship"]);
    expect(Spend.describeTop(cands)).toBe("City 1.8 / Port lvl 1.3 / Silo 0.4");
  });
});

describe("Economy.build with scoredSpend", () => {
  let game: Game;
  let me: Player;
  let bot: PlaybookBotExecution;
  const economy = () => (bot as unknown as { economy: { escrow: Spend.Escrow[]; candidates: Spend.Candidate[] } }).economy;

  beforeEach(async () => {
    game = await setup("ocean_and_land");
    const info = new PlayerInfo("bot", PlayerType.Human, null, "bot");
    game.addPlayer(info);
    game.addExecution(new SpawnExecution("spend_test", info, game.ref(0, 10)));
    game.executeNextTick();
    game.executeNextTick();
    me = game.player("bot");
    bot = new PlaybookBotExecution(me, { ...DEFAULT_PLAYBOOK, scoredSpend: true });
    game.addExecution(bot);
  });

  test("(a) with no partner port the first purchase is a city, and a port is not even a candidate", () => {
    me.addGold(200_000n);
    for (let i = 0; i < 12; i++) game.executeNextTick();
    expect(me.units(UnitType.City).length).toBe(1);
    expect(me.units(UnitType.Port).length).toBe(0);
    expect(economy().candidates.some((c) => c.type === UnitType.Port)).toBe(false);
    const line = bot.log.find((l) => l.includes("spend:"));
    expect(line).toBeDefined();
    expect(line).toMatch(/spend: City \d+\.\d/);
  });

  test("(d) the escrow list is applied once: available in the log equals gold minus the sum", () => {
    me.addGold(1_000_000_000n); // enough for anything; the log reports gold, escrow and avail
    for (let i = 0; i < 12; i++) game.executeNextTick();
    const line = bot.log.find((l) => l.includes("spend:"));
    expect(line).toBeDefined();
    const m = /gold (\d+)k, escrow (.*?), avail (-?\d+)k/.exec(line!)!;
    expect(m).not.toBeNull();
    const held = economy().escrow.reduce((a, e) => a + e.amount, 0n);
    expect(Number(m[3]) * 1000).toBeCloseTo(Number(m[1]) * 1000 - Number(held), -4);
    expect(economy().candidates.length).toBeGreaterThan(0);
    for (const c of economy().candidates) expect(c.value).toBeGreaterThanOrEqual(0);
  });

  test("flag off: the scored pass never runs", () => {
    const plain = new PlaybookBotExecution(me, { ...DEFAULT_PLAYBOOK });
    game.addExecution(plain);
    me.addGold(200_000n);
    for (let i = 0; i < 12; i++) game.executeNextTick();
    expect(plain.log.some((l) => l.includes("spend:"))).toBe(false);
  });
});
