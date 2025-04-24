export enum MapCategory {
  Continental = "continental",
  Regional = "regional",
  Fantasy = "fantasy",
}

export enum LobbySizeGroup {
  Group4M = "4M", // Original ~4M pixel maps
  Group3M = "3M", // Original ~2.5-3.5M pixel maps
  Group2M = "2M", // Original ~2M pixel maps
  GroupSmall = "Small", // Original <2M pixel maps
  World = "World", // Special case for World
}

export interface MapDefinition {
  identifier: string;
  category: MapCategory;
  lobbySizeGroup: LobbySizeGroup;
  playlistWeightBig?: number;
  playlistWeightSmall?: number;
}
