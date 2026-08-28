import { describe, expect, it } from "vitest";
import { PreviewAnimationTicker } from "../src/client/render/preview/PreviewAnimationTicker";
import {
  generatePreviewMap,
  PREVIEW_MAP_DIM,
  type PreviewTerrainPreset,
} from "../src/client/render/preview/PreviewMapGenerator";

describe("PreviewMapGenerator", () => {
  const presets: PreviewTerrainPreset[] = [
    "CONTINENTAL_ARCHIPELAGO",
    "OPEN_OCEAN",
    "COASTAL_BASEPLATE",
  ];

  presets.forEach((preset) => {
    it(`generates valid 512x512 map for preset ${preset}`, () => {
      const map = generatePreviewMap(preset);
      expect(map.mapW).toBe(PREVIEW_MAP_DIM);
      expect(map.mapH).toBe(PREVIEW_MAP_DIM);
      expect(map.terrainBytes.length).toBe(PREVIEW_MAP_DIM * PREVIEW_MAP_DIM);
      expect(map.tileState.length).toBe(PREVIEW_MAP_DIM * PREVIEW_MAP_DIM);

      if (preset === "OPEN_OCEAN") {
        // Deep ocean tiles have bit 5 set (0x20)
        expect(map.terrainBytes[0] & 0x20).toBe(0x20);
      } else if (preset === "CONTINENTAL_ARCHIPELAGO") {
        // Center tile should be land (bit 7: 0x80)
        const centerIdx =
          (PREVIEW_MAP_DIM / 2) * PREVIEW_MAP_DIM + PREVIEW_MAP_DIM / 2;
        expect(map.terrainBytes[centerIdx] & 0x80).toBe(0x80);
        expect(map.tileState[centerIdx]).toBe(1);
      }
    });
  });
});

describe("PreviewAnimationTicker", () => {
  it("samples single city for size reference with no missiles in SKIN mode", () => {
    const ticker = new PreviewAnimationTicker({
      mode: "SKIN",
    });
    const snapshot = ticker.sample(performance.now());
    expect(snapshot.units.length).toBe(1);
    expect(snapshot.units[0].unitType).toBe("City");
    expect(snapshot.spiralRibbons.length).toBe(0);
    expect(snapshot.detonationEvents.length).toBe(0);
  });

  it("samples all structures showcase in BUILDING mode", () => {
    const ticker = new PreviewAnimationTicker({
      mode: "BUILDING",
    });
    const snapshot = ticker.sample(performance.now());
    expect(snapshot.units.length).toBe(6);
    const unitTypes = snapshot.units.map((u) => u.unitType);
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
