/**
 * Replay viewer parity: the FrameData the viewer builds from a decoded replay
 * must match what the live client's GameView builds from the worker stream
 * for the same game, frame by frame - territory, trails, railroads, units,
 * players, names, FX events and every derived structure the renderer reads.
 * The live side is a spectator (no local player), as the viewer is.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { RailroadCache } from "../../../src/client/render/frame/RailroadCache";
import type { FrameData, UnitState } from "../../../src/client/render/types";
import type {
  ReplayFrame,
  ReplayHeader,
} from "../../../src/client/replay/codec/ReplayTypes";
import { ReplayFrameBuilder } from "../../../src/client/replay/ReplayFrameBuilder";
import { ReplayTerrain } from "../../../src/client/replay/ReplayTerrain";
import { GameView } from "../../../src/client/view/GameView";
import { AttackExecution } from "../../../src/core/execution/AttackExecution";
import { ConstructionExecution } from "../../../src/core/execution/ConstructionExecution";
import { NukeExecution } from "../../../src/core/execution/NukeExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import { TransportShipExecution } from "../../../src/core/execution/TransportShipExecution";
import {
  Execution,
  Game,
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import {
  genTerrainFromBin,
  type MapManifest,
  type TerrainMapData,
} from "../../../src/core/game/TerrainMapLoader";
import { setup } from "../../util/Setup";
import { stubConfig, stubWorker } from "../../util/viewStubs";
import { openReader, recordGame, type RecordedGame } from "./util/RecordGame";

const MAPS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../testdata/maps",
);
const RULES = { allianceDuration: 100, doomsdayClockWarnTicks: 150 };

/** A fresh copy of a test map for the live GameView (it mutates its map). */
async function loadMap(mapName: string): Promise<TerrainMapData> {
  const dir = path.join(MAPS, mapName);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
  ) as MapManifest;
  const gameMap = await genTerrainFromBin(
    manifest.map,
    fs.readFileSync(path.join(dir, "map.bin")),
  );
  return { nations: [], additionalNations: [], gameMap, miniGameMap: gameMap };
}

function spawnHuman(game: Game, id: string, x: number, y: number) {
  const info = new PlayerInfo(id, PlayerType.Human, `${id}_client`, id);
  game.addPlayer(info);
  game.addExecution(new SpawnExecution("game_id", info, game.ref(x, y)));
}

/** Give a player every land tile within `r` of (cx, cy), inside a tick. */
function conquerDisc(playerID: string, cx: number, cy: number, r: number) {
  let done = false;
  let game: Game;
  return {
    isActive: () => !done,
    activeDuringSpawnPhase: () => false,
    init: (g: Game) => (game = g),
    tick: () => {
      const player = game.player(playerID);
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (!game.isValidCoord(x, y)) continue;
          const tile = game.ref(x, y);
          if (game.isLand(tile)) player.conquer(tile);
        }
      }
      done = true;
    },
    snapshot: () => {
      throw new Error("these games are never snapshotted");
    },
  } satisfies Execution;
}

const round = (n: number) => Math.round(n);

function comparable(fd: FrameData) {
  return {
    tick: fd.tick,
    inSpawnPhase: fd.inSpawnPhase,
    // Live keeps a unit that died this tick (inactive) until the next one;
    // the renderer skips inactive units.
    units: [...fd.units].filter(([, u]) => u.isActive),
    players: [...fd.players],
    // The file stores placements rounded to whole tiles.
    names: [...fd.names].map(([id, n]) => [
      id,
      round(n.x),
      round(n.y),
      round(n.size),
    ]),
    deadUnits: fd.events.deadUnits,
    conquestEvents: fd.events.conquestEvents,
    bonusEvents: fd.events.bonusEvents,
    playerStatus: [...fd.playerStatus],
    allianceClusters: [...fd.allianceClusters],
    nukeTelegraphs: fd.nukeTelegraphs,
    attackRings: fd.attackRings,
    trailDirtyRowMin: fd.trailDirtyRowMin,
    trailDirtyRowMax: fd.trailDirtyRowMax,
    railroadDirty: fd.railroadDirty,
    revealedRailTiles: [...fd.revealedRailTiles],
    structuresDirty: fd.structuresDirty,
  };
}

function expectBuffersEqual(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  what: string,
) {
  expect(b.length, what).toBe(a.length);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      throw new Error(`${what}: index ${i} is ${b[i]}, live has ${a[i]}`);
    }
  }
}

/**
 * Feed the recorded stream to a live GameView and the replay to the
 * builder; compare every frame. Returns what it saw, for scenario checks.
 */
async function expectParity(rec: RecordedGame, mapName: string) {
  const live = new GameView(
    stubWorker(),
    stubConfig(),
    await loadMap(mapName),
    undefined, // spectator
    "spectator",
    null,
    "game_id",
    [],
  );
  const reader = openReader(rec.replay);
  const builder = new ReplayFrameBuilder(reader.header, RULES);
  const mapSize = reader.header.mapWidth * reader.header.mapHeight;
  const liveTerrain = () => {
    const out = new Uint8Array(mapSize);
    for (let ref = 0; ref < mapSize; ref++) out[ref] = live.terrainByte(ref);
    return out;
  };
  const baseTerrain = liveTerrain();
  const terrain = new ReplayTerrain(baseTerrain);
  const seen = {
    trailTiles: 0,
    railTiles: 0,
    deadUnits: 0,
    telegraphs: 0,
    terrainChanges: 0,
    nukedTiles: 0,
  };

  for (let i = 0; i < rec.frames.length; i++) {
    live.update(rec.frames[i]);
    const a = live.frameData();
    const f = reader.next()!;
    const b = i === 0 ? builder.seek(f) : builder.advance(f);
    const at = `frame ${i} (tick ${a.tick})`;

    // A seek (frame 0) forces the railroad upload.
    expect(
      {
        ...comparable(b),
        railroadDirty: i === 0 ? a.railroadDirty : b.railroadDirty,
      },
      at,
    ).toEqual(comparable(a));
    expectBuffersEqual(a.tileState, b.tileState, `${at} tiles`);
    expectBuffersEqual(a.trailState, b.trailState, `${at} trails`);
    expectBuffersEqual(a.railroadState, b.railroadState, `${at} railroads`);
    if (a.relationsDirty) {
      expect(b.relationsDirty, at).toBe(true);
      expect(b.relationSize, at).toBe(a.relationSize);
      expectBuffersEqual(a.relationMatrix, b.relationMatrix, `${at} relations`);
    }
    if (b.changedTiles !== null) {
      expect(new Set(b.changedTiles), at).toEqual(new Set(a.changedTiles));
    }
    // Terrain (water nukes) is outside FrameData: the viewer applies it.
    const changed = terrain.apply(f);
    expect(new Set(changed), `${at} terrain changes`).toEqual(
      new Set(live.recentlyUpdatedTerrainTiles()),
    );
    expectBuffersEqual(liveTerrain(), terrain.bytes, `${at} terrain`);
    seen.terrainChanges += changed.length;
    // Nuke damage on map layers is outside FrameData too: the replay's
    // impact events carry what live marks (WebGLFrameBuilder.syncNukeImpacts).
    const nuked = live.recentlyNukedTiles();
    const impact = reader.header.nukeImpacts.find((e) => e.tick === a.tick);
    expect(
      { land: impact?.land ?? [], water: impact?.water ?? [] },
      `${at} nuke impacts`,
    ).toEqual({
      land: nuked.filter((t) => live.isLand(t)),
      water: nuked.filter((t) => !live.isLand(t)),
    });
    seen.nukedTiles += nuked.length;

    seen.trailTiles += a.trailState.some((v) => v !== 0) ? 1 : 0;
    seen.railTiles += a.railroadState.some((v) => v !== 0) ? 1 : 0;
    seen.deadUnits += a.events.deadUnits.length;
    seen.telegraphs += a.nukeTelegraphs.length;
  }
  return { seen, reader, builder, baseTerrain };
}

/** What a seek must reproduce: everything but trails and one-shot FX. */
function seekComparable(fd: FrameData, terrain: Uint8Array) {
  const c = comparable(fd);
  return {
    state: {
      tick: c.tick,
      inSpawnPhase: c.inSpawnPhase,
      units: c.units,
      players: c.players,
      names: c.names,
      conquestEvents: c.conquestEvents,
      playerStatus: c.playerStatus,
      allianceClusters: c.allianceClusters,
      nukeTelegraphs: c.nukeTelegraphs,
      attackRings: c.attackRings,
    },
    tiles: fd.tileState.slice(),
    terrain: terrain.slice(),
    railroads: fd.railroadState.slice(),
    relations: fd.relationMatrix.slice(0, fd.relationSize ** 2),
  };
}

function expectSeekEqual(
  a: ReturnType<typeof seekComparable>,
  b: ReturnType<typeof seekComparable>,
  at: string,
) {
  expect(b.state, at).toEqual(a.state);
  expectBuffersEqual(a.tiles, b.tiles, `${at} tiles`);
  expectBuffersEqual(a.railroads, b.railroads, `${at} railroads`);
  expectBuffersEqual(a.terrain, b.terrain, `${at} terrain`);
  expectBuffersEqual(a.relations, b.relations, `${at} relations`);
}

/**
 * Seeking (forward, backward, across chunks) and then playing on must land
 * on the state sequential playback reaches.
 */
function expectSeekParity(
  rec: RecordedGame,
  baseTerrain: Uint8Array,
  targets: number[],
) {
  const reader = openReader(rec.replay);
  const builder = new ReplayFrameBuilder(reader.header, RULES);
  const terrain = new ReplayTerrain(baseTerrain);
  const wanted = new Set(targets.flatMap((t) => [t, t + 1, t + 2, t + 3]));
  const sequential = new Map<number, ReturnType<typeof seekComparable>>();
  for (let i = 0; i < reader.header.totalFrames; i++) {
    const f = reader.next()!;
    const fd = i === 0 ? builder.seek(f) : builder.advance(f);
    terrain.apply(f);
    if (wanted.has(i)) sequential.set(i, seekComparable(fd, terrain.bytes));
  }

  const seeker = openReader(rec.replay);
  const seeking = new ReplayFrameBuilder(seeker.header, RULES);
  const seekTerrain = new ReplayTerrain(baseTerrain);
  for (const target of targets) {
    const at = `seek to ${target}`;
    const f = seeker.seek(target);
    const fd = seeking.seek(f);
    seekTerrain.apply(f);
    expectSeekEqual(
      sequential.get(target)!,
      seekComparable(fd, seekTerrain.bytes),
      at,
    );
    for (let i = 1; i <= 3 && sequential.has(target + i); i++) {
      const next = seeker.next()!;
      const nextFd = seeking.advance(next);
      seekTerrain.apply(next);
      expectSeekEqual(
        sequential.get(target + i)!,
        seekComparable(nextFd, seekTerrain.bytes),
        `${at} +${i}`,
      );
    }
  }
}

describe("ReplayFrameBuilder parity with GameView", () => {
  test("bot free-for-all", async () => {
    const game = await setup(
      "big_plains",
      { bots: 30, gameType: GameType.Singleplayer },
      [],
      undefined,
      undefined,
      false,
    );
    const rec = await recordGame(game, {
      ticks: 250,
      keyframeInterval: 40,
      cloneFrames: true,
      beforeTick: (g, t) => {
        if (t === 5) g.endSpawnPhase();
      },
    });
    await expectParity(rec, "big_plains");
  }, 60_000);

  test("nuke, transport ship, construction and war", async () => {
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [],
      undefined,
      undefined,
      false,
    );
    spawnHuman(game, "alice", 20, 20);
    spawnHuman(game, "bob", 150, 150);
    const rec = await recordGame(game, {
      ticks: 220,
      skipInit: true,
      cloneFrames: true,
      keyframeInterval: 50,
      beforeTick: (g, t) => {
        const alice = () => g.player("alice");
        const bob = () => g.player("bob");
        if (t === 3) g.endSpawnPhase();
        if (t === 5) {
          g.addExecution(
            new AttackExecution(null, alice(), g.terraNullius().id()),
          );
          g.addExecution(
            new AttackExecution(null, bob(), g.terraNullius().id()),
          );
        }
        if (t === 60) {
          g.addExecution(
            new ConstructionExecution(
              alice(),
              UnitType.MissileSilo,
              g.ref(20, 20),
            ),
          );
        }
        if (t === 64) {
          g.addExecution(
            new NukeExecution(
              UnitType.AtomBomb,
              alice(),
              g.ref(150, 150),
              null,
            ),
          );
        }
        if (t === 120) {
          g.addExecution(new AttackExecution(null, alice(), bob().id()));
        }
      },
    });
    const { seen, baseTerrain } = await expectParity(rec, "big_plains");
    expectSeekParity(rec, baseTerrain, [150, 70, 115, 116, 0, 219, 49, 50]);
    // The scenario exercised what it is for.
    expect(seen.trailTiles).toBeGreaterThan(0); // the nuke's trail
    expect(seen.deadUnits).toBeGreaterThan(0);
    expect(seen.telegraphs).toBeGreaterThan(0);
  }, 60_000);

  test("transport ship trail", async () => {
    const game = await setup(
      "ocean_and_land",
      { infiniteGold: true, instantBuild: true },
      [],
      undefined,
      undefined,
      false,
    );
    spawnHuman(game, "alice", 7, 0);
    spawnHuman(game, "bob", 7, 15);
    const rec = await recordGame(game, {
      ticks: 80,
      skipInit: true,
      cloneFrames: true,
      keyframeInterval: 20,
      beforeTick: (g, t) => {
        if (t === 3) g.endSpawnPhase();
        if (t === 5) {
          g.addExecution(
            new TransportShipExecution(g.player("alice"), g.ref(7, 15), 100),
          );
        }
      },
    });
    const { seen } = await expectParity(rec, "ocean_and_land");
    expect(seen.trailTiles).toBeGreaterThan(0);
  }, 60_000);

  test("water nukes reshape the terrain", async () => {
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true, waterNukes: true },
      [],
      undefined,
      undefined,
      false,
    );
    spawnHuman(game, "alice", 20, 20);
    const rec = await recordGame(game, {
      ticks: 200,
      skipInit: true,
      cloneFrames: true,
      keyframeInterval: 40,
      beforeTick: (g, t) => {
        const alice = () => g.player("alice");
        if (t === 3) g.endSpawnPhase();
        if (t === 5) g.addExecution(conquerDisc("alice", 20, 20, 12));
        if (t === 10) {
          g.addExecution(
            new ConstructionExecution(
              alice(),
              UnitType.MissileSilo,
              g.ref(20, 20),
            ),
          );
        }
        // Unowned land far away: the crater turns into water.
        if (t === 14) {
          g.addExecution(
            new NukeExecution(
              UnitType.AtomBomb,
              alice(),
              g.ref(150, 150),
              null,
            ),
          );
        }
      },
    });
    const { seen, baseTerrain } = await expectParity(rec, "big_plains");
    expect(seen.terrainChanges).toBeGreaterThan(0);
    expect(seen.nukedTiles).toBeGreaterThan(0);
    expectSeekParity(rec, baseTerrain, [199, 60, 0, 120, 79, 80, 159]);
  }, 60_000);

  test("railroads", async () => {
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [],
      undefined,
      undefined,
      false,
    );
    spawnHuman(game, "alice", 50, 50);
    const rec = await recordGame(game, {
      ticks: 120,
      skipInit: true,
      cloneFrames: true,
      keyframeInterval: 30,
      beforeTick: (g, t) => {
        const alice = () => g.player("alice");
        if (t === 3) g.endSpawnPhase();
        if (t === 5) g.addExecution(conquerDisc("alice", 50, 50, 30));
        // Stations 20 tiles apart (trainStationMinRange is 15).
        if (t === 10) {
          for (const [type, x, y] of [
            [UnitType.Factory, 50, 50],
            [UnitType.City, 70, 50],
            [UnitType.City, 50, 70],
            [UnitType.City, 30, 50],
          ] as const) {
            g.addExecution(
              new ConstructionExecution(alice(), type, g.ref(x, y)),
            );
          }
        }
      },
    });
    const { seen, reader, baseTerrain } = await expectParity(rec, "big_plains");
    expect(reader.header.railroadEvents.length).toBeGreaterThan(0);
    expect(seen.railTiles).toBeGreaterThan(0);
    // Railroad construction animates over ticks; a seek replays it.
    const firstRail = reader.header.railroadEvents[0].tick;
    expectSeekParity(rec, baseTerrain, [
      firstRail,
      firstRail + 2,
      110,
      firstRail + 1,
      0,
      59,
      60,
      119,
      30,
    ]);

    // Once the network is drawn in, a seek skips the ticks without events
    // instead of stepping through every one.
    const apply = vi.spyOn(RailroadCache.prototype, "apply");
    const seeker = openReader(rec.replay);
    new ReplayFrameBuilder(seeker.header, RULES).seek(seeker.seek(119));
    expect(apply.mock.calls.length).toBeLessThan(60);
    apply.mockRestore();
  }, 60_000);
});

describe("ReplayFrameBuilder nuke telegraphs", () => {
  // The scenarios above never deliver a plan ahead of its start, so check
  // the gating on a hand-built replay: GameView hides a nuke's telegraph
  // while its (delivered) plan hasn't started.
  const header = {
    mapWidth: 10,
    mapHeight: 10,
    players: [],
    railroadEvents: [],
    deadUnitEvents: [],
    spawnPhaseEnd: { tick: 1, startTick: 1 },
    motionPlans: [
      {
        kind: "grid",
        tick: 5,
        unitId: 7,
        planId: 1,
        startTick: 8,
        ticksPerStep: 1,
        path: new Uint32Array([0, 1]),
      },
    ],
  } as unknown as ReplayHeader;
  const nuke = {
    id: 7,
    unitType: UnitType.AtomBomb,
    ownerID: 1,
    targetTile: 55,
    isActive: true,
    waitTicks: 0,
    pos: 0,
    lastPos: 0,
  } as unknown as UnitState;
  const frame = (tick: number) =>
    ({
      frame: tick,
      tick,
      tileState: new Uint16Array(100),
      changedTiles: [],
      falloutTiles: 0,
      players: new Map(),
      units: new Map([[7, nuke]]),
      names: new Map(),
      terrain: new Map(),
      changedTerrain: null,
      miscUpdates: null,
    }) satisfies ReplayFrame;

  test.each([
    [4, 1], // plan not delivered yet: shown, as live
    [5, 0], // delivered, starts at 8: hidden
    [7, 0],
    [8, 1], // started
  ])("tick %i: %i telegraph(s)", (tick, count) => {
    const builder = new ReplayFrameBuilder(header, RULES);
    expect(builder.seek(frame(tick)).nukeTelegraphs).toHaveLength(count);
  });
});
