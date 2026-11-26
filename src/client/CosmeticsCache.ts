// The last cosmetics catalogue fetchCosmetics() resolved, apart from
// Cosmetics.ts so the renderer (WebGLFrameBuilder) can read it without
// importing the store, auth and payment code that file needs. The cosmetic
// preview package ships the renderer to other sites.

import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";

let cached: Cosmetics | null = null;

/**
 * Synchronous accessor for the most recently resolved cosmetics. Returns null
 * before the first successful `fetchCosmetics()` call. Useful when a code path
 * cannot await (e.g. WebGL per-frame sync).
 */
export function getCachedCosmetics(): Cosmetics | null {
  return cached;
}

/** Set by fetchCosmetics() when a catalogue arrives. */
export function setCachedCosmetics(cosmetics: Cosmetics | null): void {
  cached = cosmetics;
}
