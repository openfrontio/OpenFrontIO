/**
 * Plays a game locally and writes its archived record, so the replay
 * pipeline can be tried end to end without the live API.
 *
 *   npx tsx scripts/replay/record-demo.mts <out.json> [ticks] [gameID]
 *
 * The record is stamped with this checkout's commit ($GIT_COMMIT overrides
 * it). A dev client (commit DEV) processes any record; a built one only a
 * record from its own commit.
 */

import { execSync } from "child_process";
import fs from "fs";
import {
  config,
  human,
  playAndArchive,
  spawnOnLand,
} from "../../tests/client/replay/util/ArchiveGame";

const [out, ticksArg = "1500", gameID = "demoGame1"] = process.argv.slice(2);
const ticks = Number(ticksArg);
if (out === undefined || !Number.isInteger(ticks) || ticks <= 0) {
  console.error("usage: record-demo.mts <out.json> [ticks] [gameID]");
  process.exit(1);
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
