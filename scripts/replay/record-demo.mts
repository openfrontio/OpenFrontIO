/**
 * Plays a game locally and writes its archived record, so the replay
 * pipeline can be tried end to end without the live API.
 *
 *   npx tsx scripts/replay/record-demo.mts [out.json] [ticks] [gameID]
 *
 * The record is stamped with this checkout's commit ($GIT_COMMIT overrides
 * it). A dev client (commit DEV) processes any record; a built one only a
 * record from its own commit.
 */

import { generateID } from "@openfront/shared/SharedUtil";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import {
  config,
  human,
  playAndArchive,
  spawnOnLand,
} from "../../tests/client/replay/util/ArchiveGame";

const [outArg, ticksArg = "1500", customGameID] = process.argv.slice(2);
const ticks = Number(ticksArg);
if (!Number.isInteger(ticks) || ticks <= 0) {
  console.error("usage: record-demo.mts [out.json] [ticks] [gameID]");
  process.exit(1);
}

const gameID =
  customGameID ??
  (outArg ? path.basename(outArg, path.extname(outArg)) : undefined) ??
  generateID();

const out = outArg ?? path.join("records", `${gameID}.json`);
const outDir = path.dirname(out);
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const commit =
  process.env.GIT_COMMIT ??
  execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

const { record } = await playAndArchive({
  gameID,
  config: config({ bots: 30 }),
  players: [human(1)],
  ticks,
  intents: (game, t) =>
    t === 3 ? [spawnOnLand(game, "client001", 250_000)] : [],
});
record.gitCommit = commit;

fs.writeFileSync(
  out,
  JSON.stringify(record, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
);
console.error(
  `wrote ${out}: ${gameID}, ${record.turns.length} turns, commit ${commit}`,
);
