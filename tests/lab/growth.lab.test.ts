// Opening growth curves: one player alone on big_plains, different expansion schedules; logs tiles & home troops every 5 s.
import fs from "fs";
import { AttackExecution } from "../../src/core/execution/AttackExecution";
import { PlayerExecution } from "../../src/core/execution/PlayerExecution";
import { PlayerInfo, PlayerType } from "../../src/core/game/Game";
import { setup } from "../util/Setup";
import { Config } from "../../src/core/configuration/Config";
import { TestConfig } from "../util/TestConfig";
const OUT = "/private/tmp/claude-501/-Users-josh-Code-openfront/f46e4d3b-aecb-4e40-bb41-205a4bfbadb7/scratchpad/";
class C extends TestConfig {
  attackLogic(gm: any, a: number, at: any, d: any, t: any) { return Config.prototype.attackLogic.call(this, gm, a, at, d, t); }
  attackTilesPerTick(a: number, at: any, d: any, n: number) { return Config.prototype.attackTilesPerTick.call(this, a, at, d, n); }
}
test("opening curves", async () => {
  const policies: [string, (troops: number, cap: number, tick: number) => number][] = [
    ["10% every 1 s", (t, c, k) => (k % 10 === 0 ? t * 0.1 : 0)],
    ["20% every 1 s", (t, c, k) => (k % 10 === 0 ? t * 0.2 : 0)],
    ["5% every 1 s", (t, c, k) => (k % 10 === 0 ? t * 0.05 : 0)],
    ["50% every 5 s", (t, c, k) => (k % 50 === 0 ? t * 0.5 : 0)],
    ["all-in every 5 s (keep 15% cap)", (t, c, k) => (k % 50 === 0 ? Math.max(0, t - c * 0.15) : 0)],
    ["3% every 1 s", (t, c, k) => (k % 10 === 0 ? t * 0.03 : 0)],
    ["7% every 1 s", (t, c, k) => (k % 10 === 0 ? t * 0.07 : 0)],
    ["10% for 30 s, then 5%", (t, c, k) => (k % 10 === 0 ? t * (k < 300 ? 0.1 : 0.05) : 0)],
    ["15% for 20 s, then 5%", (t, c, k) => (k % 10 === 0 ? t * (k < 200 ? 0.15 : 0.05) : 0)],
    ["nothing (growth only)", () => 0],
  ];
  const out: string[] = [];
  for (const [name, pol] of policies) {
    const info = new PlayerInfo("me", PlayerType.Human, null, "me");
    const game = await setup("big_plains", {}, [info], undefined, C);
    const me = game.player("me");
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) me.conquer(game.ref(100 + dx, 100 + dy));
    me.addTroops(25000 - me.troops());
    game.addExecution(new PlayerExecution(me));
    const rows: string[] = [];
    for (let k = 0; k <= 1200; k++) {
      const cap = game.config().maxTroops(me);
      const send = Math.floor(pol(me.troops(), cap, k));
      if (send >= 100) game.addExecution(new AttackExecution(send, me, game.terraNullius().id()));
      game.executeNextTick();
      if (k % 50 === 0) rows.push(`${k / 10},${me.numTilesOwned()},${Math.round(me.troops())},${Math.round(me.troops() + me.outgoingAttacks().reduce((a, x) => a + x.troops(), 0))}`);
    }
    out.push(`== ${name}\n` + rows.join("\n"));
  }
  fs.writeFileSync(OUT + "opening_curves.txt", out.join("\n"));
}, 600000);
