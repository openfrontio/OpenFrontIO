import { Cosmetics, Pattern } from "../core/CosmeticSchemas";
import { PatternDecoder } from "../core/PatternDecoder";

export type PrivilegeChecker = {
  isPatternAllowed(
    base64: string,
    flares: readonly string[] | undefined,
  ): true | "restricted" | "unlisted" | "invalid";
  isCustomFlagAllowed(
    flag: string,
    flares: readonly string[] | undefined,
  ): true | "restricted" | "invalid";
};

export class PrivilegeCheckerImpl implements PrivilegeChecker {
  private readonly b64ToPattern: Record<string, Pattern> = {};

  constructor(
    private readonly cosmetics: Cosmetics,
    private readonly b64urlDecode: (base64: string) => Uint8Array,
  ) {
    for (const name in this.cosmetics.patterns) {
      const pattern = this.cosmetics.patterns[name];
      this.b64ToPattern[pattern.pattern] = pattern;
    }
  }

  isPatternAllowed(
    base64: string,
    flares: readonly string[] | undefined,
  ): true | "restricted" | "unlisted" | "invalid" {
    // Look for the pattern in the cosmetics.json config
    const found = this.b64ToPattern[base64];
    if (found === undefined) {
      try {
        // Ensure that the pattern will not throw for clients
        new PatternDecoder(base64, this.b64urlDecode);
      } catch (e) {
        // Pattern is invalid
        return "invalid";
      }
      // Pattern is unlisted
      if (flares !== undefined && flares.includes("pattern:*")) {
        // Player has the super-flare
        return true;
      }
      return "unlisted";
    }

    if (
      flares !== undefined &&
      (flares.includes(`pattern:${found.name}`) || flares.includes("pattern:*"))
    ) {
      // Player has a flare for this pattern
      return true;
    }

    return "restricted";
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
  ): true | "restricted" | "unlisted" | "invalid" {
    return true;
  }

  isCustomFlagAllowed(
    flag: string,
    flares: readonly string[] | undefined,
  ): true | "restricted" | "invalid" {
    return true;
  }
}
