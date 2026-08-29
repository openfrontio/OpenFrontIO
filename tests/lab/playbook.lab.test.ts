// Playbook lab: runs PlaybookBotExecution against nations + tribes on the World map.
// Not a correctness test — a harness. Run: npx vitest tests/lab/playbook.lab.test.ts --run
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Config } from "../../src/core/configuration/Config";
import { NationExecution } from "../../src/core/execution/NationExecution";
import { PlaybookBotExecution, DEFAULT_PLAYBOOK, PlaybookParams } from "../../src/core/execution/playbook/PlaybookBotExecution";
import { SpawnExecution } from "../../src/core/execution/SpawnExecution";
import { TribeSpawner } from "../../src/core/execution/TribeSpawner";
import { WinCheckExecution } from "../../src/core/execution/WinCheckExecution";
import {
  Cell, Difficulty, Game, GameMapSize, GameMapType, GameMode, GameType, Nation, Player, PlayerInfo, PlayerType, TerraNullius, UnitType,
} from "../../src/core/game/Game";
import { createGame } from "../../src/core/game/GameImpl";
import { TileRef } from "../../src/core/game/GameMap";
import { genTerrainFromBin } from "../../src/core/game/TerrainMapLoader";
import { UserSettings } from "../../src/core/game/UserSettings";
import { GameConfig } from "../../src/core/Schemas";
import { TestConfig } from "../util/TestConfig";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = "/private/tmp/claude-501/-Users-josh-Code-openfront/f46e4d3b-aecb-4e40-bb41-205a4bfbadb7/scratchpad/";

class LabConfig extends TestConfig {
  attackLogic(gm: Game, a: number, at: Player, d: Player | TerraNullius, t: TileRef) { return Config.prototype.attackLogic.call(this, gm, a, at, d, t); }
  attackTilesPerTick(a: number, at: Player, d: Player | TerraNullius, n: number) { return Config.prototype.attackTilesPerTick.call(this, a, at, d, n); }
  disableNavMesh(): boolean { return false; }
  radiusPortSpawn(): number { return 20; }
  deletionMarkDuration(): number { return 300; }
  nukeMagnitudes(t: UnitType) { return Config.prototype.nukeMagnitudes.call(this, t); }
  nukeSpeed(t: UnitType) { return Config.prototype.nukeSpeed.call(this, t); }
  defaultSamRange(): number { return 70; }
  samRange(level: number): number { return Config.prototype.samRange.call(this, level); }
  defaultNukeTargetableRange(): number { return 150; }
}

async function makeWorld(difficulty: Difficulty, bots: number) {
  const dir = path.join(__dirname, "../testdata/maps/world");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const gameMap = await genTerrainFromBin(manifest.map, fs.readFileSync(path.join(dir, "map.bin")));
  const miniMap = await genTerrainFromBin(manifest.map4x, fs.readFileSync(path.join(dir, "map4x.bin")));
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, "../../resources/maps/world/manifest.json"), "utf8"));
  const nations: Nation[] = real.nations.map((n: any, i: number) => new Nation(
    new Cell(n.coordinates[0], n.coordinates[1]),
    new PlayerInfo(n.name, PlayerType.Nation, null, `nation_${i}`, false, null, [], null, n.flag ?? null),
  ));
  const gameConfig: GameConfig = {
    gameMap: GameMapType.World, gameMapSize: GameMapSize.Normal, gameMode: GameMode.FFA, gameType: GameType.Singleplayer,
    difficulty, nations: "default", donateGold: false, donateTroops: false, bots, infiniteGold: false, infiniteTroops: false, instantBuild: false, randomSpawn: false,
  };
  const config = new LabConfig(gameConfig, new UserSettings(), false);
  const game = createGame([], nations, gameMap, miniMap, config);
  return { game, nations };
}

/** Phase-0 spawn choice: coast, bots near, nations far, land around. Stays in the preferred region,
 *  relaxing the nation veto and radius in stages rather than falling back to anywhere on the map. */
function pickSpawn(game: Game, nations: Nation[], prefer: [number, number], minDist: number): TileRef {
  const bots = game.players().filter((p) => p.type() === PlayerType.Bot).map((p) => { const t = p.borderTiles().values().next().value as TileRef; return [game.x(t), game.y(t)] as [number, number]; });
  const stages: [number, number][] = [[minDist, 250], [minDist * 0.8, 300], [minDist * 0.6, 350], [minDist * 0.45, 400]];
  const dist = (x: number, y: number) => Math.hypot(x - prefer[0], y - prefer[1]);
  for (const [veto, radius] of stages) {
    let best: TileRef | null = null, bestS = -1e9;
    for (let y = 60; y < 880; y += 3) for (let x = 60; x < 1940; x += 3) { // y < 880 keeps us off Antarctica
      if (dist(x, y) > radius) continue;
      const t = game.ref(x, y);
      if (!game.isLand(t) || !game.isShore(t) || game.hasOwner(t)) continue;
      let land = 0; for (let dy = -15; dy <= 15; dy += 5) for (let dx = -15; dx <= 15; dx += 5) { if (game.isValidCoord(x + dx, y + dy) && game.isLand(game.ref(x + dx, y + dy))) land++; }
      if (land < 22) continue; // a straight coast is ~half land within 15 tiles
      let score = 0, near = 0;
      for (const n of nations) { const c = n.spawnCell!; const d = Math.abs(c.x - x) + Math.abs(c.y - y); if (d < veto) { score = -1e9; break; } if (d < 200) near += 4; else if (d < 300) near += 1; }
      if (score < -1e8) continue;
      score -= Math.min(near, 12); // crowded continents: cap so the region itself stays preferable
      for (const [bx, by] of bots) { const d = Math.abs(bx - x) + Math.abs(by - y); if (d < 150) score += 3; else if (d < 250) score += 1; }
      score -= dist(x, y) / 60; // 300 tiles from the region centre costs as much as a nation within 200
      if (score > bestS) { bestS = score; best = t; }
    }
    if (best !== null) { spawnNote = `stage veto=${Math.round(veto)} radius=${radius} score=${bestS.toFixed(1)}`; return best; }
  }
  throw new Error("no spawn near " + prefer);
}
let spawnNote = "";
function neighboursBots(me: Player): string { return me.nearby().filter((n): n is Player => n.isPlayer() && n.type() === PlayerType.Bot).map((b) => Math.round(b.troops() / 1000) + "k/" + b.numTilesOwned() + "t").join(" ") || "-"; }
async function runGame(label: string, params: PlaybookParams, minutes: number, difficulty: Difficulty, prefer: [number, number]) {
  const { game, nations } = await makeWorld(difficulty, 30);
  const gameID = "lab";
  game.addExecution(...nations.map((n) => new NationExecution(gameID, n)));
  game.addExecution(...new TribeSpawner(game, gameID, nations.map((n) => n.spawnCell!)).spawnTribes(30));
  const info = new PlayerInfo("PlaybookBot", PlayerType.Human, null, "playbook");
  game.addPlayer(info);
  // spawn phase: nations/tribes place themselves in the first ticks; we pick a spot and are placed with them
  for (let i = 0; i < 3; i++) game.executeNextTick();
  const spawn = pickSpawn(game, nations, prefer, 110);
  game.addExecution(new SpawnExecution(gameID, info, spawn));
  for (let i = 0; i < 3; i++) game.executeNextTick();
  game.endSpawnPhase();
  const me = game.player(info.id);
  const bot = new PlaybookBotExecution(me, params);
  game.addExecution(bot, new WinCheckExecution());
  const rows: string[] = [`== ${label} | spawn ${game.x(spawn)},${game.y(spawn)} (${spawnNote}) | ${difficulty} ==`];
  const ticks = minutes * 600;
  for (let t = 0; t < ticks; t++) {
    game.executeNextTick();
    if (!me.isAlive()) { rows.push(`  DEAD at ${(t / 10).toFixed(0)}s`); break; }
    if ((t + 1) % 300 === 0) {
      const rank = game.players().filter((p) => p.type() !== PlayerType.Bot).sort((a, b) => b.numTilesOwned() - a.numTilesOwned()).findIndex((p) => p === me) + 1;
      const bots = game.players().filter((p) => p.type() === PlayerType.Bot && p.isAlive()); const bt = bots.reduce((a, b) => a + b.troops(), 0) / Math.max(1, bots.length); const bl = bots.reduce((a, b) => a + b.numTilesOwned(), 0) / Math.max(1, bots.length); const nb = neighboursBots(me); rows.push(`  ${String((t + 1) / 10).padStart(4)}s bots=${bots.length} botTroops=${Math.round(bt)} botTiles=${Math.round(bl)} nearBotTroops=${nb} tiles=${String(me.numTilesOwned()).padStart(6)} troops=${String(Math.round(me.troops() / 1000)).padStart(5)}k cap=${String(Math.round(game.config().maxTroops(me) / 1000)).padStart(5)}k gold=${String(Math.round(Number(me.gold()) / 1000)).padStart(6)}k cities=${me.unitsOwned(UnitType.City)} ports=${me.unitsOwned(UnitType.Port)} dp=${me.unitsOwned(UnitType.DefensePost)} allies=${me.alliances().length} rank=${rank}/${game.players().filter((p) => p.type() !== PlayerType.Bot).length}`);
    }
  }
  rows.push(`  FINAL alive=${me.isAlive()} tiles=${me.numTilesOwned()} troops=${Math.round(me.troops()/1000)}k cities=${me.unitsOwned(UnitType.City)} ports=${me.unitsOwned(UnitType.Port)} factories=${me.unitsOwned(UnitType.Factory)} silos=${me.unitsOwned(UnitType.MissileSilo)} sams=${me.unitsOwned(UnitType.SAMLauncher)} bombs=${bot.bombs} trainGold=${Math.round(Number(me.trainGold())/1000)}k gold=${Math.round(Number(me.gold())/1000)}k`);
  rows.push("  log: " + bot.log.slice(0, 60).join(" | "));
  return rows.join("\n");
}

describe("playbook lab", () => {
  test("baseline on World vs Hard nations", async () => {
    const out: string[] = [];
    const spawns: [string, [number, number]][] = [["north-russia", [1200, 140]], ["north-america", [450, 300]], ["east-asia", [1600, 350]], ["africa", [1100, 550]], ["south-america", [620, 650]], ["australia", [1680, 660]]];
    const params: PlaybookParams = { ...DEFAULT_PLAYBOOK };
    if (process.env.EXPAND) { params.expandContested = Number(process.env.EXPAND); params.expandFree = Number(process.env.EXPAND) / 2; }
    if (process.env.EVERY) params.expandEvery = Number(process.env.EVERY);
    if (process.env.PARAMS) Object.assign(params, JSON.parse(process.env.PARAMS));
    if (process.env.ALLIN) params.openingAllIn = process.env.ALLIN === "1";
    if (process.env.KEEP) params.openingKeep = Number(process.env.KEEP);
    const minutes = process.env.MIN ? Number(process.env.MIN) : 20;
    const shift = Number(process.env.SHIFT ?? 0);
    for (const [name, pref0] of spawns) { const pref: [number, number] = [pref0[0] + shift, pref0[1] + shift]; if (process.env.SPAWN && process.env.SPAWN !== name) continue; out.push(await runGame(name, params, minutes, process.env.DIFF === "medium" ? Difficulty.Medium : Difficulty.Hard, pref)); fs.writeFileSync(OUT + (process.env.OUTFILE ?? "lab_v10.txt"), out.join("\n\n")); }
    fs.writeFileSync(OUT + "lab_baseline.txt", out.join("\n\n"));
  }, 1800000);
});
