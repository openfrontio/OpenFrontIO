import { describe, expect, it } from "vitest";
import { PlayerExecution } from "../../../src/core/execution/PlayerExecution";
import {
  RisingSeaLevelExecution,
  RisingSeaLevelExecutionSnapshot,
  SeaFloodFront,
} from "../../../src/core/execution/RisingSeaLevelExecution";
import {
  Execution,
  Game,
  Player,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { GameMap, GameMapImpl, TileRef } from "../../../src/core/game/GameMap";
import {
  BREACH_LEVEL_COUNT,
  RISING_SEA_LEVEL_SPEEDS,
  risingSeaFloodQuota,
  risingSeaLevelSchedule,
  risingSeaLevelState,
  risingSeaLevelSupported,
  risingSeaReserveTiles,
} from "../../../src/core/game/RisingSeaLevel";
import { RisingSeaLevelConfigSchema } from "../../../src/core/Schemas";
import { playerInfo, setup } from "../../util/Setup";

/** Tile lists cross the snapshot boundary as Uint32Array, as zTiles() requires. */
const tiles = (...refs: number[]) => Uint32Array.from(refs);

const GRACE_SECONDS = 180;
// The tick at which the grace ends on every preset (elapsedGameSeconds is
// ticksSinceStart/10, and setup() ends the spawn phase at tick 0).
const FIRST_FLOOD_TICK = GRACE_SECONDS * 10;

// ---------------------------------------------------------------------------
// Synthetic terrain, so breach ordering can be asserted on elevations we choose.
// Byte layout is GameMapImpl's: bit 7 = land, bit 5 = ocean, low 5 bits =
// magnitude (31 = impassable).
// ---------------------------------------------------------------------------
const LAND = 1 << 7;
const OCEAN = 1 << 5;
const IMPASSABLE = 31;

/**
 * Builds a GameMap from rows of chars: "~" ocean, "." lake water, digits/letters
 * base-36 land elevation, "#" impassable land.
 */
function mapFromRows(rows: string[]): GameMap {
  const h = rows.length;
  const w = rows[0].length;
  const terrain = new Uint8Array(w * h);
  let land = 0;
  rows.forEach((row, y) => {
    expect(row.length).toBe(w);
    for (let x = 0; x < w; x++) {
      const c = row[x];
      const i = y * w + x;
      if (c === "~") {
        terrain[i] = OCEAN;
      } else if (c === ".") {
        terrain[i] = 0; // lake water: not land, not ocean
      } else if (c === "#") {
        terrain[i] = LAND | IMPASSABLE;
        land++;
      } else {
        terrain[i] = LAND | parseInt(c, 36);
        land++;
      }
    }
  });
  return new GameMapImpl(w, h, terrain, land);
}

function drain(front: SeaFloodFront): { tile: TileRef; level: number }[] {
  const out: { tile: TileRef; level: number }[] = [];
  for (;;) {
    const tile = front.pop();
    if (tile === null) return out;
    out.push({ tile, level: front.waterline() });
  }
}

describe("RisingSeaLevel pure math", () => {
  it("every preset's grace plus submerge matches its advertised length", () => {
    const minutes = RISING_SEA_LEVEL_SPEEDS.map((s) => {
      const { graceSeconds, submergeSeconds } = risingSeaLevelSchedule(s);
      expect(graceSeconds).toBe(GRACE_SECONDS);
      return (graceSeconds + submergeSeconds) / 60;
    });
    expect(minutes).toEqual([38, 28, 21, 15]);
  });

  it("the quota self-corrects so the deadline holds however far behind it is", () => {
    const submerge = 100;
    // On schedule from tile one: 1000 tiles over 100 s is 10 a second.
    expect(risingSeaFloodQuota(1000, 0, submerge)).toBe(10);
    // Half the time gone, half the tiles left: still 10 a second.
    expect(risingSeaFloodQuota(500, 50, submerge)).toBe(10);
    // Badly behind: the quota rises to still finish on time.
    expect(risingSeaFloodQuota(500, 90, submerge)).toBe(50);
    // Past the deadline: it takes everything left rather than dividing by <= 0.
    expect(risingSeaFloodQuota(500, 100, submerge)).toBe(500);
    expect(risingSeaFloodQuota(500, 500, submerge)).toBe(500);
    // Nothing left, or no schedule at all.
    expect(risingSeaFloodQuota(0, 10, submerge)).toBe(0);
    expect(risingSeaFloodQuota(-5, 10, submerge)).toBe(0);
    expect(risingSeaFloodQuota(500, 10, 0)).toBe(0);
  });

  it("simulating a whole flood at the quota finishes exactly on the deadline", () => {
    const submerge = 600;
    let left = 12_345;
    let second = 0;
    while (left > 0 && second < submerge * 2) {
      left -= Math.min(left, risingSeaFloodQuota(left, second, submerge));
      second++;
    }
    expect(left).toBe(0);
    expect(second).toBeLessThanOrEqual(submerge);
  });

  it("the dry reserve is a small absolute floor, not a share of the map", () => {
    expect(risingSeaReserveTiles(0)).toBe(0);
    expect(risingSeaReserveTiles(50)).toBe(1);
    expect(risingSeaReserveTiles(1000)).toBe(10);
    // Capped, so even the largest maps cannot be stalemated on the remainder.
    expect(risingSeaReserveTiles(1_000_000)).toBe(256);
    expect(risingSeaReserveTiles(2_400_000)).toBe(256);
  });

  it("the HUD state tracks the grace boundary and the flood share", () => {
    const { submergeSeconds } = risingSeaLevelSchedule("normal");
    const atStart = risingSeaLevelState("normal", 0);
    expect(atStart.inGrace).toBe(true);
    expect(atStart.secondsToStart).toBe(GRACE_SECONDS);
    expect(atStart.floodedPercent).toBe(0);

    // The last second of the grace is still grace; the next is not.
    expect(risingSeaLevelState("normal", GRACE_SECONDS - 1).inGrace).toBe(true);
    const flooding = risingSeaLevelState("normal", GRACE_SECONDS);
    expect(flooding.inGrace).toBe(false);
    expect(flooding.secondsToStart).toBe(0);
    expect(flooding.secondsToFull).toBe(submergeSeconds);
    expect(flooding.floodedPercent).toBe(0);

    // The share is elapsed flood time, which is exactly what the self-correcting
    // quota delivers: a quarter of the way through, a quarter is under water.
    const quarter = risingSeaLevelState(
      "normal",
      GRACE_SECONDS + submergeSeconds / 4,
    );
    expect(quarter.floodedPercent).toBe(25);
    expect(quarter.secondsToFull).toBe((submergeSeconds * 3) / 4);

    // Past the deadline the countdown floors rather than going negative and the
    // share is clamped, so a game that runs on reads 100%, not more.
    const past = risingSeaLevelState(
      "normal",
      GRACE_SECONDS + submergeSeconds + 500,
    );
    expect(past.secondsToFull).toBe(0);
    expect(past.floodedPercent).toBe(100);
  });

  it("the snapshot schema rejects a bucket array it could index past", () => {
    const state = {
      active: true,
      initialized: true,
      buckets: Array.from({ length: BREACH_LEVEL_COUNT }, () => tiles()),
      level: 0,
      pending: tiles(),
      reachableTotal: 10,
      floodedCount: 0,
    };
    const schema = RisingSeaLevelExecutionSnapshot.schema;
    expect(schema.safeParse(state).success).toBe(true);
    // Not yet seeded: no buckets at all is the other legal shape.
    expect(schema.safeParse({ ...state, buckets: [] }).success).toBe(true);
    // A short array would make push() write to undefined.
    expect(
      schema.safeParse({ ...state, buckets: [tiles(), tiles()] }).success,
    ).toBe(false);
    // The dial may sit one past the last bucket (a drained front) but no further.
    expect(
      schema.safeParse({ ...state, level: BREACH_LEVEL_COUNT }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ ...state, level: BREACH_LEVEL_COUNT + 1 }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...state, level: -1 }).success).toBe(false);
    expect(schema.safeParse({ ...state, floodedCount: -1 }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...state, reachableTotal: -1 }).success).toBe(
      false,
    );
  });

  it("the config schema takes the four presets and nothing else", () => {
    for (const speed of RISING_SEA_LEVEL_SPEEDS) {
      expect(
        RisingSeaLevelConfigSchema.safeParse({ enabled: true, speed }).success,
      ).toBe(true);
    }
    // The off shape the lobby sends: {enabled:false} with no speed.
    expect(
      RisingSeaLevelConfigSchema.safeParse({ enabled: false }).success,
    ).toBe(true);
    expect(
      RisingSeaLevelConfigSchema.safeParse({ enabled: true, speed: "instant" })
        .success,
    ).toBe(false);
  });

  it("only maps with water support the mode", () => {
    expect(
      risingSeaLevelSupported({ width: 10, height: 10, num_land_tiles: 99 }),
    ).toBe(true);
    // alps / thebox: solid land edge to edge.
    expect(
      risingSeaLevelSupported({ width: 10, height: 10, num_land_tiles: 100 }),
    ).toBe(false);
  });
});

describe("SeaFloodFront breach ordering", () => {
  it("holds an inner basin dry until its ring is breached, then fills it", () => {
    // A magnitude-5 ring around a magnitude-0 basin, reachable only over the
    // ring. The basin is lower than the ring, so elevation alone would flood it
    // first; breach order must not.
    const rows = [
      "~~~~~~~",
      "~55555~",
      "~50005~",
      "~50005~",
      "~50005~",
      "~55555~",
      "~~~~~~~",
    ];
    const map = mapFromRows(rows);
    const front = new SeaFloodFront(map);
    front.seed();
    const popped = drain(front);

    expect(popped.length).toBe(16 + 9); // ring + basin

    const isBasin = (t: TileRef) =>
      map.x(t) >= 2 && map.x(t) <= 4 && map.y(t) >= 2 && map.y(t) <= 4;
    const firstBasin = popped.findIndex((p) => isBasin(p.tile));
    // Every ring tile goes before any basin tile.
    expect(firstBasin).toBe(16);
    // And the basin drains in one consecutive run, at the ring's elevation —
    // the sea pours over the rim all at once.
    for (const p of popped.slice(16)) {
      expect(isBasin(p.tile)).toBe(true);
      expect(p.level).toBe(5);
    }
    // The waterline only ever climbs.
    let last = 0;
    for (const p of popped) {
      expect(p.level).toBeGreaterThanOrEqual(last);
      last = p.level;
    }
  });

  it("floods a slope strictly lowest-first", () => {
    const map = mapFromRows(["~0123456789"]);
    const front = new SeaFloodFront(map);
    const popped = (() => {
      front.seed();
      return drain(front);
    })();
    expect(popped.map((p) => map.magnitude(p.tile))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("treats impassable terrain as a wall the sea never crosses", () => {
    const rows = [
      "~~~~~~~",
      "~#####~",
      "~#000#~",
      "~#000#~",
      "~#000#~",
      "~#####~",
      "~~~~~~~",
    ];
    const map = mapFromRows(rows);
    const front = new SeaFloodFront(map);
    front.seed();
    // Nothing is floodable: every land tile touching water is impassable.
    expect(front.isEmpty()).toBe(true);
    expect(drain(front)).toEqual([]);
  });

  it("floods a lake's shore too, not just the ocean's", () => {
    // The interior water is lake water (no ocean bit), which is still a source.
    const map = mapFromRows(["00000", "00.00", "00000"]);
    const front = new SeaFloodFront(map);
    front.seed();
    // 4 orthogonal neighbours of the lake seed the front, and the flood then
    // spreads over the whole 14-tile island.
    expect(drain(front).length).toBe(14);
  });

  it("is a pure function of the terrain: two fronts pop identically", () => {
    const rows = [
      "~~~~~~~~~~",
      "~1234321~~",
      "~2#5005#2~",
      "~3509053~~",
      "~2#5005#2~",
      "~1234321~~",
      "~~~~~~~~~~",
    ];
    const a = drain(
      (() => {
        const f = new SeaFloodFront(mapFromRows(rows));
        f.seed();
        return f;
      })(),
    );
    const b = drain(
      (() => {
        const f = new SeaFloodFront(mapFromRows(rows));
        f.seed();
        return f;
      })(),
    );
    expect(a).toEqual(b);
    // Every floodable tile is reached (nothing is stranded behind the walls
    // here — the "#" tiles are the only ones that never flood).
    const map = mapFromRows(rows);
    let floodable = 0;
    map.forEachTile((t) => {
      if (map.isLand(t) && !map.isImpassable(t)) floodable++;
    });
    expect(a.length).toBe(floodable);
  });

  it("takes a requeued tile again at the waterline, not at the end", () => {
    const map = mapFromRows(["~0123456789"]);
    const front = new SeaFloodFront(map);
    front.seed();
    // Climb to level 5, then hand back the tile popped at level 2.
    const popped: TileRef[] = [];
    for (let i = 0; i <= 5; i++) popped.push(front.pop()!);
    front.requeue(popped[2]);
    // It comes back immediately — the sea has long since reached it, so waiting
    // until level 9 would leave a hole above the waterline for minutes.
    expect(front.pop()).toBe(popped[2]);
    expect(front.waterline()).toBe(5);
    // And the flood then carries on in order, with nothing lost or duplicated.
    expect(drain(front).map((p) => map.magnitude(p.tile))).toEqual([
      6, 7, 8, 9,
    ]);
  });

  it("survives a requeue after the front has drained", () => {
    // The dial ends one past the last bucket, so a requeue then must not write
    // out of bounds. The execution stops the flood before this can happen, but
    // the front must not depend on that.
    const map = mapFromRows(["~0"]);
    const front = new SeaFloodFront(map);
    front.seed();
    expect(drain(front).length).toBe(1);
    const tile = 1;
    front.requeue(tile);
    expect(front.isEmpty()).toBe(false);
    expect(front.pop()).toBe(tile);
  });

  it("reports emptiness consistently with pop, at every stage", () => {
    const map = mapFromRows(["~012"]);
    const front = new SeaFloodFront(map);
    expect(front.isEmpty()).toBe(true); // unseeded
    front.seed();
    for (let i = 0; i < 3; i++) {
      expect(front.isEmpty()).toBe(false);
      expect(front.pop()).not.toBeNull();
    }
    expect(front.isEmpty()).toBe(true);
    expect(front.pop()).toBeNull();
    // Still empty after the dial has run off the end.
    expect(front.isEmpty()).toBe(true);
  });
});

/**
 * Stands in for a player attacking along the waterline: it conquers every
 * unowned land tile it finds. Registered after the flood, so it runs in the same
 * tick — exactly where an AttackExecution capturing a just-relinquished tile
 * sits, before WaterManager flushes at the end of the tick.
 */
class Squatter implements Execution {
  readonly reconquests: TileRef[] = [];
  private mg: Game | null = null;
  private squatting = true;

  constructor(private readonly player: Player) {}

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(): void {
    const mg = this.mg;
    if (mg === null || !this.squatting) return;
    // The player held every land tile, so anything unowned now is a tile the
    // flood relinquished this very tick.
    mg.forEachTile((t: TileRef) => {
      if (mg.isLand(t) && !mg.isImpassable(t) && !mg.hasOwner(t)) {
        this.player.conquer(t);
        this.reconquests.push(t);
      }
    });
  }

  stop(): void {
    this.squatting = false;
  }

  isActive(): boolean {
    return true;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(): never {
    throw new Error("test-only execution, never snapshotted");
  }
}

// ---------------------------------------------------------------------------
// Integration against the real simulation. ocean_and_land is 16x16 with 134
// land tiles, all magnitude 0, on the map's left edge plus a small island.
// ---------------------------------------------------------------------------
describe("RisingSeaLevelExecution (integration)", () => {
  async function floodGame(
    speed: "slow" | "normal" | "fast" | "veryfast" = "veryfast",
    mapName = "ocean_and_land",
  ) {
    const game = await setup(mapName, {
      risingSeaLevel: { enabled: true, speed },
    });
    const exec = new RisingSeaLevelExecution();
    // setup() builds the game directly, not through GameRunner, so the
    // execution GameRunner would register has to be added here.
    game.addExecution(exec);
    return { game, exec };
  }

  function run(game: Game, ticks: number): void {
    for (let i = 0; i < ticks; i++) game.executeNextTick();
  }

  it("floods nothing during the grace, then starts", async () => {
    const { game } = await floodGame();
    const before = game.numLandTiles();
    run(game, FIRST_FLOOD_TICK - 1);
    expect(game.numLandTiles()).toBe(before);
    run(game, 20);
    expect(game.numLandTiles()).toBeLessThan(before);
  });

  it("stops at the dry reserve with land still above water", async () => {
    const { game, exec } = await floodGame();
    const reserve = risingSeaReserveTiles(134);
    // veryfast is 12 minutes of flooding; run well past it.
    run(game, FIRST_FLOOD_TICK + 900 * 10);
    expect(exec.isActive()).toBe(false);
    expect(game.numLandTiles()).toBeGreaterThan(0);
    // All reachable land bar the reserve is gone.
    expect(game.numLandTiles()).toBeLessThanOrEqual(reserve + 1);
  });

  it("respects the per-second quota rather than flooding in one go", async () => {
    const { game, exec } = await floodGame("slow");
    run(game, FIRST_FLOOD_TICK + 10);
    const reachable = exec.reachable();
    const quota = risingSeaFloodQuota(
      reachable - risingSeaReserveTiles(reachable),
      0,
      risingSeaLevelSchedule("slow").submergeSeconds,
    );
    expect(quota).toBe(1); // 134 tiles over 2100 s
    // One flood second has resolved, so at most one tile is under water.
    expect(134 - game.numLandTiles()).toBeLessThanOrEqual(1);
  });

  it("floods owned territory, relinquishing it first", async () => {
    const game = await setup(
      "ocean_and_land",
      { risingSeaLevel: { enabled: true, speed: "veryfast" } },
      [playerInfo("owner", PlayerType.Human)],
    );
    const player = game.player("owner");
    // Hand the player the whole coast, so the flood cannot avoid owned land.
    let owned = 0;
    game.forEachTile((t: TileRef) => {
      if (game.isLand(t) && !game.isImpassable(t) && !game.hasOwner(t)) {
        player.conquer(t);
        owned++;
      }
    });
    expect(owned).toBeGreaterThan(100);
    game.addExecution(new RisingSeaLevelExecution());
    run(game, FIRST_FLOOD_TICK + 400 * 10);
    // The sea took the territory; no throw from floodTile/relinquish.
    expect(player.numTilesOwned()).toBeLessThan(owned);
    expect(game.numLandTiles()).toBeLessThan(134);
  });

  it("still floods a tile conquered in the same tick it is relinquished", async () => {
    // WaterManager refuses to convert a tile that gained an owner between
    // queueing and the end-of-tick flush. Without the pending re-check that
    // would leave a permanently dry hole the flood's own tally cannot see —
    // a player could save land from the sea by attacking along the waterline.
    const game = await setup(
      "ocean_and_land",
      { risingSeaLevel: { enabled: true, speed: "veryfast" } },
      [playerInfo("squatter", PlayerType.Human)],
    );
    const player: Player = game.player("squatter");
    game.forEachTile((t: TileRef) => {
      if (game.isLand(t) && !game.isImpassable(t)) player.conquer(t);
    });
    const landBefore = game.numLandTiles();

    const exec = new RisingSeaLevelExecution();
    game.addExecution(exec);
    const squatter = new Squatter(player);
    game.addExecution(squatter);

    run(game, FIRST_FLOOD_TICK + 60 * 10);
    // The exploit fired: tiles were taken back out from under the conversion.
    expect(squatter.reconquests.length).toBeGreaterThan(0);
    // The flood is not fooled into thinking it is done — a requeued tile is not
    // counted as flooded, so it keeps coming back for it.
    expect(exec.isActive()).toBe(true);
    expect(exec.flooded()).toBe(0);
    // And the squatting bought nothing: the tiles are dry only while it lasts.
    squatter.stop();
    run(game, 400 * 10);
    expect(game.numLandTiles()).toBeLessThan(landBefore);
    for (const t of squatter.reconquests) expect(game.isWater(t)).toBe(true);
  });

  it("deactivates immediately on a map with no water", async () => {
    // plains is 100x100 solid land: no coastline, so nothing can ever flood.
    const { game, exec } = await floodGame("veryfast", "plains");
    const before = game.numLandTiles();
    run(game, 1);
    expect(exec.isActive()).toBe(false);
    run(game, FIRST_FLOOD_TICK + 600);
    expect(game.numLandTiles()).toBe(before);
  });

  it("does nothing when the config is off, which is the default", async () => {
    const game = await setup("ocean_and_land", {});
    expect(game.config().risingSeaLevelConfig().enabled).toBe(false);
    const exec = new RisingSeaLevelExecution();
    game.addExecution(exec);
    const before = game.numLandTiles();
    run(game, FIRST_FLOOD_TICK + 600 * 10);
    expect(exec.isActive()).toBe(false);
    expect(game.numLandTiles()).toBe(before);
  });

  it("is deterministic across two independently built games", async () => {
    const a = await floodGame("fast");
    const b = await floodGame("fast");
    for (let i = 0; i < FIRST_FLOOD_TICK + 300 * 10; i++) {
      a.game.executeNextTick();
      b.game.executeNextTick();
      expect(a.game.numLandTiles()).toBe(b.game.numLandTiles());
    }
    expect(a.exec.flooded()).toBe(b.exec.flooded());
    expect(a.exec.waterline()).toBe(b.exec.waterline());
  });

  it("removes a structure standing on flooded land", async () => {
    // The flood does not delete units itself; PlayerExecution already removes a
    // structure whose ground its owner no longer holds, and relinquish makes the
    // tile unowned a tick before it turns to water.
    const game = await setup(
      "ocean_and_land",
      {
        instantBuild: true,
        risingSeaLevel: { enabled: true, speed: "veryfast" },
      },
      [playerInfo("builder", PlayerType.Human)],
    );
    const player = game.player("builder");
    const held: TileRef[] = [];
    game.forEachTile((t: TileRef) => {
      if (game.isLand(t) && !game.isImpassable(t) && !game.hasOwner(t)) {
        player.conquer(t);
        held.push(t);
      }
    });
    const city = held[0];
    player.buildUnit(UnitType.City, city, {});
    expect(player.units(UnitType.City)).toHaveLength(1);

    game.addExecution(new PlayerExecution(player));
    game.addExecution(new RisingSeaLevelExecution());
    run(game, FIRST_FLOOD_TICK + 400 * 10);

    expect(game.isWater(city)).toBe(true);
    expect(player.units(UnitType.City)).toHaveLength(0);
    // Only the dry reserve is left of what the player held.
    expect(player.numTilesOwned()).toBeLessThanOrEqual(
      risingSeaReserveTiles(held.length) + 1,
    );
  });

  it("eliminates a player whose last land goes under", async () => {
    // Death by sea has no killer. PlayerExecution's elimination path runs off
    // numTilesOwned() alone, so it must fire here exactly as it does for a
    // conquest — otherwise a drowned player would linger as alive with no land.
    const game = await setup(
      "ocean_and_land",
      { risingSeaLevel: { enabled: true, speed: "veryfast" } },
      [playerInfo("drowned", PlayerType.Human)],
    );
    const player = game.player("drowned");
    // The reserve leaves a little land dry, so seed the player on the small
    // island instead: an island floods out entirely, reserve or not.
    let island: TileRef | null = null;
    game.forEachTile((t: TileRef) => {
      if (island === null && game.isLand(t) && game.isShore(t)) island = t;
    });
    expect(island).not.toBeNull();
    player.conquer(island!);
    expect(player.isAlive()).toBe(true);

    game.addExecution(new PlayerExecution(player));
    game.addExecution(new RisingSeaLevelExecution());
    run(game, FIRST_FLOOD_TICK + 400 * 10);

    expect(game.isWater(island!)).toBe(true);
    expect(player.numTilesOwned()).toBe(0);
    expect(player.isAlive()).toBe(false);
  });
});
