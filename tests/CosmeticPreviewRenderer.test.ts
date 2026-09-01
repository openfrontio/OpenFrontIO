import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MIRV_WARHEAD_TARGETS,
  PreviewAnimationTicker,
} from "../src/client/render/preview/PreviewAnimationTicker";
import {
  buildPreviewMap,
  getPreviewRailLoop,
  PREVIEW_MAP_H,
  PREVIEW_MAP_W,
  PREVIEW_RAIL_STATIONS,
  PREVIEW_SCENE,
  previewTileRef,
} from "../src/client/render/preview/PreviewMap";

const PREVIEW_MAP_DIM = PREVIEW_MAP_W;

describe("PreviewMap", () => {
  it("owns every land tile of the terrain and nothing else", () => {
    const terrain = new Uint8Array(PREVIEW_MAP_W * PREVIEW_MAP_H);
    terrain[previewTileRef(10, 10)] = 0x80 | 4; // land
    terrain[previewTileRef(11, 10)] = 0x80 | 0x40 | 1; // shoreline land
    terrain[previewTileRef(12, 10)] = 0x20 | 3; // ocean
    const map = buildPreviewMap(terrain);
    expect(map.mapW).toBe(PREVIEW_MAP_W);
    expect(map.mapH).toBe(PREVIEW_MAP_H);
    expect(map.tileState[previewTileRef(10, 10)]).toBe(1);
    expect(map.tileState[previewTileRef(11, 10)]).toBe(1);
    expect(map.tileState[previewTileRef(12, 10)]).toBe(0);
    expect(() => buildPreviewMap(new Uint8Array(10))).toThrow();
  });

  it("places every scene on the right kind of Australia terrain", () => {
    // The real map asset: scene anchors are fixed tile coords, so a re-export
    // of the map that moves a coastline must show up here, not in the store.
    const bin = readFileSync("resources/maps/australia/map4x.bin");
    const manifest = JSON.parse(
      readFileSync("resources/maps/australia/manifest.json", "utf8"),
    );
    expect(manifest.map4x.width).toBe(PREVIEW_MAP_W);
    expect(manifest.map4x.height).toBe(PREVIEW_MAP_H);
    const map = buildPreviewMap(new Uint8Array(bin));
    const isLand = (x: number, y: number) =>
      (map.terrainBytes[previewTileRef(x, y)] & 0x80) !== 0;

    // Inland scene: skin anchor, nuke target and the whole rail loop on land.
    expect(isLand(PREVIEW_SCENE.land.x, PREVIEW_SCENE.land.y)).toBe(true);
    for (const t of MIRV_WARHEAD_TARGETS) expect(isLand(t.x, t.y)).toBe(true);
    for (const ref of getPreviewRailLoop().path) {
      expect(map.terrainBytes[ref] & 0x80).toBe(0x80);
    }
    // Patrol square entirely in open water.
    for (const dx of [-24, 24])
      for (const dy of [-24, 24])
        expect(
          isLand(PREVIEW_SCENE.ocean.x + dx, PREVIEW_SCENE.ocean.y + dy),
        ).toBe(false);
    // Coast: shoreline tile with land to the north and water to the south.
    const c = PREVIEW_SCENE.coast;
    expect(isLand(c.x, c.y)).toBe(true);
    expect(isLand(c.x, c.y - 92)).toBe(true);
    expect(isLand(c.x, c.y + 8)).toBe(false);
    const buildings = new PreviewAnimationTicker({ mode: "BUILDING" }).sample(
      0,
    ).structures!;
    for (const b of buildings) expect(map.tileState[b.pos]).toBe(1);
  });
});

describe("PreviewAnimationTicker", () => {
  it("samples single city for size reference with no missiles in SKIN mode", () => {
    const ticker = new PreviewAnimationTicker({
      mode: "SKIN",
    });
    const snapshot = ticker.sample(performance.now());
    expect(snapshot.units.length).toBe(0);
    expect(snapshot.structures?.length).toBe(1);
    expect(snapshot.structures?.[0].unitType).toBe("City");
    expect(snapshot.spiralRibbons.length).toBe(0);
    expect(snapshot.detonationEvents.length).toBe(0);
  });

  it("samples all structures showcase in BUILDING mode", () => {
    const ticker = new PreviewAnimationTicker({
      mode: "BUILDING",
    });
    const snapshot = ticker.sample(performance.now());
    expect(snapshot.units.length).toBe(0);
    expect(snapshot.structures?.length).toBe(6);
    const unitTypes = (snapshot.structures ?? []).map((u) => u.unitType);
    expect(unitTypes).toContain("Port");
    expect(unitTypes).toContain("City");
    expect(unitTypes).toContain("Factory");
    expect(unitTypes).toContain("Defense Post");
    expect(unitTypes).toContain("SAM Launcher");
    expect(unitTypes).toContain("Missile Silo");
    expect(snapshot.detonationEvents.length).toBe(0);
  });

  it("samples transport movement and contiguous wake trail in WARSHIP_BOAT_TRAIL mode", () => {
    const ticker = new PreviewAnimationTicker({
      mode: "WARSHIP_BOAT_TRAIL",
      cosmeticUnitType: "Transport",
    });
    const snapshot = ticker.sample(performance.now());
    expect(snapshot.units.length).toBe(1);
    expect(snapshot.units[0].unitType).toBe("Transport");
    expect(snapshot.trailPoints.length).toBeGreaterThan(0);
  });

  it("gives warships no wake — only transports leave trails in-game", () => {
    const ticker = new PreviewAnimationTicker({
      mode: "WARSHIP_BOAT_TRAIL",
      cosmeticUnitType: "Warship",
    });
    const snapshot = ticker.sample(performance.now() + 3000);
    expect(snapshot.units.length).toBe(1);
    expect(snapshot.units[0].unitType).toBe("Warship");
    expect(snapshot.trailPoints.length).toBe(0);
  });

  it("samples nuke flight and detonation cycle", () => {
    const ticker = new PreviewAnimationTicker({
      mode: "NUKE_MISSILE_TRAIL",
      cosmeticUnitType: "Hydrogen Bomb",
    });
    // Sample flight phase (t = 1.0s)
    const flightSnapshot = ticker.sample(performance.now());
    expect(
      flightSnapshot.units.length + flightSnapshot.trailPoints.length,
    ).toBeGreaterThan(0);

    // Sample detonation phase (simulate t = 4.0s)
    const detTicker = new PreviewAnimationTicker({
      mode: "NUKE_EXPLOSION",
    });
    const detSnapshot = detTicker.sample(performance.now() + 4000);
    expect(detSnapshot.units.length).toBe(0);
  });

  it("drops the nuke trail the moment the nuke detonates", () => {
    const start = 1000;
    const ticker = new PreviewAnimationTicker(
      { mode: "NUKE_EXPLOSION", cosmeticUnitType: "Atom Bomb" },
      start,
    );
    const inFlight = ticker.sample(start + 3300);
    expect(inFlight.units.length).toBe(1);
    expect(inFlight.trailPoints.length).toBeGreaterThan(0);

    // Flight lasts 3.4s; the explosion then plays for seconds, but the trail
    // must be gone as soon as the missile is (in-game TrailManager behavior).
    const detonated = ticker.sample(start + 3500);
    expect(detonated.units.length).toBe(0);
    expect(detonated.detonationEvents.length).toBe(1);
    expect(detonated.trailPoints.length).toBe(0);
    expect(ticker.sample(start + 5000).trailPoints.length).toBe(0);
  });

  it("keeps lastPos one tick (100ms) behind pos so UnitPass can smooth per tick", () => {
    const start = 1000;
    const ticker = new PreviewAnimationTicker(
      { mode: "NUKE_MISSILE_TRAIL", cosmeticUnitType: "Atom Bomb" },
      start,
    );
    const now = ticker.sample(start + 2000).units[0];
    const oneTickAgo = ticker.sample(start + 1900).units[0];
    expect(now.lastPos).toBe(oneTickAgo.pos);
    expect(now.lastPos).not.toBe(now.pos);
  });

  it("samples MIRV carrier scatter into 8 warheads and cluster impact explosions", () => {
    const ticker = new PreviewAnimationTicker({
      mode: "MIRV_CLUSTER",
      cosmeticUnitType: "MIRV",
    });
    // Mid flight warheads phase (simulate t = 2.6s)
    const warheadSnapshot = ticker.sample(performance.now() + 2600);
    expect(warheadSnapshot.units.length).toBe(8);
    expect(warheadSnapshot.units[0].unitType).toBe("MIRV Warhead");
    expect(warheadSnapshot.trailPoints.length).toBeGreaterThan(0);

    // Detonation phase (simulate t = 4.5s): warheads and their trails are gone
    const detSnapshot = ticker.sample(performance.now() + 4500);
    expect(detSnapshot.units.length).toBe(0);
    expect(detSnapshot.trailPoints.length).toBe(0);
  });

  it("runs a 7-car train around the rail loop between the city and factory stations", () => {
    const { path, railroadState } = getPreviewRailLoop();
    const w = PREVIEW_MAP_DIM;
    // The loop passes through both stations and every tile of it is a rail.
    const cityRef =
      PREVIEW_RAIL_STATIONS.city.y * w + PREVIEW_RAIL_STATIONS.city.x;
    const factoryRef =
      PREVIEW_RAIL_STATIONS.factory.y * w + PREVIEW_RAIL_STATIONS.factory.x;
    expect(path).toContain(cityRef);
    expect(path).toContain(factoryRef);
    expect(new Set(path).size).toBe(path.length);
    for (const ref of path) expect(railroadState[ref]).toBeGreaterThan(0);

    for (const mode of ["TRAIN", "RAILROAD"] as const) {
      const start = 1000;
      const ticker = new PreviewAnimationTicker({ mode }, start);
      const snapshot = ticker.sample(start + 3000);
      expect(snapshot.structures?.map((u) => u.unitType)).toEqual([
        "City",
        "Factory",
      ]);
      expect(snapshot.units.length).toBe(7);
      expect(snapshot.units.every((u) => u.unitType === "Train")).toBe(true);
      // Every car sits on the rails, at a distinct tile, one tick behind pos.
      const positions = new Set(snapshot.units.map((u) => u.pos));
      expect(positions.size).toBe(7);
      for (const u of snapshot.units) {
        expect(railroadState[u.pos]).toBeGreaterThan(0);
        expect(railroadState[u.lastPos]).toBeGreaterThan(0);
        expect(u.lastPos).not.toBe(u.pos);
      }
      // In-game speed: 2 tiles per 100ms tick.
      const later = ticker.sample(start + 3100).units[0];
      expect(
        path.indexOf(later.pos) - path.indexOf(snapshot.units[0].pos),
      ).toBe(2);
    }
  });

  it("samples 5-nuke salvo mode with staggered missiles and sequential detonations", () => {
    const ticker = new PreviewAnimationTicker({
      mode: "NUKE_EXPLOSION",
      cosmeticUnitType: "Atom Bomb",
      salvoMode: true,
    });
    // In mid-flight of salvo (t = 1.0s), multiple atom bombs should be in flight
    const flightSnapshot = ticker.sample(performance.now() + 1000);
    expect(flightSnapshot.units.length).toBe(5);
    expect(flightSnapshot.units[0].unitType).toBe("Atom Bomb");
    expect(flightSnapshot.trailPoints.length).toBeGreaterThan(0);
  });
});
