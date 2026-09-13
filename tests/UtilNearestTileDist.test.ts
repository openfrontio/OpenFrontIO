import {
  nearestTileDist,
  nearestTileDistCapped,
} from "../src/core/execution/Util";
import { Game, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { GameMap, TileRef } from "../src/core/game/GameMap";
import { TileSet } from "../src/core/game/TileSet";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";

// nearestTileDistCapped replaces a linear scan with a Manhattan-ring walk
// (map-boundary clamped); cross-check it against brute force on a real map,
// through both branches — the TileSet fast path and the iterable fallback.
describe("nearestTileDistCapped vs brute force", () => {
  let g: Game;
  let map: GameMap;

  beforeEach(async () => {
    g = await setup("plains", {}, [
      new PlayerInfo("player1", PlayerType.Human, "c1", "p1"),
    ]);
    map = g.map();
  });

  function brute(tiles: Iterable<TileRef>, tile: TileRef): number {
    let best = Infinity;
    for (const t of tiles) best = Math.min(best, g.manhattanDist(t, tile));
    return best;
  }

  test("agrees with brute force across caps, edges and membership", () => {
    const rand = new PseudoRandom(1234);
    const w = map.width();
    const h = map.height();
    const members: TileRef[] = [];
    for (let i = 0; i < 60; i++) {
      // scattered, deliberately including the map's edges and corners
      members.push(map.ref(rand.nextInt(0, w), rand.nextInt(0, h)));
    }
    const set = new TileSet(members);
    const probes: TileRef[] = [
      map.ref(0, 0),
      map.ref(w - 1, 0),
      map.ref(0, h - 1),
      map.ref(w - 1, h - 1),
      map.ref((w / 2) | 0, (h / 2) | 0),
      members[7], // a member: distance 0
    ];
    for (let i = 0; i < 30; i++) {
      probes.push(map.ref(rand.nextInt(0, w), rand.nextInt(0, h)));
    }
    for (const probe of probes) {
      const d = brute(set, probe);
      expect(nearestTileDist(map, set, probe)).toBe(d);
      // caps straddling the true distance, including exactly at it
      const caps = [0, 1, 5, 15, 40];
      if (Number.isFinite(d)) caps.push(d, d - 1, d + 1);
      for (const cap of caps) {
        if (cap < 0) continue;
        const expected = d <= cap ? d : Infinity;
        expect(nearestTileDistCapped(map, set, probe, cap)).toBe(expected);
        // the iterable fallback must answer identically
        expect(nearestTileDistCapped(map, members, probe, cap)).toBe(expected);
      }
    }
  });

  test("empty set is Infinity on both branches", () => {
    const probe = map.ref(3, 3);
    expect(nearestTileDist(map, [], probe)).toBe(Infinity);
    expect(nearestTileDistCapped(map, new TileSet(), probe, 25)).toBe(Infinity);
    expect(nearestTileDistCapped(map, [], probe, 25)).toBe(Infinity);
  });
});
