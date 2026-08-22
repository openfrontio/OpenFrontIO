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

  it("samples warship movement and contiguous wake trail in WARSHIP_BOAT_TRAIL mode", () => {
    const ticker = new PreviewAnimationTicker({
      mode: "WARSHIP_BOAT_TRAIL",
      cosmeticUnitType: "Warship",
    });
    const snapshot = ticker.sample(performance.now());
    expect(snapshot.units.length).toBe(1);
    expect(snapshot.units[0].unitType).toBe("Warship");
    expect(snapshot.trailPoints.length).toBeGreaterThan(0);
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

  it("samples MIRV carrier scatter into 8 warheads and cluster impact explosions", () => {
    const ticker = new PreviewAnimationTicker({
      mode: "MIRV_CLUSTER",
      cosmeticUnitType: "MIRV",
    });
    // Mid flight warheads phase (simulate t = 2.6s)
    const warheadSnapshot = ticker.sample(performance.now() + 2600);
    expect(warheadSnapshot.units.length).toBe(8);
    expect(warheadSnapshot.units[0].unitType).toBe("MIRV Warhead");

    // Detonation phase (simulate t = 4.5s)
    const detSnapshot = ticker.sample(performance.now() + 4500);
    expect(detSnapshot.units.length).toBe(0);
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
