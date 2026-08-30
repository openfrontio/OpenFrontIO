// B1: the attack estimator against real AttackExecutions on big_plains.
// Two players split the 200x200 map down the middle; the attacker launches a war with the numbers the
// estimator was asked about, the game runs until the attack ends (or 3000 ticks), and the estimate's
// tilesTaken / attackerLoss must land within 15 % of what actually happened.
import { Config } from "../../src/core/configuration/Config";
import { AttackExecution } from "../../src/core/execution/AttackExecution";
import { estimateAttack } from "../../src/core/execution/playbook/Estimate";
import { SpawnExecution } from "../../src/core/execution/SpawnExecution";
import { Game, Player, PlayerInfo, PlayerType, TerraNullius, UnitType } from "../../src/core/game/Game";
import { TileRef } from "../../src/core/game/GameMap";
import { setup } from "../util/Setup";
import { TestConfig } from "../util/TestConfig";

/** TestConfig stubs both attack formulas; the estimator is only meaningful against the real ones. */
class RealAttackConfig extends TestConfig {
  attackLogic(gm: Game, a: number, at: Player, d: Player | TerraNullius, t: TileRef) { return Config.prototype.attackLogic.call(this, gm, a, at, d, t); }
  attackTilesPerTick(a: number, at: Player, d: Player | TerraNullius, n: number) { return Config.prototype.attackTilesPerTick.call(this, a, at, d, n); }
}

const HORIZON = 3000;

async function twoPlayers(attackerTroops: number, defenderTroops: number) {
  const game = await setup("big_plains", {}, [], undefined, RealAttackConfig);
  const ai = new PlayerInfo("attacker", PlayerType.Human, null, "attacker_id");
  const di = new PlayerInfo("defender", PlayerType.Human, null, "defender_id");
  game.addPlayer(ai);
  game.addPlayer(di);
  game.addExecution(new SpawnExecution("g", ai, game.ref(50, 100)), new SpawnExecution("g", di, game.ref(150, 100)));
  game.executeNextTick();
  game.executeNextTick();
  const attacker = game.player(ai.id);
  const defender = game.player(di.id);
  // west half to the attacker, east half to the defender
  for (let y = 0; y < game.height(); y++) for (let x = 0; x < game.width(); x++) {
    const t = game.ref(x, y);
    if (!game.isLand(t)) continue;
    (x < 100 ? attacker : defender).conquer(t);
  }
  const setTroops = (p: Player, n: number) => { p.removeTroops(p.troops()); p.addTroops(n); };
  setTroops(attacker, attackerTroops);
  setTroops(defender, defenderTroops);
  return { game, attacker, defender };
}

/** Launch the real attack and follow it to its end: tiles the defender lost and troops the wave lost. */
function runReal(game: Game, attacker: Player, defender: Player, troops: number) {
  const tiles0 = defender.numTilesOwned();
  game.addExecution(new AttackExecution(troops, attacker, defender.id()));
  let last = troops, ticks = 0;
  for (; ticks < HORIZON; ticks++) {
    game.executeNextTick();
    const a = attacker.outgoingAttacks()[0];
    if (!a) break;
    last = a.troops();
  }
  return { tilesTaken: tiles0 - defender.numTilesOwned(), attackerLoss: troops - last, ticks, defenderTroops: defender.troops() };
}

function within15(est: number, real: number) {
  const err = Math.abs(est - real) / Math.max(1, real);
  return { ok: err <= 0.15, err };
}

describe("estimateAttack", () => {
  test.each([
    ["no posts", 100_000, 60_000, false],
    ["posts on the shared border", 100_000, 60_000, true],
    ["defender with twice our troops", 50_000, 100_000, false],
    ["attacker wins through a thin defender", 650_000, 20_000, false],
  ])("%s: within 15 %% of a real AttackExecution", async (_name, send, defend, posts) => {
    const { game, attacker, defender } = await twoPlayers(send * 3, defend);
    if (posts) for (const y of [25, 75, 125, 175]) expect(defender.buildUnit(UnitType.DefensePost, game.ref(105, y), {})).toBeTruthy();
    const est = estimateAttack(game, attacker, defender, send, { horizonTicks: HORIZON });
    const real = runReal(game, attacker, defender, send);
    const tiles = within15(est.tilesTaken, real.tilesTaken);
    const loss = within15(est.attackerLoss, real.attackerLoss);
    console.log(`${_name}: est ${est.tilesTaken}t/${Math.round(est.attackerLoss)} lost in ${est.ticks} ticks (wins=${est.wins}) vs real ${real.tilesTaken}t/${Math.round(real.attackerLoss)} in ${real.ticks} ticks — err tiles ${(tiles.err * 100).toFixed(1)} %, loss ${(loss.err * 100).toFixed(1)} %`);
    expect(tiles.ok).toBe(true);
    expect(loss.ok).toBe(true);
    if (posts) expect(est.attackerLoss / Math.max(1, est.tilesTaken)).toBeGreaterThan(30); // posts make every tile dear
    if (_name.startsWith("attacker wins")) { expect(est.wins).toBe(true); expect(defender.isAlive()).toBe(false); }
  }, 120_000);

  test("is pure: game state is untouched and repeated calls agree", async () => {
    const { game, attacker, defender } = await twoPlayers(300_000, 60_000);
    const before = [attacker.troops(), defender.troops(), attacker.numTilesOwned(), defender.numTilesOwned(), game.ticks()];
    const a = estimateAttack(game, attacker, defender, 100_000);
    const b = estimateAttack(game, attacker, defender, 100_000);
    expect(a).toEqual(b);
    expect([attacker.troops(), defender.troops(), attacker.numTilesOwned(), defender.numTilesOwned(), game.ticks()]).toEqual(before);
    expect(attacker.outgoingAttacks()).toHaveLength(0);
  });

  test("more troops win sooner; a tiny wave does not win", async () => {
    const { game, attacker, defender } = await twoPlayers(600_000, 60_000);
    const small = estimateAttack(game, attacker, defender, 5_000, { horizonTicks: 20 });
    const big = estimateAttack(game, attacker, defender, 200_000, { horizonTicks: 20 });
    expect(small.wins).toBe(false);
    expect(small.troopsLeft).toBeLessThan(5_000);
    expect(big.tilesTaken).toBeGreaterThan(small.tilesTaken);
    expect(big.troopsLeft).toBeGreaterThan(small.troopsLeft);
    // a horizon of zero examines nothing
    const none = estimateAttack(game, attacker, defender, 100_000, { horizonTicks: 0 });
    expect(none.tilesTaken).toBe(0);
    expect(none.attackerLoss).toBe(0);
  });
});
