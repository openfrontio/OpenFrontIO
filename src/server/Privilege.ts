import { Cosmetics } from "../core/CosmeticSchemas";
import { PatternDecoder } from "../core/PatternDecoder";

type PatternResult =
  | { type: "allowed"; patternData: string }
  | { type: "unknown" }
  | { type: "forbidden"; reason: string };

export interface PrivilegeChecker {
  isPatternAllowed(
    base64: string,
    flares: readonly string[] | undefined,
  ): PatternResult;
  isCustomFlagAllowed(
    flag: string,
    flares: readonly string[] | undefined,
  ): true | "restricted" | "invalid";
}

export class PrivilegeCheckerImpl implements PrivilegeChecker {
  constructor(
    private cosmetics: Cosmetics,
    private b64urlDecode: (base64: string) => Uint8Array,
  ) {}

  isPatternAllowed(
    name: string,
    flares: readonly string[] | undefined,
  ): PatternResult {
    // Look for the pattern in the cosmetics.json config
    const found = this.cosmetics.patterns[name];
    if (!found) return { type: "forbidden", reason: "pattern not found" };

    try {
      new PatternDecoder(found.pattern, this.b64urlDecode);
    } catch (e) {
      return { type: "forbidden", reason: "invalid pattern" };
    }

    if (
      flares?.includes(`pattern:${found.name}`) ||
      flares?.includes("pattern:*")
    ) {
      // Player has a flare for this pattern
      return { type: "allowed", patternData: found.pattern };
    } else {
      return { type: "forbidden", reason: "no flares for pattern" };
    }
  }

  isCustomFlagAllowed(
    flag: string,
    flares: readonly string[] | undefined,
  ): true | "restricted" | "invalid" {
    if (!flag.startsWith("!")) return "invalid";
    const code = flag.slice(1);
    if (!code) return "invalid";
    const segments = code.split("_");
    if (segments.length === 0) return "invalid";

    const MAX_LAYERS = 6; // Maximum number of layers allowed
    if (segments.length > MAX_LAYERS) return "invalid";

    const superFlare = flares?.includes("flag:*") ?? false;

    for (const segment of segments) {
      const [layerKey, colorKey] = segment.split("-");
      if (!layerKey || !colorKey) return "invalid";
      const layer = this.cosmetics.flag?.layers[layerKey];
      const color = this.cosmetics.flag?.color[colorKey];
      if (!layer || !color) return "invalid";

      // Super-flare bypasses all restrictions
      if (superFlare) {
        continue;
      }

      // Check layer restrictions
      const layerSpec = layer;
      let layerAllowed = false;
      if (!layerSpec.flares) {
        layerAllowed = true;
      } else {
        // By flare
        if (
          layerSpec.flares &&
          flares?.some((f) => layerSpec.flares?.includes(f))
        ) {
          layerAllowed = true;
        }
        // By named flag:layer:{name}
        if (flares?.includes(`flag:layer:${layerSpec.name}`)) {
          layerAllowed = true;
        }
      }

      // Check color restrictions
      const colorSpec = color;
      let colorAllowed = false;
      if (!colorSpec.flares) {
        colorAllowed = true;
      } else {
        // By flare
        if (
          colorSpec.flares &&
          flares?.some((f) => colorSpec.flares?.includes(f))
        ) {
          colorAllowed = true;
        }
        // By named flag:color:{name}
        if (flares?.includes(`flag:color:${colorSpec.name}`)) {
          colorAllowed = true;
        }
      }

      // If either part is restricted, block
      if (!(layerAllowed && colorAllowed)) {
        return "restricted";
      }
    }
    return true;
  }
}

export class FailOpenPrivilegeChecker implements PrivilegeChecker {
  isPatternAllowed(
    name: string,
    flares: readonly string[] | undefined,
  ): PatternResult {
    return { type: "unknown" };
  }

  isCustomFlagAllowed(
    flag: string,
    flares: readonly string[] | undefined,
  ): true | "restricted" | "invalid" {
    return true;
  }
}
