/**
 * Utilities for RenderSettings persistence — deep-assign, deep-diff.
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

/**
 * Compute a sparse deep-partial of values that differ from defaults.
 * Returns `undefined` if nothing differs.
 */
export function deepDiff(defaults: Obj, current: Obj): Obj | undefined {
  let result: Obj | undefined;
  for (const key of Object.keys(defaults)) {
    const dv = defaults[key];
    const cv = current[key];
    if (
      typeof dv === "object" &&
      dv !== null &&
      typeof cv === "object" &&
      cv !== null
    ) {
      const sub = deepDiff(dv as Obj, cv as Obj);
      if (sub !== undefined) {
        result ??= {};
        result[key] = sub;
      }
    } else if (dv !== cv) {
      result ??= {};
      result[key] = cv;
    }
  }
  return result;
}
