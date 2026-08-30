// Spawn-feature dump: for a list of coordinates, print the picker's feature values after nations and tribes have
// placed themselves, so outcomes from sweeps can be regressed on them.  SPAWNS="x,y;x,y;..." LAB_OUT=dir OUTFILE=f.json
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, test } from "vitest";
import { NationExecution } from "../../src/core/execution/NationExecution";
import { PlaybookBotExecution } from "../../src/core/execution/playbook/PlaybookBotExecution";
import { TribeSpawner } from "../../src/core/execution/TribeSpawner";
import {
  Cell,
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Nation,
  PlayerInfo,
  PlayerType,
} from "../../src/core/game/Game";
import { createGame } from "../../src/core/game/GameImpl";
import { TileRef } from "../../src/core/game/GameMap";
import { genTerrainFromBin } from "../../src/core/game/TerrainMapLoader";
import { UserSettings } from "../../src/core/game/UserSettings";
import { GameConfig } from "../../src/core/Schemas";
import { TestConfig } from "../util/TestConfig";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("spawn features", () => {
  test("dump", async () => {
    const dir = path.join(__dirname, "../testdata/maps/world");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
    );
    const gameMap = await genTerrainFromBin(
      manifest.map,
      fs.readFileSync(path.join(dir, "map.bin")),
    );
    const miniMap = await genTerrainFromBin(
      manifest.map4x,
      fs.readFileSync(path.join(dir, "map4x.bin")),
    );
    const real = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../../resources/maps/world/manifest.json"),
        "utf8",
      ),
    );
    const nations: Nation[] = real.nations.map(
      (n: any, i: number) =>
        new Nation(
          new Cell(n.coordinates[0], n.coordinates[1]),
          new PlayerInfo(
            n.name,
            PlayerType.Nation,
            null,
            `nation_${i}`,
            false,
            null,
            [],
            null,
            n.flag ?? null,
          ),
        ),
    );
    const gameConfig: GameConfig = {
      gameMap: GameMapType.World,
      gameMapSize: GameMapSize.Normal,
      gameMode: GameMode.FFA,
      gameType: GameType.Singleplayer,
      difficulty: Difficulty.Medium,
      nations: "default",
      donateGold: false,
      donateTroops: false,
      bots: 400,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
    };
    const game = createGame(
      [],
      nations,
      gameMap,
      miniMap,
      new TestConfig(gameConfig, new UserSettings(), false),
    );
    game.addExecution(...nations.map((n) => new NationExecution("lab", n)));
    game.addExecution(
      ...new TribeSpawner(
        game,
        "lab",
        nations.map((n) => n.spawnCell!),
      ).spawnTribes(400),
    );
    for (let i = 0; i < 3; i++) game.executeNextTick();

    const nat: TileRef[] = [],
      tribes: TileRef[] = [];
    for (const p of game.players()) {
      const t = p.spawnTile();
      if (t === undefined) continue;
      if (p.type() === PlayerType.Nation) nat.push(t);
      else if (p.type() === PlayerType.Bot) tribes.push(t);
    }
    const W = game.width(),
      H = game.height();
    const out: string[] = [];
    for (const pair of (process.env.SPAWNS ?? "").split(";").filter(Boolean)) {
      const [x, y] = pair.split(",").map(Number);
      const t = game.ref(x, y);
      const md = (o: TileRef) =>
        Math.abs(game.x(o) - x) + Math.abs(game.y(o) - y);
      const nd = nat.map(md).sort((a, b) => a - b),
        td = tribes.map(md).sort((a, b) => a - b);
      let land15 = 0;
      for (let dy = -15; dy <= 15; dy += 5)
        for (let dx = -15; dx <= 15; dx += 5)
          if (
            game.isValidCoord(x + dx, y + dy) &&
            game.isLand(game.ref(x + dx, y + dy))
          )
            land15++;
      let room = 0;
      for (let dy = -50; dy <= 50; dy += 10)
        for (let dx = -50; dx <= 50; dx += 10)
          if (game.isValidCoord(x + dx, y + dy)) {
            const r = game.ref(x + dx, y + dy);
            if (game.isLand(r) && !game.hasOwner(r)) room++;
          }
      let left = false,
        right = false,
        up = false,
        down = false;
      for (const n of nat) {
        if (md(n) > 260) continue;
        if (game.x(n) < x - 60) left = true;
        if (game.x(n) > x + 60) right = true;
        if (game.y(n) < y - 60) up = true;
        if (game.y(n) > y + 60) down = true;
      }
      const f = {
        x,
        y,
        land: game.isLand(t),
        oceanShore: game.isOceanShore(t),
        nearestNation: nd[0],
        n2: nd[1],
        nations200: nd.filter((d) => d < 200).length,
        nations300: nd.filter((d) => d < 300).length,
        nations400: nd.filter((d) => d < 400).length,
        nearestTribe: td[0],
        tribes150: td.filter((d) => d < 150).length,
        tribes250: td.filter((d) => d < 250).length,
        edge: Math.min(x, y, W - x, H - y),
        land15,
        room,
        basin120: PlaybookBotExecution.basin(game, t, 120, 40000),
        basin200: PlaybookBotExecution.basin(game, t, 200, 100000),
        basin400: PlaybookBotExecution.basin(game, t, 400, 300000),
        sandwiched: (left && right) || (up && down),
      };
      out.push(JSON.stringify(f));
    }
    fs.writeFileSync(
      path.join(
        process.env.LAB_OUT ?? ".",
        process.env.OUTFILE ?? "spawnfeat.json",
      ),
      out.join("\n") + "\n",
    );
  }, 600_000);
});
