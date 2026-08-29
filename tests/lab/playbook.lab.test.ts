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
const OUT = process.env.LAB_OUT ? process.env.LAB_OUT.replace(/\/?$/, "/") : "/private/tmp/claude-501/-Users-josh-Code-openfront/f46e4d3b-aecb-4e40-bb41-205a4bfbadb7/scratchpad/";

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

let spawnNote = "";
function pickSpawn(game: Game, _nations: Nation[], prefer: [number, number], _minDist: number): TileRef {
  // SPAWNRANK=k takes the k-th best spot in the region (each pick excludes a 120-tile circle around the earlier ones)
  const rank = Number(process.env.SPAWNRANK ?? 0);
  const exclude: [number, number][] = [];
  let t: TileRef | null = null;
  for (let i = 0; i <= rank; i++) { t = PlaybookBotExecution.pickSpawn(game, prefer, exclude); if (t === null) break; exclude.push([game.x(t), game.y(t)]); }
  if (t === null) throw new Error("no spawn near " + prefer);
  spawnNote = `bot picker rank ${rank}`;
  return t;
}
function neighboursBots(me: Player): string { return me.nearby().filter((n): n is Player => n.isPlayer() && n.type() === PlayerType.Bot).map((b) => Math.round(b.troops() / 1000) + "k/" + b.numTilesOwned() + "t").join(" ") || "-"; }
async function runGame(label: string, params: PlaybookParams, minutes: number, difficulty: Difficulty, prefer: [number, number]) {
  const tribes = process.env.TRIBES ? Number(process.env.TRIBES) : 400; // online default
  const { game, nations } = await makeWorld(difficulty, tribes);
  const gameID = "lab";
  game.addExecution(...nations.map((n) => new NationExecution(gameID, n)));
  game.addExecution(...new TribeSpawner(game, gameID, nations.map((n) => n.spawnCell!)).spawnTribes(tribes));
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
  let botMs = 0; const origTick = bot.tick.bind(bot); bot.tick = (t: number) => { const s0 = performance.now(); origTick(t); botMs += performance.now() - s0; };
  game.addExecution(bot, new WinCheckExecution());
  const rec: { w: number; h: number; s: number; frames: { t: number; rle: number[]; players: (string | number)[][] }[]; land: number[] } | null = process.env.RECORD ? { w: Math.ceil(game.width() / 4), h: Math.ceil(game.height() / 4), s: 4, frames: [], land: [] } : null;
  if (rec) { const land: number[] = []; let run = 0, cur = -1; for (let y = 0; y < game.height(); y += 4) for (let x = 0; x < game.width(); x += 4) { const v = game.isLand(game.ref(x, y)) ? 1 : 0; if (v === cur) run++; else { if (cur >= 0) land.push(cur, run); cur = v; run = 1; } } land.push(cur, run); rec.land = land; }
  const snapshot = (t: number) => {
    if (!rec) return;
    const rle: number[] = []; let run = 0, cur = -1;
    for (let y = 0; y < game.height(); y += 4) for (let x = 0; x < game.width(); x += 4) { const v = game.ownerID(game.ref(x, y)); if (v === cur) run++; else { if (cur >= 0) rle.push(cur, run); cur = v; run = 1; } }
    rle.push(cur, run);
    const players = game.players().filter((p) => p.isAlive()).map((p) => [p.smallID(), p.name(), p.type() === PlayerType.Bot ? "B" : p.type() === PlayerType.Nation ? "N" : "H", p.numTilesOwned(), Math.round(p.troops()), p.unitsOwned(UnitType.City), p.unitsOwned(UnitType.Port), me.isFriendly(p) && p !== me ? 1 : 0] as (string | number)[]);
    rec.frames.push({ t, rle, players });
  };
  const rows: string[] = [`== ${label} | spawn ${game.x(spawn)},${game.y(spawn)} (${spawnNote}) | ${difficulty} ==`];
  const ticks = minutes * 600;
  let allMs = 0;
  for (let t = 0; t < ticks; t++) {
    const s0 = performance.now(); game.executeNextTick(); allMs += performance.now() - s0;
    if (!me.isAlive()) { rows.push(`  DEAD at ${(t / 10).toFixed(0)}s`); break; }
    if ((t + 1) % 300 === 0) {
      snapshot(t + 1);
      const rank = game.players().filter((p) => p.type() !== PlayerType.Bot).sort((a, b) => b.numTilesOwned() - a.numTilesOwned()).findIndex((p) => p === me) + 1;
      const bots = game.players().filter((p) => p.type() === PlayerType.Bot && p.isAlive()); const bt = bots.reduce((a, b) => a + b.troops(), 0) / Math.max(1, bots.length); const bl = bots.reduce((a, b) => a + b.numTilesOwned(), 0) / Math.max(1, bots.length); const nb = neighboursBots(me); rows.push(`  ${String((t + 1) / 10).padStart(4)}s bots=${bots.length} botTroops=${Math.round(bt)} botTiles=${Math.round(bl)} nearBotTroops=${nb} tiles=${String(me.numTilesOwned()).padStart(6)} troops=${String(Math.round(me.troops() / 1000)).padStart(5)}k cap=${String(Math.round(game.config().maxTroops(me) / 1000)).padStart(5)}k gold=${String(Math.round(Number(me.gold()) / 1000)).padStart(6)}k cities=${me.unitsOwned(UnitType.City)} ports=${me.unitsOwned(UnitType.Port)} dp=${me.unitsOwned(UnitType.DefensePost)} allies=${me.alliances().length} rank=${rank}/${game.players().filter((p) => p.type() !== PlayerType.Bot).length}`);
    }
  }
  const ranked = game.players().filter((p) => p.type() !== PlayerType.Bot && p.isAlive()).sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
  const rank = ranked.findIndex((p) => p === me) + 1; const leader = ranked[0]?.numTilesOwned() ?? 1;
  rows.push(`  FINAL rank=${rank || 99} share=${(me.numTilesOwned() / Math.max(1, leader)).toFixed(2)} botMs=${Math.round(botMs)} gameMs=${Math.round(allMs)} alive=${me.isAlive()} tiles=${me.numTilesOwned()} troops=${Math.round(me.troops()/1000)}k cities=${me.unitsOwned(UnitType.City)} ports=${me.unitsOwned(UnitType.Port)} factories=${me.unitsOwned(UnitType.Factory)} silos=${me.unitsOwned(UnitType.MissileSilo)} sams=${me.unitsOwned(UnitType.SAMLauncher)} bombs=${bot.bombs} trainGold=${Math.round(Number(me.trainGold())/1000)}k gold=${Math.round(Number(me.gold())/1000)}k`);
  rows.push("  log: " + bot.log.join(" | "));
  if (rec) { snapshot(game.ticks()); fs.writeFileSync(OUT + `rec_${(process.env.TAG ?? "x")}_${label}.json`, JSON.stringify({ label, difficulty, me: me.smallID(), spawn: [game.x(spawn), game.y(spawn)], log: bot.log, rows, ...rec })); }
  return rows.join("\n");
}

describe("playbook lab", () => {
  test("baseline on World vs Hard nations", async () => {
    const out: string[] = [];
    const spawns: [string, [number, number]][] = [["north-russia", [1200, 140]], ["north-america", [450, 300]], ["east-asia", [1600, 350]], ["africa", [1100, 550]], ["south-america", [620, 650]], ["australia", [1680, 660]]];
    const params: PlaybookParams = { ...DEFAULT_PLAYBOOK };
    if (process.env.EXPAND) { params.expandContested = Number(process.env.EXPAND); params.expandFree = Number(process.env.EXPAND) / 2; }
    if (process.env.EVERY) params.expandEvery = Number(process.env.EVERY);
    if (process.env.PARAMS) { const o = JSON.parse(process.env.PARAMS); Object.assign(params, o); if (o.spawnInland !== undefined) DEFAULT_PLAYBOOK.spawnInland = o.spawnInland; }
    if (process.env.ALLIN) params.openingAllIn = process.env.ALLIN === "1";
    if (process.env.KEEP) params.openingKeep = Number(process.env.KEEP);
    const minutes = process.env.MIN ? Number(process.env.MIN) : 20;
    const shift = Number(process.env.SHIFT ?? 0);
    for (const [name, pref0] of spawns) { const pref: [number, number] = [pref0[0] + shift, pref0[1] + shift]; if (process.env.SPAWN && process.env.SPAWN !== name) continue; out.push(await runGame(name, params, minutes, process.env.DIFF === "medium" ? Difficulty.Medium : Difficulty.Hard, pref)); fs.writeFileSync(OUT + (process.env.OUTFILE ?? "lab_v10.txt"), out.join("\n\n")); }
    fs.writeFileSync(OUT + "lab_baseline.txt", out.join("\n\n"));
  }, 1800000);
});
