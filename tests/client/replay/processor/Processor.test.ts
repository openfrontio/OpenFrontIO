/**
 * End to end: a game is played the way a live match runs, archived the way
 * the server archives it (tests/util/ArchiveGame.ts), then processed from the
 * record alone. The decoded replay is checked every tick against the
 * processor's own live Game objects, and the processor's re-simulation
 * against the hashes the "live" clients recorded.
 */

import { PlayerTypeEnum } from "../../../../src/client/render/types";
import { ReplayReader } from "../../../../src/client/replay/codec/decode/ReplayReader";
import type {
  ReplayAppend,
  ReplayBase,
} from "../../../../src/client/replay/codec/ReplayTypes";
import {
  processGameRecord,
  ReplayDesyncError,
} from "../../../../src/client/replay/processor/ReplayProcessor";
import { Game, GameMapType, GameMode } from "../../../../src/core/game/Game";
import { Player } from "../../../../src/core/Schemas";
import {
  config,
  human,
  mapLoader,
  playAndArchive,
  spawnOnLand,
} from "../util/ArchiveGame";
import { expectReplayMatches } from "../util/Expect";
import {
  captureTruth,
  gzip,
  inflate,
  mergeAppends,
  openReader,
  type TickTruth,
} from "../util/RecordGame";

const SPAWN_TURNS = 200; // Config.numSpawnPhaseTurns for a public game

/** Process with truth capture; tiles are sampled (the map is 1M tiles). */
async function processWithTruth(
  record: Parameters<typeof processGameRecord>[0],
) {
  const truth: TickTruth[] = [];
  let base!: ReplayBase;
  const appends: ReplayAppend[] = [];
  const result = await processGameRecord(record, {
    mapLoader,
    gzip,
    keyframeInterval: 50,
    onStart: (b) => (base = b),
    onAppend: (a) => void appends.push(a),
    onTick: (game: Game, gu) =>
      truth.push(captureTruth(game, gu.tick, truth.length % 37 === 0)),
  });
  return { result, truth, replay: { base, append: mergeAppends(appends) } };
}

describe("replay processor", () => {
  test("FFA with humans, nations and bots: in sync, decodes to the live game", async () => {
    const [a, b] = [
      human(1, {
        cosmetics: {
          flag: "/flags/US.svg",
          color: { color: "#ff00aa" },
          crown: { name: "gold", url: "/crowns/gold.svg" },
          verified: true,
        },
      }),
      human(2),
    ];
    const ticks = SPAWN_TURNS + 150;
    const { record, wireStart } = await playAndArchive({
      gameID: "procFFA01",
      config: config(),
      players: [a, b],
      // Purchased tribe names replace generated bot names.
      tribes: [{ name: "Lumberjacks" }, { name: "Seafarers" }],
      ticks,
      intents: (game, t) => {
        const size = game.width() * game.height();
        const id = (p: Player) => game.playerByClientID(p.clientID)!.id();
        switch (t) {
          case 5:
            return [
              spawnOnLand(game, a.clientID, Math.floor(size * 0.3)),
              spawnOnLand(game, b.clientID, Math.floor(size * 0.6)),
            ];
          case SPAWN_TURNS + 10:
            return [
              {
                type: "attack",
                clientID: a.clientID,
                targetID: null,
                troops: null,
              },
              {
                type: "attack",
                clientID: b.clientID,
                targetID: null,
                troops: null,
              },
            ];
          case SPAWN_TURNS + 30:
            return [
              {
                type: "allianceRequest",
                clientID: a.clientID,
                recipient: id(b),
              },
            ];
          case SPAWN_TURNS + 31:
            return [
              {
                type: "allianceRequest",
                clientID: b.clientID,
                recipient: id(a),
              },
            ];
          default:
            return [];
        }
      },
    });

    // Turns 0, 10, 20, … carry hashes, and processing checks every one.
    expect(
      record.turns.filter((t) => t.hash !== null && t.hash !== undefined),
    ).toHaveLength(Math.ceil(ticks / 10));
    const { result, truth, replay } = await processWithTruth(record);
    expect(result.totalTicks).toBe(ticks);

    expectReplayMatches({ replay, truth, frames: [] });

    const h = openReader(replay).header;
    expect(h.numLandTiles).toBe(
      (await mapLoader.getMapData(GameMapType.Pangaea).manifest()).map
        .num_land_tiles,
    );
    // The header carries exactly what live clients received - no stats or
    // persistentID from the record.
    expect(h.gameStartInfo).toEqual(JSON.parse(JSON.stringify(wireStart)));

    // Players' cosmetics stay in the start info for the viewer to resolve;
    // a nation's flag is part of the game.
    for (const p of h.players) {
      if (p.playerType === PlayerTypeEnum.Nation) {
        expect(p.flag).toMatch(/^\/flags\/\w+\.svg$/);
      } else {
        expect(p.flag).toBeUndefined();
      }
    }
    expect(
      h.players.filter((p) => p.playerType === PlayerTypeEnum.Nation).length,
    ).toBeGreaterThan(0);

    // The scripted intents actually played out.
    const last = truth[truth.length - 1];
    const smallA = h.players.find((p) => p.clientID === a.clientID)!.smallID;
    const smallB = h.players.find((p) => p.clientID === b.clientID)!.smallID;
    const atAttack = truth[SPAWN_TURNS + 9].players.get(smallA)!;
    expect(last.players.get(smallA)!.tilesOwned).toBeGreaterThan(
      atAttack.tilesOwned,
    );
    expect(last.players.get(smallA)!.allies).toContain(smallB);
  }, 60_000);

  test("team game: clan tags are wire-blanked like the live server did", async () => {
    // One clan, disableClanTags on. Live clients never saw the tags, so the
    // four spread across both teams; replaying the raw record would put the
    // whole clan on one team (kicking the overflow) and desync immediately.
    const players = [1, 2, 3, 4].map((n) => human(n, { clanTag: "CLAN" }));
    const { record } = await playAndArchive({
      gameID: "procTEAM1",
      config: config({
        gameMode: GameMode.Team,
        playerTeams: 2,
        disableClanTags: true,
        nations: "disabled",
        bots: 10,
      }),
      players,
      ticks: 60,
      intents: (game, t) =>
        t === 5
          ? players.map((p, i) =>
              spawnOnLand(
                game,
                p.clientID,
                Math.floor((game.width() * game.height() * (i + 1)) / 5),
              ),
            )
          : [],
    });

    expect(
      record.turns.some((t) => t.hash !== null && t.hash !== undefined),
    ).toBe(true);
    const { truth, replay } = await processWithTruth(record);
    expectReplayMatches({ replay, truth, frames: [] });

    const humans = openReader(replay).header.players.filter(
      (p) => p.playerType === PlayerTypeEnum.Human,
    );
    expect(humans).toHaveLength(4);
    expect(humans.every((p) => p.clanTag === null)).toBe(true);
    expect(new Set(humans.map((p) => p.team)).size).toBe(2);
  }, 60_000);

  describe("hash verification", () => {
    async function shortRecord() {
      const { record } = await playAndArchive({
        gameID: "procHASH1",
        config: config({ gameMap: GameMapType.Onion, bots: 5 }),
        players: [human(1)],
        ticks: 65,
        intents: (game, t) =>
          t === 3 ? [spawnOnLand(game, "client001", 1000)] : [],
      });
      return record;
    }

    test("trailing empty turns dropped by the archive are restored", async () => {
      const record = await shortRecord();
      // Turns 61-64 have no intents or hash, so the archive omits them.
      expect(record.turns[record.turns.length - 1].turnNumber).toBe(60);
      const { result, replay } = await processWithTruth(record);
      expect(result.totalTicks).toBe(65);
      expect(openReader(replay).header.totalFrames).toBe(65);
    });

    test("a diverging record fails at the first mismatch", async () => {
      const record = await shortRecord();
      const turn = record.turns.find((t) => t.turnNumber === 30)!;
      const recorded = turn.hash! + 1;
      turn.hash = recorded;
      const err = await processGameRecord(record, { mapLoader, gzip }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ReplayDesyncError);
      expect((err as ReplayDesyncError).mismatch).toEqual({
        turn: 30,
        recorded,
        computed: recorded - 1,
      });
    });

    test("a recorded hash on a turn this build doesn't hash is a mismatch", async () => {
      const record = await shortRecord();
      const turn = record.turns.find((t) => t.turnNumber === 3)!;
      expect(turn.hash ?? null).toBeNull();
      turn.hash = 12345;
      const err = await processGameRecord(record, { mapLoader, gzip }).catch(
        (e: unknown) => e,
      );
      expect((err as ReplayDesyncError).mismatch).toEqual({
        turn: 3,
        recorded: 12345,
        computed: null,
      });
    });

    test("the first append comes with the first chunk, the rest at the end", async () => {
      const record = await shortRecord();
      let base: ReplayBase | null = null;
      const appends: [ReplayAppend, number][] = [];
      const result = await processGameRecord(record, {
        mapLoader,
        gzip,
        keyframeInterval: 20,
        // Long enough that only the first one is due in this game.
        appendEveryMs: 3_600_000,
        onStart: (b) => {
          expect(appends).toEqual([]);
          base = b;
        },
        onAppend: (append, frames) => void appends.push([append, frames]),
      });
      expect(appends.map(([a, frames]) => [a.chunks.length, frames])).toEqual([
        [1, 20],
        [3, result.totalTicks],
      ]);

      // The base and the appends are the whole replay, and what the viewer
      // keeps of them is them, merged.
      const live = new ReplayReader(base!, inflate);
      for (const [append] of appends) live.append(append);
      expect(live.header.totalFrames).toBe(result.totalTicks);
      expect(live.data()).toEqual({
        base,
        append: mergeAppends(appends.map(([a]) => a)),
      });
    });

    test("frames are handed out once a later hash has matched", async () => {
      const record = await shortRecord();
      // Hashes come every 10 turns: turn 30 is the last one that matches.
      const turn = record.turns.find((t) => t.turnNumber === 40)!;
      turn.hash = turn.hash! + 1;
      const handedOut: number[] = [];
      const err = await processGameRecord(record, {
        mapLoader,
        gzip,
        keyframeInterval: 5,
        appendEveryMs: 0,
        onAppend: (_append, frames) => void handedOut.push(frames),
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ReplayDesyncError);
      // Frames 0-30 are checked; the chunk ending at frame 34 is not.
      expect(handedOut[handedOut.length - 1]).toBe(30);
    });

    test("a desync still hands out the checked frames that weren't due yet", async () => {
      const record = await shortRecord();
      const turn = record.turns.find((t) => t.turnNumber === 40)!;
      turn.hash = turn.hash! + 1;
      const handedOut: number[] = [];
      const err = await processGameRecord(record, {
        mapLoader,
        gzip,
        keyframeInterval: 5,
        // After the first, no append is due before the desync.
        appendEveryMs: 3_600_000,
        onAppend: (_append, frames) => void handedOut.push(frames),
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ReplayDesyncError);
      expect(handedOut).toEqual([10, 30]);
    });

    test("the caller's record is not mutated", async () => {
      const record = await shortRecord();
      const before = JSON.stringify(record, (_k, v: unknown) =>
        typeof v === "bigint" ? v.toString() : v,
      );
      await processGameRecord(record, { mapLoader, gzip });
      expect(
        JSON.stringify(record, (_k, v: unknown) =>
          typeof v === "bigint" ? v.toString() : v,
        ),
      ).toBe(before);
    });
  });
});
