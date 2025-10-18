import { GameMapType } from "./Game";

/**
 * This module provides nation counts for each map by directly importing
 * the manifest files. This ensures the counts are always in sync with
 * the actual map data.
 *
 * NOTE: This module should only be used on the server side where
 * manifest files are available. It must be explicitly initialized via
 * initMapNationCounts() before use.
 */

const manifests = {
  [GameMapType.Africa]: () =>
    import("../../../resources/maps/africa/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.Asia]: () =>
    import("../../../resources/maps/asia/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.Australia]: () =>
    import("../../../resources/maps/australia/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.Baikal]: () =>
    import("../../../resources/maps/baikal/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.BetweenTwoSeas]: () =>
    import("../../../resources/maps/betweentwoseas/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.BlackSea]: () =>
    import("../../../resources/maps/blacksea/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.Britannia]: () =>
    import("../../../resources/maps/britannia/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.DeglaciatedAntarctica]: () =>
    import("../../../resources/maps/deglaciatedantarctica/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.EastAsia]: () =>
    import("../../../resources/maps/eastasia/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.Europe]: () =>
    import("../../../resources/maps/europe/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.EuropeClassic]: () =>
    import("../../../resources/maps/europeclassic/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.FalklandIslands]: () =>
    import("../../../resources/maps/falklandislands/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.FaroeIslands]: () =>
    import("../../../resources/maps/faroeislands/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.GatewayToTheAtlantic]: () =>
    import("../../../resources/maps/gatewaytotheatlantic/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.GiantWorldMap]: () =>
    import("../../../resources/maps/giantworldmap/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.Halkidiki]: () =>
    import("../../../resources/maps/halkidiki/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.Iceland]: () =>
    import("../../../resources/maps/iceland/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.Italia]: () =>
    import("../../../resources/maps/italia/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.Japan]: () =>
    import("../../../resources/maps/japan/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.Mars]: () =>
    import("../../../resources/maps/mars/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.Mena]: () =>
    import("../../../resources/maps/mena/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.Montreal]: () =>
    import("../../../resources/maps/montreal/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.NorthAmerica]: () =>
    import("../../../resources/maps/northamerica/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.Oceania]: () =>
    import("../../../resources/maps/oceania/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.Pangaea]: () =>
    import("../../../resources/maps/pangaea/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.Pluto]: () =>
    import("../../../resources/maps/pluto/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.SouthAmerica]: () =>
    import("../../../resources/maps/southamerica/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.StraitOfGibraltar]: () =>
    import("../../../resources/maps/straitofgibraltar/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.World]: () =>
    import("../../../resources/maps/world/manifest.json", {
      with: { type: "json" },
    }),
  [GameMapType.Yenisei]: () =>
    import("../../../resources/maps/yenisei/manifest.json", {
      with: { type: "json" },
    }),
} as const;

type ManifestModule = { default: { nations: unknown[] } };

let nationCountCache: Record<GameMapType, number> | null = null;
let initPromise: Promise<void> | null = null;

async function loadNationCounts(): Promise<Record<GameMapType, number>> {
  const counts = {} as Record<GameMapType, number>;

  await Promise.all(
    Object.entries(manifests).map(async ([mapType, loader]) => {
      const manifest = (await loader()) as ManifestModule;
      counts[mapType as GameMapType] = manifest.default.nations.length;
    }),
  );

  return counts;
}

export function getNationCount(map: GameMapType): number {
  if (!nationCountCache) {
    // Return fallback values if not initialized (e.g., on client side)
    // These match the actual nation counts from the manifest files for now.
    const fallbackCounts: Record<GameMapType, number> = {
      [GameMapType.Africa]: 36,
      [GameMapType.Asia]: 25,
      [GameMapType.Australia]: 7,
      [GameMapType.Baikal]: 11,
      [GameMapType.BetweenTwoSeas]: 15,
      [GameMapType.BlackSea]: 9,
      [GameMapType.Britannia]: 23,
      [GameMapType.DeglaciatedAntarctica]: 9,
      [GameMapType.EastAsia]: 22,
      [GameMapType.Europe]: 49,
      [GameMapType.EuropeClassic]: 31,
      [GameMapType.FalklandIslands]: 12,
      [GameMapType.FaroeIslands]: 6,
      [GameMapType.GatewayToTheAtlantic]: 30,
      [GameMapType.GiantWorldMap]: 97,
      [GameMapType.Halkidiki]: 8,
      [GameMapType.Iceland]: 8,
      [GameMapType.Italia]: 12,
      [GameMapType.Japan]: 12,
      [GameMapType.Mars]: 6,
      [GameMapType.Mena]: 35,
      [GameMapType.Montreal]: 3,
      [GameMapType.NorthAmerica]: 49,
      [GameMapType.Oceania]: 32,
      [GameMapType.Pangaea]: 29,
      [GameMapType.Pluto]: 16,
      [GameMapType.SouthAmerica]: 24,
      [GameMapType.StraitOfGibraltar]: 7,
      [GameMapType.World]: 61,
      [GameMapType.Yenisei]: 6,
    };
    return fallbackCounts[map] ?? 20;
  }
  return nationCountCache[map] ?? 20;
}

/**
 * Ensures nation counts are loaded from manifest files.
 * Call this during server startup. Safe to call multiple times.
 */
export async function initMapNationCounts(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = loadNationCounts().then((counts) => {
    nationCountCache = counts;
  });

  return initPromise;
}

/**
 * Gets the cached nation counts. Returns null if not yet initialized.
 */
export function getNationCountsSync(): Record<GameMapType, number> | null {
  return nationCountCache;
}
