import { Cosmetics } from "../core/CosmeticSchemas";
import { PatternDecoder } from "../core/PatternDecoder";

export class PrivilegeChecker {
  constructor(private cosmetics: Cosmetics) {}

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
        new PatternDecoder(base64);
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
}
