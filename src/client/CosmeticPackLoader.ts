import test from "../../resources/cosmetics/cosmetic_pack/test/manifest.json";
import {
  CosmeticManifest,
  CosmeticManifestSchema,
} from "../core/CosmeticSchemas";

function parseCosmeticManifest(json: unknown): CosmeticManifest {
  const res = CosmeticManifestSchema.safeParse(json);
  if (!res.success) {
    throw new Error(`Invalid CosmeticManifest: ${res.error.message}`);
  }
  return res.data;
}

function fetchManifest(packId: string): CosmeticManifest | undefined {
  switch (packId) {
    case "base":
      return;
    case "test":
      return parseCosmeticManifest(test) as CosmeticManifest;
  }
  return;
}

export async function resolveCosmeticUrl(
  packId: string | null,
  key: string | undefined,
  fallback: string,
): Promise<string> {
  if (!packId || key === undefined) {
    return fallback;
  }
  try {
    const manifest = fetchManifest(packId);
    if (!manifest) {
      return fallback;
    }
    // Determine category and subKey from the first "/" only.
    const firstSlash = key.indexOf("/");
    if (firstSlash === -1) {
      return fallback;
    }
    const category = key.slice(0, firstSlash);
    const subKey = key.slice(firstSlash + 1);

    const table = (manifest.assets as Record<string, any>)[category];
    if (table) {
      const parts = subKey.split("/");
      let current: any = table;
      for (const part of parts) {
        if (current === null) break;
        current = current[part];
      }
      if (typeof current === "string") {
        return `/cosmetics/cosmetic_pack/${packId}/${current}`;
      }
    }
  } catch (e) {
    console.warn("[cosmetics] manifest load failed", e);
  }
  return fallback;
}
