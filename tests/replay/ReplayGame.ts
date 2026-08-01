/**
 * Headless replay harness for archived game records.
 *
 * Re-runs the deterministic core simulation over an archived game's turns
 * (the same pipeline a client uses when watching a replay) and compares the
 * recomputed state hashes against the hashes the server recorded during the
 * live game (each recorded hash was agreed on by every active client). Any
 * mismatch means a client replaying this record would see desync errors —
 * either the record is missing simulation inputs or the code has diverged
 * from the record's gitCommit.
 *
 * Usage:
 *   npm run replay:game -- <gameID | path/to/record.json>
 *                          [--api-base https://api.openfront.io]
 *                          [--teams 0,1,0,1]
 *
 * A bare game ID is fetched from the public API. --teams overrides each
 * player's teamIndex (in player order) — useful for records archived before
 * teamIndex was preserved (see GameServer.archiveGame), where team games
 * can only replay in sync with the original assignment supplied manually.
 *
 * Exits non-zero if the replay diverges from the recorded hashes.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Config } from "../../src/core/configuration/Config";
import { Executor } from "../../src/core/execution/ExecutionManager";
import { PlayerInfo, PlayerType } from "../../src/core/game/Game";
import { createGame } from "../../src/core/game/GameImpl";
import { GameUpdateType, HashUpdate } from "../../src/core/game/GameUpdates";
import { createNationsForGame } from "../../src/core/game/NationCreation";
import { loadTerrainMap } from "../../src/core/game/TerrainMapLoader";
import { GameRunner } from "../../src/core/GameRunner";
import { PseudoRandom } from "../../src/core/PseudoRandom";
import {
  GameRecord,
  GameRecordSchema,
  GameStartInfo,
} from "../../src/core/Schemas";
import { decompressGameRecord, simpleHash } from "../../src/core/Util";
import { NodeGameMapLoader } from "../perf/fullgame/NodeGameMapLoader";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

interface Options {
  source: string;
  apiBase: string;
  teams: number[] | null;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    source: "",
    apiBase: "https://api.openfront.io",
    teams: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--api-base":
        opts.apiBase = next();
        break;
      case "--teams":
        opts.teams = next()
          .split(",")
          .map((v) => parseInt(v, 10));
        break;
      default:
        if (arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
        opts.source = arg;
    }
  }
  if (opts.source === "") {
    throw new Error("usage: replay:game -- <gameID | record.json> [options]");
  }
  return opts;
}

async function loadRecord(opts: Options): Promise<GameRecord> {
  let raw: unknown;
  if (fs.existsSync(opts.source)) {
    raw = JSON.parse(fs.readFileSync(opts.source, "utf8"));
  } else {
    const url = `${opts.apiBase}/game/${opts.source}`;
    console.log(`Fetching ${url}...`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`failed to fetch game record: HTTP ${res.status}`);
    }
    raw = await res.json();
  }
  const parsed = GameRecordSchema.safeParse(raw);
  if (!parsed.success) {
    // Older records predate schema tightenings; replay what we can.
    console.warn(
      "warning: record does not parse under the current GameRecordSchema " +
        "(old record?); replaying it as-is.",
    );
    return raw as GameRecord;
  }
  return parsed.data;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.debug = () => {}; // silence per-tick debug logging

  const record = decompressGameRecord(await loadRecord(opts));
  const info = record.info;

  let gitCommit = "unknown";
  try {
    gitCommit = execSync("git rev-parse HEAD", {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    // not a git checkout; the mismatch warning below will fire
  }
  if (record.gitCommit !== gitCommit) {
    console.warn(
      `warning: record was played on commit ${record.gitCommit}, which may ` +
        `not match the code being run. Simulation changes since that commit ` +
        `will show up as divergence.`,
    );
  }

  const players = info.players.map((p, i) => {
    if (opts.teams === null) return p;
    const teamIndex = opts.teams[i];
    if (teamIndex === undefined || Number.isNaN(teamIndex)) {
      throw new Error(`--teams must provide one index per player`);
    }
    return { ...p, teamIndex };
  });

  const gameStart: GameStartInfo = {
    gameID: info.gameID,
    lobbyCreatedAt: info.lobbyCreatedAt,
    config: info.config,
    players,
    tribes: info.tribes,
  };

  console.log(
    `Replaying ${info.gameID}: ${info.config.gameMap} ` +
      `(${info.config.gameMapSize}), ${info.config.gameMode}, ` +
      `${players.length} players, ${record.turns.length} turns`,
  );

  // Mirrors createGameRunner() with a filesystem map loader.
  const config = new Config(info.config, null, false);
  const mapLoader = new NodeGameMapLoader(
    path.join(PROJECT_ROOT, "resources/maps"),
  );
  const terrain = await loadTerrainMap(
    info.config.gameMap,
    info.config.gameMapSize,
    mapLoader,
    false,
  );
  const random = new PseudoRandom(simpleHash(gameStart.gameID));
  const humans = gameStart.players.map(
    (p) =>
      new PlayerInfo(
        p.username,
        PlayerType.Human,
        p.clientID,
        random.nextID(),
        p.isLobbyCreator ?? false,
        p.clanTag,
        p.friends ?? [],
        p.teamIndex ?? null,
      ),
  );
  const nations = createNationsForGame(
    gameStart,
    terrain.nations,
    terrain.additionalNations,
    humans.length,
    random,
  );
  const game = createGame(
    humans,
    nations,
    terrain.gameMap,
    terrain.miniGameMap,
    config,
    terrain.teamGameSpawnAreas,
  );

  const computedHashes = new Map<number, number>();
  let fatalError: string | undefined;
  const runner = new GameRunner(
    game,
    new Executor(
      game,
      gameStart.gameID,
      undefined,
      gameStart.tribes?.map((t) => t.name),
    ),
    (gu) => {
      if ("errMsg" in gu) {
        fatalError = `${gu.errMsg}\n${gu.stack ?? ""}`;
        return;
      }
      for (const hu of gu.updates[GameUpdateType.Hash] as HashUpdate[]) {
        computedHashes.set(hu.tick, hu.hash);
      }
    },
  );
  runner.init();

  const recordedHashes = new Map<number, number>();
  for (const turn of record.turns) {
    if (turn.hash !== null && turn.hash !== undefined) {
      recordedHashes.set(turn.turnNumber, turn.hash);
    }
  }
  if (recordedHashes.size === 0) {
    throw new Error("record contains no hashes to verify against");
  }

  const start = performance.now();
  let firstMismatch: number | null = null;
  let matches = 0;
  let compared = 0;
  for (const turn of record.turns) {
    runner.addTurn(turn);
    if (!runner.executeNextTick()) {
      console.error(`tick failed at turn ${turn.turnNumber}:\n${fatalError}`);
      process.exitCode = 1;
      break;
    }
    const computed = computedHashes.get(turn.turnNumber);
    const recorded = recordedHashes.get(turn.turnNumber);
    if (computed !== undefined && recorded !== undefined) {
      compared++;
      if (computed === recorded) {
        matches++;
      } else if (firstMismatch === null) {
        firstMismatch = turn.turnNumber;
        console.log(
          `FIRST MISMATCH at turn ${turn.turnNumber}: ` +
            `computed ${computed}, recorded ${recorded}`,
        );
      }
    }
  }

  console.log(
    `Compared ${compared} hash checkpoints in ` +
      `${((performance.now() - start) / 1000).toFixed(1)}s: ` +
      `${matches} match, ${compared - matches} mismatch.`,
  );
  if (firstMismatch === null) {
    console.log("Replay is IN SYNC with the recorded game.");
  } else {
    console.log(`Replay DIVERGED starting at turn ${firstMismatch}.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
