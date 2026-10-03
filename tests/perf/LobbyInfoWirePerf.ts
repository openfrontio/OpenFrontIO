import Benchmark from "benchmark";
import { Progress } from "../../src/core/ApiSchemas";
import {
  ClientInfo,
  ServerLobbyInfoMessage,
  ServerMessage,
} from "../../src/core/Schemas";
import {
  decodeServerMessage,
  encodeServerMessage,
} from "../../src/core/ZbinWire";
import * as LevelBadgeModule from "../../src/server/LevelBadge";
import { testGameConfig } from "../util/Wire";

/**
 * Cost of the lobby roster's level badges on the lobby_info broadcast.
 *
 * While a game is in its lobby the server sends every connected client a
 * lobby_info frame once a second (GameServer.broadcastLobbyInfo), encoding it
 * once PER RECIPIENT — so one broadcast of an N-player lobby is N encodes of
 * an N-entry roster. This measures, for 10 / 50 / 150 clients:
 *
 *   - the encoded frame size with no badges and with a badge on every entry
 *     (the worst case: everyone signed in, progression on, nobody hidden);
 *   - the time to encode one frame, and so one whole broadcast (x N);
 *   - the time a client takes to decode one frame.
 *
 * Plus a microbenchmark of the join-time badge stamping (levelBadgeFromProgress,
 * and levelBadgeForPlayer with the "hide my level" check when present).
 *
 * The lobby is not yet started, so the server encodes with no zbin context
 * (zbinCtx is undefined until start): clientIDs go out as plain strings.
 *
 * Usage: npx tsx tests/perf/LobbyInfoWirePerf.ts
 */

// Deterministic data: a tiny LCG, so every run (and branch) encodes the same
// rosters.
let seed = 0x5eed;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
}
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function word(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += ALNUM[Math.floor(rand() * ALNUM.length)];
  return s;
}

function roster(n: number, withBadges: boolean): ClientInfo[] {
  seed = 0x5eed + n;
  const ids = Array.from({ length: n }, () => word(8));
  return ids.map((clientID, i) => {
    const c: ClientInfo = {
      clientID,
      username: word(6 + Math.floor(rand() * 9)),
      // Roughly a third in a clan, a quarter verified, a few friends here and
      // there — the shape NameVisibility.lobbyClients sends with names on.
      clanTag: rand() < 0.33 ? word(2 + Math.floor(rand() * 4)) : null,
    };
    if (rand() < 0.25) c.verified = true;
    if (rand() < 0.1) c.friends = [ids[(i + 1) % n]];
    // Drawn for every entry either way, so both rosters consume the same
    // random numbers and differ ONLY in the badges.
    const badge =
      rand() < 0.01
        ? { level: 100, prestige: 10, legend: true }
        : {
            level: 1 + Math.floor(rand() * 100),
            prestige: Math.floor(rand() * 11),
            legend: false,
          };
    if (withBadges) c.levelBadge = badge;
    return c;
  });
}

function lobbyInfo(clients: ClientInfo[]): ServerMessage {
  return {
    type: "lobby_info",
    lobby: {
      gameID: "AbCdEfGh",
      clients,
      lobbyCreatorClientID: clients[0]?.clientID,
      serverTime: 1_790_000_000_000,
      gameConfig: testGameConfig({ maxPlayers: 150 }),
    },
    myClientID: clients[0]?.clientID ?? "AbCdEfGh",
    groupToken: "0123456789abcdef0123456789abcdef",
  } satisfies ServerLobbyInfoMessage;
}

function fmtUs(seconds: number): string {
  return seconds < 1e-6
    ? `${(seconds * 1e9).toFixed(1)} ns`
    : `${(seconds * 1e6).toFixed(2)} µs`;
}

function bench(name: string, fn: () => void): Benchmark {
  const b = new Benchmark(name, fn, { minSamples: 40 });
  b.run({ async: false });
  return b;
}

console.log("=== lobby_info frame size (bytes) ===");
console.log("clients | no badges | all badges | delta | delta/entry");
for (const n of [10, 50, 150]) {
  const plain = encodeServerMessage(lobbyInfo(roster(n, false)), undefined);
  const badged = encodeServerMessage(lobbyInfo(roster(n, true)), undefined);
  const delta = badged.byteLength - plain.byteLength;
  console.log(
    `${String(n).padStart(7)} | ${String(plain.byteLength).padStart(9)} | ${String(
      badged.byteLength,
    ).padStart(10)} | ${String(delta).padStart(5)} | ${(delta / n).toFixed(2)}`,
  );
}

console.log("\n=== encode / decode time (benchmark.js, mean ± rme) ===");
console.log(
  "clients | badges | encode 1 frame | broadcast (x N) | decode 1 frame",
);
for (const n of [10, 50, 150]) {
  for (const withBadges of [false, true]) {
    const msg = lobbyInfo(roster(n, withBadges));
    const bytes = encodeServerMessage(msg, undefined);
    const enc = bench(`encode ${n} ${withBadges}`, () => {
      encodeServerMessage(msg, undefined);
    });
    const dec = bench(`decode ${n} ${withBadges}`, () => {
      decodeServerMessage(bytes, undefined);
    });
    console.log(
      `${String(n).padStart(7)} | ${(withBadges ? "yes" : "no").padStart(6)} | ${fmtUs(
        enc.stats.mean,
      ).padStart(10)} ±${enc.stats.rme.toFixed(1)}% | ${(
        (enc.stats.mean * n * 1e3).toFixed(3) + " ms"
      ).padStart(
        15,
      )} | ${fmtUs(dec.stats.mean).padStart(10)} ±${dec.stats.rme.toFixed(1)}%`,
    );
  }
}

console.log("\n=== join-time badge stamping (per join) ===");
const progress: Progress = {
  prestige: 3,
  level: 57,
  xpInLevel: 120,
  xpForNext: 900,
  lifetimeXp: 1_234_567,
  legend: false,
  canPrestige: false,
};
let sink: unknown;
const fromProgress = bench("levelBadgeFromProgress", () => {
  sink = LevelBadgeModule.levelBadgeFromProgress(progress);
});
console.log(
  `levelBadgeFromProgress(progress)                  ${fmtUs(fromProgress.stats.mean)} ±${fromProgress.stats.rme.toFixed(1)}%`,
);
// levelBadgeForPlayer only exists once "hide my level" is in (level-optout).
const forPlayer = (LevelBadgeModule as Record<string, unknown>)
  .levelBadgeForPlayer as
  | ((p: { progress?: Progress; levelHidden?: boolean }) => unknown)
  | undefined;
if (forPlayer !== undefined) {
  for (const levelHidden of [undefined, false, true]) {
    const player = { progress, levelHidden };
    const b = bench(`levelBadgeForPlayer ${levelHidden}`, () => {
      sink = forPlayer(player);
    });
    console.log(
      `levelBadgeForPlayer({ levelHidden: ${String(levelHidden).padEnd(9)} })  ${fmtUs(b.stats.mean)} ±${b.stats.rme.toFixed(1)}%`,
    );
  }
}
void sink;
