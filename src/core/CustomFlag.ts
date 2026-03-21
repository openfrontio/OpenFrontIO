import { Cosmetics } from "./CosmeticSchemas";

// Legacy custom flag rendering — the old `!` prefix flag system has been
// replaced by the `flag:` prefix with URL-based flags in CosmeticsSchema.
// This function is kept as a no-op stub for any remaining call sites.
export function renderPlayerFlag(
  flag: string,
  target: HTMLElement,
  cosmetics: Cosmetics | undefined = undefined,
) {
  // Old custom flags are no longer supported
}
