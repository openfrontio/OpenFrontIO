// Port-scaling lab: how port income scales with port count when the map's trade-ship pool saturates.
// Run: npx vitest tests/lab/ports.lab.test.ts --run
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PortExecution } from "../../src/core/execution/PortExecution";
import { Game, GameMapSize, GameMapType, Player, PlayerInfo, PlayerType, UnitType } from "../../src/core/game/Game";
import { createGame } from "../../src/core/game/GameImpl";
import { TileRef } from "../../src/core/game/GameMap";
import { genTerrainFromBin } from "../../src/core/game/TerrainMapLoader";
import { UserSettings } from "../../src/core/game/UserSettings";
import { TestConfig } from "../util/TestConfig";
import { Difficulty, GameMode, GameType } from "../../src/core/game/Game";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = "/private/tmp/claude-501/-Users-josh-Code-openfront/f46e4d3b-aecb-4e40-bb41-205a4bfbadb7/scratchpad/";

class LabConfig extends TestConfig { disableNavMesh() { return false; } proximityBonusPortsNb(n: number) { return Math.min(Math.max(n / 3, 4), n); } }

async function world(): Promise<Game> {
  const dir = path.join(__dirname, "../testdata/maps/world");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const gameMap = await genTerrainFromBin(manifest.map, fs.readFileSync(path.join(dir, "map.bin")));
  const miniMap = await genTerrainFromBin(manifest.map4x, fs.readFileSync(path.join(dir, "map4x.bin")));
  const config = new LabConfig({ gameMap: GameMapType.World, gameMapSize: GameMapSize.Normal, gameMode: GameMode.FFA, gameType: GameType.Singleplayer, difficulty: Difficulty.Medium, nations: "default", donateGold: false, donateTroops: false, bots: 0, infiniteGold: false, infiniteTroops: false, instantBuild: true, randomSpawn: false }, new UserSettings(), false);
  const A = new PlayerInfo("A", PlayerType.Human, null, "A"), B = new PlayerInfo("B", PlayerType.Human, null, "B"), C = new PlayerInfo("C", PlayerType.Human, null, "C");
  const game = createGame([A, B, C], [], gameMap, miniMap, config);
  game.endSpawnPhase();
  return game;
}

function shoreTiles(game: Game, p: Player, x0: number, x1: number, spacing: number): TileRef[] {
  const out: TileRef[] = [];
  for (let y = 100; y < 900; y += 2) for (let x = x0; x < x1; x += 2) {
    const t = game.ref(x, y);
    if (!game.isLand(t) || !game.isShore(t) || game.owner(t) !== p) continue;
    // must touch ocean (a water component with many tiles): approximate by requiring water neighbour
    if (out.every((o) => Math.abs(game.x(o) - x) + Math.abs(game.y(o) - y) >= spacing)) out.push(t);
  }
  return out;
}

async function run(label: string, myPorts: number, myLevel: number, theirPorts: number, minutes = 5) {
  const game = await world();
  const A = game.player("A"), B = game.player("B"), C = game.player("C");
  for (let y = 0; y < 1000; y++) for (let x = 0; x < 2000; x++) { const t = game.ref(x, y); if (!game.isLand(t)) continue; if (x < 700) A.conquer(t); else if (x > 1350) C.conquer(t); else if (x > 850) B.conquer(t); }
  const build = (p: Player, n: number, lvl: number, x0: number, x1: number) => {
    const tiles = shoreTiles(game, p, x0, x1, 40);
    let built = 0;
    for (const t of tiles) { if (built >= n) break; const u = p.buildUnit(UnitType.Port, t, {}); for (let i = 1; i < lvl; i++) u.increaseLevel(); game.addExecution(new PortExecution(u)); built++; }
    return built;
  };
  const a = build(A, myPorts, myLevel, 100, 700), b = build(B, theirPorts, 1, 850, 1350) + build(C, theirPorts, 1, 1350, 1950);
  const g0 = A.gold(), h0 = B.gold(), c0 = C.gold(); let ships = 0; const ticks = minutes * 600;
  for (let i = 0; i < ticks; i++) { game.executeNextTick(); if (i % 50 === 0) ships += game.unitCount(UnitType.TradeShip); }
  const inc = (g: bigint, g1: bigint) => (Number(g1 - g) - 100 * ticks) / (minutes * 60);
  return `${label.padEnd(30)} myPorts=${a}x${myLevel} theirs=${b}  A=${Math.round(inc(g0, A.gold())).toString().padStart(8)}/s  B=${Math.round(inc(h0, B.gold())).toString().padStart(8)}/s  C=${Math.round(inc(c0, C.gold())).toString().padStart(8)}/s  ships~${Math.round(ships / (ticks / 50))}`;
}

describe("ports lab", () => {
  test("port count scaling", async () => {
    const out: string[] = [];
    const cases: [string, number, number, number][] = [
      ["0 ports vs 40+40", 0, 1, 40], ["5 vs 40+40", 5, 1, 40], ["10 vs 40+40", 10, 1, 40], ["20 vs 40+40", 20, 1, 40], ["40 vs 40+40", 40, 1, 40], ["80 vs 40+40", 80, 1, 40],
      ["40 lv2 vs 40+40", 40, 2, 40], ["40 lv4 vs 40+40", 40, 4, 40], ["20 lv4 vs 40+40", 20, 4, 40],
      ["10 vs 10+10", 10, 1, 10], ["20 vs 10+10", 20, 1, 10], ["40 vs 10+10", 40, 1, 10], ["80 vs 10+10", 80, 1, 10],
    ];

    for (const c of cases) { out.push(await run(...c)); fs.writeFileSync(OUT + "ports_lab.txt", out.join("\n")); }
  }, 3600000);
});
