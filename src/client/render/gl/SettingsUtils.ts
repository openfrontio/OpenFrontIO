/**
 * Utilities for RenderSettings persistence — deep-assign.
 */

type Obj = Record<string, any>;

/**
 * Recursively assign source values onto target, preserving target's structure.
 * Arrays are replaced wholesale (theme palettes differ in length between
 * themes, so per-index merging would leave stale entries behind).
 */
export function deepAssign(target: Obj, source: Obj): void {
  for (const key of Object.keys(source)) {
    if (Array.isArray(source[key])) {
      if (key in target) {
        target[key] = structuredClone(source[key]);
      }
    } else if (
      typeof source[key] === "object" &&
      source[key] !== null &&
      typeof target[key] === "object" &&
      target[key] !== null
    ) {
      deepAssign(target[key] as Obj, source[key] as Obj);
    } else if (key in target) {
      target[key] = source[key];
    }
  }
}
