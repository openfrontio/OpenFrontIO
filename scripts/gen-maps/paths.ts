import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/** This file lives in scripts/gen-maps; the maps' sources in map-generator. */
export const repoRoot = resolve(import.meta.dirname, "../..");
export const generatorDir = join(repoRoot, "map-generator");

export interface MapEntry {
  name: string;
  isTest: boolean;
}

export function inputMapDir(isTest: boolean): string {
  return join(generatorDir, "assets", isTest ? "test_maps" : "maps");
}

export function outputMapDir(isTest: boolean): string {
  return isTest
    ? join(repoRoot, "tests", "testdata", "maps")
    : join(repoRoot, "resources", "maps");
}

/** Every folder in assets/maps, then assets/test_maps, sorted by name like os.ReadDir. */
export function discoverMaps(): MapEntry[] {
  const result: MapEntry[] = [];
  for (const isTest of [false, true]) {
    const dir = inputMapDir(isTest);
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    for (const name of names) result.push({ name, isTest });
  }
  return result;
}
