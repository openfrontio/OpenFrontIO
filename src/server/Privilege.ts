import { Cosmetics } from "../core/CosmeticSchemas";

export class PrivilegeChecker {
  constructor(
    private cosmetics: Cosmetics,
    private PatternDecoder?: new (base64: string) => object,
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
        if (this.PatternDecoder) {
          new this.PatternDecoder(base64);
        }
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
          this.cosmetics.role_groups[groupName].includes(role),
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
    const superFlare = flares?.includes("flag:*") ?? false;
    for (const segment of segments) {
      const [layerKey, colorKey] = segment.split("-");
      if (!layerKey || !colorKey) return "invalid";
      const layer = this.cosmetics.flag.layers[layerKey];
      const color = this.cosmetics.flag.color[colorKey];
      if (!layer || !color) return "invalid";

      const layerFlareOk =
        layer.flares && flares && layer.flares.some((f) => flares.includes(f));
      const colorFlareOk =
        color.flares && flares && color.flares.some((f) => flares.includes(f));
      const layerSuperFlareOk =
        superFlare || (flares && flares.includes(`flag:layer:${layer.name}`));
      const colorSuperFlareOk =
        superFlare || (flares && flares.includes(`flag:color:${color.name}`));

      if (
        (layerFlareOk || layerSuperFlareOk || !layer.role_group) &&
        (colorFlareOk || colorSuperFlareOk || !color.role_group)
      ) {
        continue;
      }

      if (layer.role_group) {
        const group = this.cosmetics.role_groups[layer.role_group];
        if (!group) return "invalid";
        if (!roles || !roles.some((role) => group.includes(role))) {
          return "restricted";
        }
      }

      if (color.role_group) {
        const group = this.cosmetics.role_groups[color.role_group];
        if (!group) return "invalid";
        if (!roles || !roles.some((role) => group.includes(role))) {
          return "restricted";
        }
      }
    }
    return true;
  }
}
