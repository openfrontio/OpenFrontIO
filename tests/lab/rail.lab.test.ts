// Rail-network lab: measures train income for different network shapes in the real engine.
// Run: npx vitest tests/lab/rail.lab.test.ts --run
import fs from "fs";
import { CityExecution } from "../../src/core/execution/CityExecution";
import { FactoryExecution } from "../../src/core/execution/FactoryExecution";
import { Game, Player, PlayerInfo, PlayerType, UnitType } from "../../src/core/game/Game";
import { setup } from "../util/Setup";

const OUT = "/private/tmp/claude-501/-Users-josh-Code-openfront/f46e4d3b-aecb-4e40-bb41-205a4bfbadb7/scratchpad/";
type P = [number, number];
type Spec = { name: string; factories: { at: P; level?: number; owner?: "me" | "ally" | "other"; late?: boolean }[]; cities: { at: P; owner?: "me" | "ally" | "other" }[]; minutes?: number };

function own(game: Game, p: Player, [x, y]: P, r = 3) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (game.isValidCoord(x + dx, y + dy)) p.conquer(game.ref(x + dx, y + dy));
}

async function run(spec: Spec): Promise<string> {
  const me = new PlayerInfo("me", PlayerType.Human, null, "me");
  const ally = new PlayerInfo("ally", PlayerType.Human, null, "ally");
  const other = new PlayerInfo("other", PlayerType.Human, null, "other");
  const game = await setup("big_plains", { instantBuild: true }, [me, ally, other]);
  const P = { me: game.player("me"), ally: game.player("ally"), other: game.player("other") };
  // everyone owns some land; me owns the whole map by default
  for (let y = 0; y < 200; y += 1) for (let x = 0; x < 200; x += 1) P.me.conquer(game.ref(x, y));
  own(game, P.ally, [5, 190]); own(game, P.other, [190, 5]);
  const req = P.ally.createAllianceRequest(P.me); req?.accept();
  game.executeNextTick();
  const all = [...spec.factories.filter((f) => !f.late).map((f) => ({ ...f, kind: "F" as const })), ...spec.cities.map((c) => ({ ...c, kind: "C" as const })), ...spec.factories.filter((f) => f.late).map((f) => ({ ...f, kind: "F" as const }))];
  // build in listed order: factories first, then cities
  for (const s of all) {
    const o = P[s.owner ?? "me"];
    if (o !== P.me) own(game, o, s.at);
    const tile = game.ref(s.at[0], s.at[1]);
    const t = s.kind === "F" ? UnitType.Factory : UnitType.City;
    const u = o.buildUnit(t, tile, {});
    for (let i = 1; i < ((s as any).level ?? 1); i++) u.increaseLevel();
    game.addExecution(s.kind === "F" ? new FactoryExecution(u) : new CityExecution(u));
    game.executeNextTick(); game.executeNextTick();
  }
  const minutes = spec.minutes ?? 30;
  const g0 = { me: P.me.trainGold(), ally: P.ally.trainGold(), other: P.other.trainGold() };
  const seen = new Set<number>(); let trains = 0;
  for (let i = 0; i < minutes * 600; i++) { game.executeNextTick(); for (const u of game.units(UnitType.Train)) { if (!seen.has(u.id())) { seen.add(u.id()); if (u.trainType() === "Engine") trains++; } } }
  const d = (k: keyof typeof P) => Number(P[k].trainGold() - g0[k]) / (minutes * 60);
  const stations = game.railNetwork().stationManager().getAll();
  let rails = 0; for (const s of stations) rails += s.getRailroads().size; rails /= 2;
  return `${spec.name.padEnd(28)} me=${Math.round(d("me")).toString().padStart(6)}/s ally=${Math.round(d("ally")).toString().padStart(6)}/s other=${Math.round(d("other")).toString().padStart(6)}/s  stations=${stations.size} rails=${rails} trains/min=${(trains / minutes).toFixed(2)}`;
}


describe("rail lab", () => {
  test("network shapes", async () => {
    const H = (xs: number[], owner?: "me" | "ally" | "other") => xs.map((x) => ({ at: [x, 100] as P, owner }));
    const specs: Spec[] = [
      { name: "snap line 7 (sp16)", factories: [{ at: [20, 100] }], cities: H([128, 36, 52, 68, 84, 100, 116]) },
      { name: "cities first (sp20), then F", factories: [{ at: [20, 100], late: true }], cities: H([40, 60, 80, 100, 120]) },
      { name: "cities first (sp16 x7), then F", factories: [{ at: [20, 100], late: true }], cities: H([36, 52, 68, 84, 100, 116, 128]) },
      { name: "3F line 150, 8 inserted", factories: [{ at: [20, 100] }, { at: [170, 100] }, { at: [95, 100] }], cities: H([36, 52, 68, 84, 111, 127, 143, 158]) },
      { name: "2F line 150, 8 inserted", factories: [{ at: [20, 100] }, { at: [170, 100] }], cities: H([36, 52, 68, 84, 100, 116, 132, 148]) },
      { name: "1F line, 8 cities, F middle-ish", factories: [{ at: [95, 100] }], cities: [...H([180, 10]), ...H([26, 42, 58, 74, 116, 132, 148, 164])] },
      { name: "snap7 + 1 port-like far city lvl", factories: [{ at: [20, 100], level: 4 }], cities: H([128, 36, 52, 68, 84, 100, 116]) },
      { name: "snap7 F6", factories: [{ at: [20, 100], level: 6 }], cities: H([128, 36, 52, 68, 84, 100, 116]) },
      { name: "snap7 F8", factories: [{ at: [20, 100], level: 8 }], cities: H([128, 36, 52, 68, 84, 100, 116]) },
      { name: "snap7 F15", factories: [{ at: [20, 100], level: 15 }], cities: H([128, 36, 52, 68, 84, 100, 116]) },
      { name: "snap7 F20", factories: [{ at: [20, 100], level: 20 }], cities: H([128, 36, 52, 68, 84, 100, 116]) },
      { name: "snap7 2xF1 same end", factories: [{ at: [20, 100] }, { at: [20, 80] }], cities: H([128, 36, 52, 68, 84, 100, 116]) },
      { name: "hub4 (1 stop each)", factories: [{ at: [100, 100] }], cities: [{ at: [130, 100] }, { at: [100, 130] }, { at: [70, 100] }, { at: [100, 70] }] },
      { name: "4 arms x 2 (star)", factories: [{ at: [100, 100] }], cities: [{ at: [130, 100] }, { at: [100, 130] }, { at: [70, 100] }, { at: [100, 70] }, { at: [160, 100] }, { at: [100, 160] }, { at: [40, 100] }, { at: [100, 40] }] },
      { name: "2 arms x 4 (F middle)", factories: [{ at: [100, 100] }], cities: H([10, 190, 26, 42, 58, 74, 126, 142, 158, 174]) },
    ];


    const out: string[] = [];
    for (const s of specs) { const r = await run(s); out.push(r); fs.writeFileSync(OUT + "rail_lab.txt", out.join("\n")); }
  }, 3600000);
});
