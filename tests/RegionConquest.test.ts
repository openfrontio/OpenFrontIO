/**
 * Engine-level tests for region-based conquest ("majority snap") on the
 * 100x100 all-land `plains` fixture with a programmatic 4-quadrant region
 * raster (regions 1..4, 2500 tiles each; majority = 1251 tiles).
 */
import { AttackExecution } from "../src/core/execution/AttackExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

const W = 100;
const H = 100;
const REGION_TILES = 2500;
const MAJORITY = 1251;

/** Quadrant regions: 1=(x<50,y<50), 2=(x>=50,y<50), 3=(x<50,y>=50), 4=rest. */
function quadrantRaster(): Uint16Array {
  const raster = new Uint16Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const id = (x < 50 ? 0 : 1) + (y < 50 ? 0 : 2) + 1;
      raster[y * W + x] = id;
    }
  }
  return raster;
}

/** First `n` tiles of region 1 in row-major (ascending TileRef) order. */
function region1Tiles(n: number): number[] {
  const tiles: number[] = [];
  for (let y = 0; y < 50 && tiles.length < n; y++) {
    for (let x = 0; x < 50 && tiles.length < n; x++) {
      tiles.push(y * W + x);
    }
  }
  return tiles;
}

function countRegion1TilesOwnedBy(game: Game, player: Player): number {
  let owned = 0;
  for (let y = 0; y < 50; y++) {
    for (let x = 0; x < 50; x++) {
      if (game.owner(game.ref(x, y)) === player) owned++;
    }
  }
  return owned;
}

function addPlayer(game: Game, id: string): Player {
  const info = new PlayerInfo(id, PlayerType.Human, null, id);
  game.addPlayer(info);
  return game.player(id);
}

async function setupGame(autoEndSpawnPhase = true): Promise<Game> {
  return setup(
    "plains",
    {},
    [],
    undefined,
    undefined,
    autoEndSpawnPhase,
    quadrantRaster(),
  );
}

describe("Region conquest (majority snap)", () => {
  test("no snap at exactly half of a region", async () => {
    const game = await setupGame();
    const p = addPlayer(game, "p1");
    for (const t of region1Tiles(1250)) p.conquer(t);
    expect(p.numTilesOwned()).toBe(1250);
    expect(countRegion1TilesOwnedBy(game, p)).toBe(1250);
  });

  test("crossing the majority snaps the whole region", async () => {
    const game = await setupGame();
    const p = addPlayer(game, "p1");
    for (const t of region1Tiles(MAJORITY)) p.conquer(t);
    // Snap: every region-1 tile flips; other quadrants untouched.
    expect(p.numTilesOwned()).toBe(REGION_TILES);
    expect(countRegion1TilesOwnedBy(game, p)).toBe(REGION_TILES);
    expect(game.hasOwner(game.ref(50, 0))).toBe(false); // region 2
    expect(game.hasOwner(game.ref(0, 50))).toBe(false); // region 3
  });

  test("snap takes enemy-held tiles in the region", async () => {
    const game = await setupGame();
    const p = addPlayer(game, "p1");
    const enemy = addPlayer(game, "p2");
    // Enemy holds the bottom rows of region 1 (still < majority).
    for (let y = 45; y < 50; y++) {
      for (let x = 0; x < 50; x++) enemy.conquer(game.ref(x, y));
    }
    expect(enemy.numTilesOwned()).toBe(250);
    for (const t of region1Tiles(MAJORITY)) p.conquer(t);
    expect(p.numTilesOwned()).toBe(REGION_TILES);
    expect(enemy.numTilesOwned()).toBe(0);
  });

  test("snap leaves ally-owned tiles untouched", async () => {
    const game = await setupGame();
    const p = addPlayer(game, "p1");
    const ally = addPlayer(game, "p2");
    const request = p.createAllianceRequest(ally);
    expect(request).not.toBeNull();
    request!.accept();
    expect(p.isFriendly(ally)).toBe(true);
    for (let y = 45; y < 50; y++) {
      for (let x = 0; x < 50; x++) ally.conquer(game.ref(x, y));
    }
    for (const t of region1Tiles(MAJORITY)) p.conquer(t);
    // Ally keeps its 250 tiles; p gets the rest of the region.
    expect(ally.numTilesOwned()).toBe(250);
    expect(p.numTilesOwned()).toBe(REGION_TILES - 250);
  });

  test("no snap during the spawn phase; snap resumes after", async () => {
    const game = await setupGame(false);
    expect(game.inSpawnPhase()).toBe(true);
    const p = addPlayer(game, "p1");
    for (const t of region1Tiles(MAJORITY)) p.conquer(t);
    // Crossed the majority during spawn — counts tracked, but no snap.
    expect(p.numTilesOwned()).toBe(MAJORITY);

    // Drop below the bar, end spawn, re-cross: snap fires.
    const lastTile = region1Tiles(MAJORITY)[MAJORITY - 1];
    p.relinquish(lastTile);
    expect(p.numTilesOwned()).toBe(MAJORITY - 1);
    game.endSpawnPhase();
    p.conquer(lastTile);
    expect(p.numTilesOwned()).toBe(REGION_TILES);
  });

  test("defender re-crossing the majority snaps the region back (symmetry)", async () => {
    const game = await setupGame();
    const attacker = addPlayer(game, "p1");
    const defender = addPlayer(game, "p2");
    for (const t of region1Tiles(MAJORITY)) attacker.conquer(t);
    expect(attacker.numTilesOwned()).toBe(REGION_TILES);

    // Defender grinds tiles back; no snap until IT crosses the majority.
    const tiles = region1Tiles(REGION_TILES);
    for (let i = 0; i < MAJORITY - 1; i++) defender.conquer(tiles[i]);
    expect(defender.numTilesOwned()).toBe(MAJORITY - 1);
    expect(attacker.numTilesOwned()).toBe(REGION_TILES - (MAJORITY - 1));

    defender.conquer(tiles[MAJORITY - 1]); // crossing → snap back
    expect(defender.numTilesOwned()).toBe(REGION_TILES);
    expect(attacker.numTilesOwned()).toBe(0);
  });

  test("region ownership counters stay exact through a snap", async () => {
    const game = await setupGame();
    const p = addPlayer(game, "p1");
    const enemy = addPlayer(game, "p2");
    for (let y = 45; y < 50; y++) {
      for (let x = 0; x < 50; x++) enemy.conquer(game.ref(x, y));
    }
    for (const t of region1Tiles(MAJORITY)) p.conquer(t);
    // After the snap the defender can retake tile by tile without an
    // immediate counter-snap (p already holds a majority — no re-crossing).
    enemy.conquer(game.ref(0, 49));
    expect(enemy.numTilesOwned()).toBe(1);
    expect(p.numTilesOwned()).toBe(REGION_TILES - 1);
  });

  test("end-to-end: a real AttackExecution triggers the snap and continues", async () => {
    const game = await setupGame();
    const p = addPlayer(game, "p1");
    const other = addPlayer(game, "p2");

    game.addExecution(
      new SpawnExecution("game_id", p.info(), game.ref(25, 25)),
      new SpawnExecution("game_id", other.info(), game.ref(75, 75)),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(p.numTilesOwned()).toBeGreaterThan(0);
    expect(p.numTilesOwned()).toBeLessThan(1250);

    game.addExecution(new AttackExecution(50_000, p, game.terraNullius().id()));

    let snapped = false;
    for (let i = 0; i < 5000; i++) {
      game.executeNextTick();
      if (countRegion1TilesOwnedBy(game, p) === REGION_TILES) {
        snapped = true;
        break;
      }
    }
    expect(snapped).toBe(true);

    // The attack keeps grinding into the neighboring regions; troop
    // accounting stays sane and nothing throws on the stale queue entries.
    const ownedAtSnap = p.numTilesOwned();
    for (let i = 0; i < 200; i++) game.executeNextTick();
    expect(p.numTilesOwned()).toBeGreaterThanOrEqual(ownedAtSnap);
    expect(p.troops()).toBeGreaterThanOrEqual(0);
    for (const attack of p.outgoingAttacks()) {
      expect(Number.isFinite(attack.troops())).toBe(true);
    }
  });

  test("maps without region data behave exactly as before", async () => {
    const game = await setup("plains"); // no regionRaster
    const p = addPlayer(game, "p1");
    for (const t of region1Tiles(MAJORITY)) p.conquer(t);
    expect(p.numTilesOwned()).toBe(MAJORITY); // no snap
    expect(game.regionMap()).toBe(null);
  });
});
