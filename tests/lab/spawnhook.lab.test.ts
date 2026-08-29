// Reproduces the real client's start-up path (GameRunner.init → nations + tribes → bot picks spawn) and checks the nation veto.
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
import { PlaybookBotExecution } from "../../src/core/execution/playbook/PlaybookBotExecution";
import { Executor } from "../../src/core/execution/ExecutionManager";
import { Cell, Difficulty, GameMapSize, GameMapType, GameMode, GameType, Nation, PlayerInfo, PlayerType } from "../../src/core/game/Game";
import { createGame } from "../../src/core/game/GameImpl"; import { genTerrainFromBin } from "../../src/core/game/TerrainMapLoader";
import { UserSettings } from "../../src/core/game/UserSettings"; import { GameRunner } from "../../src/core/GameRunner"; import { TestConfig } from "../util/TestConfig";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = "/private/tmp/claude-501/-Users-josh-Code-openfront/f46e4d3b-aecb-4e40-bb41-205a4bfbadb7/scratchpad/spawnhook.txt";
test("client path: bot spawn respects the nation veto", async () => {
  const dir = path.join(__dirname, "../testdata/maps/world"); const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const gameMap = await genTerrainFromBin(manifest.map, fs.readFileSync(path.join(dir, "map.bin"))); const miniMap = await genTerrainFromBin(manifest.map4x, fs.readFileSync(path.join(dir, "map4x.bin")));
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, "../../resources/maps/world/manifest.json"), "utf8"));
  const nations: Nation[] = real.nations.map((n: any, i: number) => new Nation(new Cell(n.coordinates[0], n.coordinates[1]), new PlayerInfo(n.name, PlayerType.Nation, null, `nation_${i}`, false, null, [], null, null)));
  const config = new TestConfig({ gameMap: GameMapType.World, gameMapSize: GameMapSize.Normal, gameMode: GameMode.FFA, gameType: GameType.Singleplayer, difficulty: Difficulty.Hard, nations: "default", donateGold: false, donateTroops: false, bots: 400, infiniteGold: false, infiniteTroops: false, instantBuild: false, randomSpawn: false } as any, new UserSettings(), false);
  const me = new PlayerInfo("me", PlayerType.Human, "c1", "me_id");
  const game = createGame([me], nations, gameMap, miniMap, config);
  const gr = new GameRunner(game, new Executor(game, "hook", "c1"), () => {}, "c1", "hook");
  gr.init();
  const rows: string[] = [];
  for (let t = 0; t < 12; t++) {
    gr.addTurn({ turnNumber: t, intents: [] }); gr.executeNextTick();
    const placed = game.players().filter((p) => p.type() === PlayerType.Nation && p.spawnTile() !== undefined).length;
    const tribes = game.players().filter((p) => p.type() === PlayerType.Bot && p.spawnTile() !== undefined).length;
    const p = game.player("me_id");
    rows.push(`tick ${game.ticks()} nationsPlaced=${placed} tribesPlaced=${tribes} spawnPhase=${game.inSpawnPhase()} meSpawned=${p.hasSpawned()}`);
  }
  const p = game.player("me_id"); const st = p.spawnTile()!;
  let minD = 1e9, who = "";
  for (const n of game.players()) { if (n.type() !== PlayerType.Nation) continue; const t = n.spawnTile(); if (t === undefined) continue; const d = Math.abs(game.x(t) - game.x(st)) + Math.abs(game.y(t) - game.y(st)); if (d < minD) { minD = d; who = n.name(); } }
  rows.push(`spawn at ${game.x(st)},${game.y(st)}; nearest nation ${who} at ${minD}`);
  rows.push("diag: " + PlaybookBotExecution.lastSpawnDiag);
  fs.writeFileSync(OUT, rows.join("\n"));
  expect(minD).toBeGreaterThanOrEqual(50);
}, 120000);
