import { Cosmetics } from "../core/CosmeticSchemas";
import { PatternDecoder } from "../core/PatternDecoder";

export class PrivilegeChecker {
  constructor(
    private cosmetics: Cosmetics,
    private b64urlDecode: (base64: string) => Uint8Array,
  ) {}

  isPatternAllowed(
    base64: string,
    roles: readonly string[] | undefined,
    flares: readonly string[] | undefined,
  ): true | "restricted" | "unlisted" | "invalid" {
    // Look for the pattern in the cosmetics.json config
    const found = this.cosmetics.patterns[base64];
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

    const { role_group, name } = found;
    if (role_group === undefined) {
      // Pattern has no restrictions
      return true;
    }

    for (const groupName of role_group) {
      if (
        roles !== undefined &&
        roles.some((role) =>
          this.cosmetics.role_groups[groupName]?.includes(role),
        )
      ) {
        // Player is in a role group for this pattern
        return true;
      }
    }

    if (
      flares !== undefined &&
      (flares.includes(`pattern:${name}`) || flares.includes("pattern:*"))
    ) {
      // Player has a flare for this pattern
      return true;
    }

    return "restricted";
  }

  isCustomFlagAllowed(
    flag: string,
    roles: readonly string[] | undefined,
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
      const layer = this.cosmetics.flag.layers[layerKey];
      const color = this.cosmetics.flag.color[colorKey];
      if (!layer || !color) return "invalid";

      // Super-flare bypasses all restrictions
      if (superFlare) {
        continue;
      }

      // Check layer restrictions
      const layerSpec = layer;
      let layerAllowed = false;
      if (!layerSpec.role_group && !layerSpec.flares) {
        layerAllowed = true;
      } else {
        // By role
        if (layerSpec.role_group) {
          const allowedRoles =
            this.cosmetics.role_groups[layerSpec.role_group] || [];
          if (roles?.some((r) => allowedRoles.includes(r))) {
            layerAllowed = true;
          }
        }
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
      if (!colorSpec.role_group && !colorSpec.flares) {
        colorAllowed = true;
      } else {
        // By role
        if (colorSpec.role_group) {
          const allowedRoles =
            this.cosmetics.role_groups[colorSpec.role_group] || [];
          if (roles?.some((r) => allowedRoles.includes(r))) {
            colorAllowed = true;
          }
        }
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
