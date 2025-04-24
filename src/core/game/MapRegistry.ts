import { GameMapType } from "./Game";
import { LobbySizeGroup, MapCategory, MapDefinition } from "./MapRegistryTypes";

export const MAP_DEFINITIONS: Readonly<MapDefinition[]> = [
  // Continental
  {
    identifier: "World",
    category: MapCategory.Continental,
    lobbySizeGroup: LobbySizeGroup.World,
    playlistWeightSmall: 4,
  },
  {
    identifier: "SouthAmerica",
    category: MapCategory.Continental,
    lobbySizeGroup: LobbySizeGroup.Group4M,
    playlistWeightBig: 1,
  },
  {
    identifier: "NorthAmerica",
    category: MapCategory.Continental,
    lobbySizeGroup: LobbySizeGroup.Group4M,
    playlistWeightBig: 1,
  },
  {
    identifier: "Africa",
    category: MapCategory.Continental,
    lobbySizeGroup: LobbySizeGroup.Group4M,
    playlistWeightBig: 2,
  },
  {
    identifier: "Europe",
    category: MapCategory.Continental,
    lobbySizeGroup: LobbySizeGroup.Group4M,
    playlistWeightBig: 2,
  },
  {
    identifier: "Asia",
    category: MapCategory.Continental,
    lobbySizeGroup: LobbySizeGroup.Group3M,
    playlistWeightSmall: 1,
  },
  {
    identifier: "Oceania",
    category: MapCategory.Continental,
    lobbySizeGroup: LobbySizeGroup.Group2M,
    playlistWeightSmall: 1,
  },

  // Regional
  {
    identifier: "GatewayToTheAtlantic",
    category: MapCategory.Regional,
    lobbySizeGroup: LobbySizeGroup.Group4M,
    playlistWeightBig: 2,
  },
  {
    identifier: "Australia",
    category: MapCategory.Regional,
    lobbySizeGroup: LobbySizeGroup.Group3M,
    playlistWeightBig: 2,
  },
  {
    identifier: "Iceland",
    category: MapCategory.Regional,
    lobbySizeGroup: LobbySizeGroup.Group3M,
    playlistWeightBig: 2,
  },
  {
    identifier: "Britannia",
    category: MapCategory.Regional,
    lobbySizeGroup: LobbySizeGroup.Group3M,
    playlistWeightBig: 1,
  },
  {
    identifier: "Mena",
    category: MapCategory.Regional,
    lobbySizeGroup: LobbySizeGroup.Group2M,
    playlistWeightSmall: 2,
  },
  {
    identifier: "Japan",
    category: MapCategory.Regional,
    lobbySizeGroup: LobbySizeGroup.Group2M,
    playlistWeightSmall: 2,
  },
  {
    identifier: "FaroeIslands",
    category: MapCategory.Regional,
    lobbySizeGroup: LobbySizeGroup.Group2M,
    playlistWeightSmall: 2,
  },
  {
    identifier: "BetweenTwoSeas",
    category: MapCategory.Regional,
    lobbySizeGroup: LobbySizeGroup.GroupSmall,
    playlistWeightSmall: 2,
  },
  {
    identifier: "BlackSea",
    category: MapCategory.Regional,
    lobbySizeGroup: LobbySizeGroup.GroupSmall,
    playlistWeightSmall: 1,
  },

  // Fantasy
  {
    identifier: "Mars",
    category: MapCategory.Fantasy,
    lobbySizeGroup: LobbySizeGroup.Group2M,
    playlistWeightSmall: 1,
  },
  {
    identifier: "KnownWorld",
    category: MapCategory.Fantasy,
    lobbySizeGroup: LobbySizeGroup.Group2M,
    playlistWeightBig: 2,
  },
  {
    identifier: "Pangaea",
    category: MapCategory.Fantasy,
    lobbySizeGroup: LobbySizeGroup.GroupSmall,
    playlistWeightSmall: 1,
  },
];

// Helper function to get definition by identifier (which is now key and value)
export function getMapDefinition(
  identifier: GameMapType | string,
): MapDefinition | undefined {
  // identifier is always string because GameMapType is now Record<string, string> essentially
  return MAP_DEFINITIONS.find((def) => def.identifier === identifier);
}

// Helper to get the specific filename, handling the WorldMap exception
export function getMapFileName(
  identifier: GameMapType | string,
): string | undefined {
  // Explicitly check against the enum value for World
  if (identifier === GameMapType.World) {
    return "WorldMap"; // The special case filename
  }
  const definition = getMapDefinition(identifier);
  return definition?.identifier; // For all others, filename matches identifier
}
