/**
 * The replay as encoder and reader see it: what the reader's header holds,
 * chunks, keyframes, terrain, and a game read while it's still being
 * processed. Mostly hand-built frames, no simulation needed.
 */

import { gunzip as gunzipCb } from "zlib";
import { FALLOUT_BIT } from "../../../../src/client/render/gl/utils/TileCodec";
import { PlayerTypeEnum } from "../../../../src/client/render/types";
import { ReplayReader } from "../../../../src/client/replay/codec/decode/ReplayReader";
import { StreamingEncoder } from "../../../../src/client/replay/codec/encode/StreamingEncoder";
import type {
  ReplayAppend,
  ReplayFrame,
} from "../../../../src/client/replay/codec/ReplayTypes";
import { GameType, PlayerType, UnitType } from "../../../../src/core/game/Game";
import { GameUpdateType } from "../../../../src/core/game/GameUpdates";
import { setup } from "../../../util/Setup";
import {
  finish,
  gzip,
  inflate,
  openReader,
  recordGame,
  type RecordedGame,
} from "../util/RecordGame";
import {
  frame,
  fullPlayer,
  partialPlayer,
  unit,
} from "../util/SyntheticFrames";

const P = GameUpdateType.Player;
const U = GameUpdateType.Unit;

async function encodeSample(frames = 23, keyframeInterval = 10) {
  const enc = new StreamingEncoder({
    mapWidth: 8,
    mapHeight: 4,
    terrain: new Uint8Array(8 * 4),
    gzip,
    keyframeInterval,
    gameStartInfo: { gameID: "abcd1234", config: { gameMap: "World" } },
    numLandTiles: 20,
  });
  for (let t = 1; t <= frames; t++) {
    enc.pushFrame(
      frame(t, {
        packedTileUpdates: Uint32Array.from([t % 32, t]),
        updates:
          t === 1
            ? {
                [P]: [
                  fullPlayer(1, {
                    clanTag: "ABC",
                    team: "Red",
                    isLobbyCreator: true,
                  }),
                  fullPlayer(2, {
                    clientID: null,
                    playerType: PlayerType.Nation,
                    embargoes: new Set(["p1"]),
                  }),
                ],
                [U]: [unit(1, { unitType: UnitType.City })],
                [GameUpdateType.SpawnPhaseEnd]: [
                  { type: GameUpdateType.SpawnPhaseEnd, startTick: 1 },
                ],
                [GameUpdateType.GamePaused]: [
                  { type: GameUpdateType.GamePaused, paused: false },
                ],
              }
            : t === 12
              ? {
                  [P]: [partialPlayer(2, { isAlive: false })],
                  [U]: [
                    unit(1, { isActive: false }),
                    unit(2, { unitType: UnitType.Port }),
                  ],
                  [GameUpdateType.Hash]: [
                    { type: GameUpdateType.Hash, tick: 12, hash: 7 },
                  ],
                }
              : {},
        packedPlayerUpdates: Float64Array.from([
          1,
          10 + t,
          100 * t,
          1000 + t,
          100 * t,
        ]),
      }),
    );
  }
  return openReader(await finish(enc));
}

describe("replay format", () => {
  test("header, players, unit types and chunks", async () => {
    const reader = await encodeSample();
    const h = reader.header;
    expect(h).toMatchObject({
      totalFrames: 23,
      keyframeInterval: 10,
      mapWidth: 8,
      mapHeight: 4,
      numLandTiles: 20,
      gameStartInfo: { gameID: "abcd1234", config: { gameMap: "World" } },
    });
    expect(reader.data().append.chunks.map((c) => c.frameCount)).toEqual([
      10, 10, 3,
    ]);

    expect(h.players).toEqual([
      {
        smallID: 1,
        id: "p1",
        name: "Player 1",
        displayName: "Player 1",
        clanTag: "ABC",
        clientID: "client1",
        playerType: PlayerTypeEnum.Human,
        team: "Red",
        isLobbyCreator: true,
      },
      {
        smallID: 2,
        id: "p2",
        name: "Player 2",
        displayName: "Player 2",
        clanTag: null,
        clientID: null,
        playerType: PlayerTypeEnum.Nation,
        team: null,
        isLobbyCreator: false,
      },
    ]);
    expect(h.unitTypes).toEqual([UnitType.City, UnitType.Port]);
  });

  test("events come with the frames", async () => {
    const h = (await encodeSample()).header;
    expect(h.spawnPhaseEnd).toEqual({ tick: 1, startTick: 1 });
    expect(h.deadUnitEvents).toEqual([
      {
        tick: 12,
        unitId: 1,
        unitType: UnitType.City,
        ownerSmallID: 1,
        pos: 10,
        reachedTarget: false,
      },
    ]);
  });

  test("frame state across chunk boundaries", async () => {
    const reader = await encodeSample();
    const frames = [];
    for (let f = reader.next(); f !== null; f = reader.next()) {
      frames.push({
        tick: f.tick,
        gold: f.players.get(1)!.gold,
        p2Alive: f.players.get(2)!.isAlive,
        embargoes: f.players.get(2)!.embargoes,
        units: [...f.units.keys()],
        tile: f.tileState[f.tick % 32],
        misc: f.miscUpdates === null ? null : Object.keys(f.miscUpdates),
      });
    }
    expect(frames).toHaveLength(23);
    frames.forEach((f, i) => {
      const t = i + 1;
      expect(f.tick).toBe(t);
      expect(f.gold).toBe(100 * t);
      expect(f.p2Alive).toBe(t < 12);
      expect(f.embargoes).toEqual([1]);
      expect(f.units).toEqual(t < 12 ? [1] : [2]);
      expect(f.tile).toBe(t);
    });
    // SpawnPhaseEnd is an event list, not misc.
    expect(frames[0].misc).toEqual(["GamePaused"]);
    expect(frames[11].misc).toBeNull(); // Hash is dropped
  });

  test.each([
    ["one run for the whole map", () => 0],
    ["every tile different", (ref: number) => ref + 1],
    [
      "runs crossing row ends",
      (ref: number) => (ref < 6 ? 0 : ref < 13 ? 2 : 3),
    ],
  ])("keyframe tile runs: %s", async (_label, stateOf) => {
    const size = 8 * 4;
    const enc = new StreamingEncoder({
      mapWidth: 8,
      mapHeight: 4,
      terrain: new Uint8Array(8 * 4),
      gzip,
      keyframeInterval: 2,
      gameStartInfo: {},
      numLandTiles: size,
    });
    const set: number[] = [];
    for (let ref = 0; ref < size; ref++) {
      if (stateOf(ref) !== 0) set.push(ref, stateOf(ref));
    }
    // Frame 0 sets the pattern; frame 2 is a keyframe of it with no changes.
    for (let t = 1; t <= 3; t++) {
      enc.pushFrame(
        frame(t, {
          packedTileUpdates: Uint32Array.from(t === 1 ? set : []),
        }),
      );
    }
    const reader = openReader(await finish(enc));
    const expected = Uint16Array.from({ length: size }, (_, i) => stateOf(i));
    for (const f of [0, 1, 2]) {
      expect(reader.seek(f).tileState).toEqual(expected);
    }
  });

  test("seek out of range throws", async () => {
    const reader = await encodeSample(3);
    expect(() => reader.seek(3)).toThrow(RangeError);
    expect(() => reader.seek(-1)).toThrow(RangeError);
  });

  test("terrain changes: per frame, and in every later keyframe", async () => {
    // A 4x2 map, base terrain byte 0x80 (land). Tile 5 becomes water
    // (0x00) at tick 3 and stays; tile 6 does at tick 4 and goes back to
    // land at tick 6 (a reverted change is dropped from keyframes).
    const base = new Uint8Array(8).fill(0x80);
    const enc = new StreamingEncoder({
      mapWidth: 4,
      mapHeight: 2,
      terrain: base,
      gzip,
      keyframeInterval: 5,
      gameStartInfo: {},
      numLandTiles: 8,
    });
    const terrainAt: Record<number, [number, number][]> = {
      3: [[5, 0x00]],
      4: [[6, 0x00]],
      6: [[6, 0x80]],
    };
    for (let t = 1; t <= 12; t++) {
      // Every tile update carries its terrain byte; unchanged ones too.
      const pairs: number[] = [0, 0x80 << 16];
      for (const [ref, byte] of terrainAt[t] ?? []) pairs.push(ref, byte << 16);
      enc.pushFrame(frame(t, { packedTileUpdates: Uint32Array.from(pairs) }));
    }
    const reader = openReader(await finish(enc));
    const seen = [];
    for (let f = reader.next(); f !== null; f = reader.next()) {
      seen.push({
        tick: f.tick,
        changed: f.changedTerrain,
        terrain: Object.fromEntries(f.terrain),
      });
    }
    expect(seen).toEqual([
      { tick: 1, changed: null, terrain: {} }, // keyframe
      { tick: 2, changed: [], terrain: {} },
      { tick: 3, changed: [5], terrain: { 5: 0 } },
      { tick: 4, changed: [6], terrain: { 5: 0, 6: 0 } },
      { tick: 5, changed: [], terrain: { 5: 0, 6: 0 } },
      { tick: 6, changed: null, terrain: { 5: 0 } }, // keyframe: 6 reverted
      { tick: 7, changed: [], terrain: { 5: 0 } },
      { tick: 8, changed: [], terrain: { 5: 0 } },
      { tick: 9, changed: [], terrain: { 5: 0 } },
      { tick: 10, changed: [], terrain: { 5: 0 } },
      { tick: 11, changed: null, terrain: { 5: 0 } }, // keyframe
      { tick: 12, changed: [], terrain: { 5: 0 } },
    ]);
    expect(Object.fromEntries(reader.seek(3).terrain)).toEqual({ 5: 0, 6: 0 });
  });

  test("stepping onto a keyframe lists just the tiles it changed", async () => {
    // A 4x2 map. Tile 1 changes on every frame, tile 6 only on the frame
    // that starts the second chunk, and tile 3 gets fallout there.
    const enc = new StreamingEncoder({
      mapWidth: 4,
      mapHeight: 2,
      terrain: new Uint8Array(8),
      gzip,
      keyframeInterval: 3,
      gameStartInfo: {},
      numLandTiles: 8,
    });
    for (let t = 0; t < 6; t++) {
      const pairs = [1, t + 1];
      if (t === 3) pairs.push(6, 9, 3, FALLOUT_BIT);
      enc.pushFrame(frame(t, { packedTileUpdates: Uint32Array.from(pairs) }));
    }
    const reader = openReader(await finish(enc));
    const seen = [];
    for (let f = reader.next(); f !== null; f = reader.next()) {
      seen.push({
        changed: f.changedTiles && [...f.changedTiles].sort((a, b) => a - b),
        fallout: f.falloutTiles,
      });
    }
    expect(seen).toEqual([
      { changed: null, fallout: 0 }, // the first frame is a seek
      { changed: [1], fallout: 0 },
      { changed: [1], fallout: 0 },
      { changed: [1, 3, 6], fallout: 1 }, // keyframe, stepped onto
      { changed: [1], fallout: 1 },
      { changed: [1], fallout: 1 },
    ]);
    // Seeking there is a full frame, with the same fallout.
    expect(reader.seek(3)).toMatchObject({
      changedTiles: null,
      falloutTiles: 1,
    });
  });

  test("with an async gunzip, a chunk is loaded before it's read", async () => {
    const gunzip = (d: Uint8Array) =>
      new Promise<Uint8Array>((resolve, reject) =>
        gunzipCb(d, (err, out) =>
          err ? reject(err) : resolve(new Uint8Array(out)),
        ),
      );
    const sync = await encodeSample();
    const reader = new ReplayReader(sync.data().base, gunzip);
    reader.append(sync.data().append);
    expect(() => reader.seek(15)).toThrow(/isn't loaded/);
    await reader.load(reader.chunkOf(15));
    expect(reader.seek(15).tick).toBe(sync.seek(15).tick);
    // Loading a chunk past the end, or one that's loaded, is a no-op.
    await reader.load(99);
    await reader.load(1);
  });
});

describe("a game still being processed", () => {
  /**
   * A game is watchable while it is being processed: a reader starts from
   * the game's base and gets the frames as appends. It must decode like
   * the finished file, frame for frame.
   */
  let rec: RecordedGame;

  beforeAll(async () => {
    const game = await setup(
      "big_plains",
      { bots: 6, gameType: GameType.Singleplayer },
      [],
      undefined,
      undefined,
      false,
    );
    rec = await recordGame(game, {
      ticks: 120,
      keyframeInterval: 25,
      splitAfter: 60,
      beforeTick: (g, t) => {
        if (t === 5) g.endSpawnPhase();
      },
    });
  }, 60_000);

  const liveReader = () => {
    const live = new ReplayReader(rec.base, inflate);
    live.append(rec.first!);
    return live;
  };

  test("an append holds every frame in a closed chunk, and no more", () => {
    // 60 frames pushed, chunks of 25: the open chunk is left alone.
    expect(rec.first!.chunks.map((c) => c.frameCount)).toEqual([25, 25]);
    expect(liveReader().header.totalFrames).toBe(50);
    expect(openReader(rec.replay).header.totalFrames).toBe(120);
  });

  test("decodes frame for frame like the finished replay", () => {
    const live = liveReader();
    const done = openReader(rec.replay);
    for (let f = 0; f < live.header.totalFrames; f++) {
      const a = live.seek(f);
      const b = done.seek(f);
      expect(a.tick).toBe(b.tick);
      expect(Array.from(a.tileState)).toEqual(Array.from(b.tileState));
      expect([...a.players]).toEqual([...b.players]);
      expect([...a.units]).toEqual([...b.units]);
      expect([...a.terrain]).toEqual([...b.terrain]);
    }
    // Past the live edge there is nothing yet.
    expect(live.seek(49).frame).toBe(49);
    expect(() => live.seek(50)).toThrow();
  });

  test("with the rest appended, it reads like the finished replay", () => {
    const live = liveReader();
    live.seek(49);
    live.append(rec.rest!);
    const done = openReader(rec.replay);
    expect(live.header).toEqual(done.header);
    // Playing on from the old edge, and seeking into the new frames.
    const state = (f: ReplayFrame | null) =>
      f && [f.tick, [...f.tileState], [...f.players], [...f.units]];
    for (let f = 50; f < 120; f++) {
      expect(state(live.next())).toEqual(state(done.seek(f)));
    }
    expect(live.next()).toBeNull();
    expect(state(live.seek(77))).toEqual(state(done.seek(77)));
  });
});

test("an append taken while the gzips are still running is complete", async () => {
  // The processor gzips asynchronously (zlib callbacks). An append is
  // decided before those settle, so the chunks it captured must be the
  // ones that get filled - not placeholders left behind.
  const enc = new StreamingEncoder({
    mapWidth: 16,
    mapHeight: 16,
    terrain: new Uint8Array(16 * 16),
    gzip: (d) =>
      new Promise((resolve) => setTimeout(() => resolve(gzip(d)), 5)),
    keyframeInterval: 5,
    gameStartInfo: {},
    numLandTiles: 10,
  });
  for (let t = 0; t < 20; t++) {
    enc.pushFrame(
      frame(t, { packedTileUpdates: Uint32Array.from([t + 1, 1]) }),
    );
  }
  const append: ReplayAppend = await enc.takeAppend();
  expect(append.chunks.every((c) => c.compressed.length > 0)).toBe(true);
  const reader = new ReplayReader(enc.base, inflate);
  reader.append(append);
  expect(reader.header.totalFrames).toBe(20);
  expect(reader.seek(19).tick).toBe(19);
});
