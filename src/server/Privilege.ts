import { PatternDecoder } from "../core/Cosmetics";
import { Cosmetics } from "../core/CosmeticSchemas";
type PatternEntry = {
  pattern: string;
  role_group?: string[];
};
export class PrivilegeChecker {
  constructor(private cosmetics: Cosmetics) {}

  isPatternAllowed(
    base64: string,
    roles: readonly string[] | undefined,
    flares: readonly string[] | undefined,
  ): true | "restricted" | "unlisted" | "invalid" {
    // Look for the pattern in the cosmetics.json config
    let found: [string, PatternEntry] | undefined;
    for (const key in this.cosmetics.pattern) {
      const entry = this.cosmetics.pattern[key];
      if (entry.pattern === base64) {
        found = [key, entry];
        break;
      }
    }

    if (!found) {
      try {
        // Ensure that the pattern will not throw for clients
        new PatternDecoder(base64);
      } catch (e) {
        // Pattern is invalid
        return "invalid";
      }
      // Pattern is unlisted
      if (flares !== undefined && flares.includes("pattern:*")) {
        return true;
      }
      return "unlisted";
    }

    const [key, entry] = found;
    const allowedGroups = entry.role_group;

    if (allowedGroups === undefined) {
      return true;
    }

    for (const groupName of allowedGroups) {
      const groupRoles = this.cosmetics.role_group?.[groupName] || [];
      if (
        roles !== undefined &&
        roles.some((role) => groupRoles.includes(role))
      ) {
        return true;
      }
    }

    if (
      flares !== undefined &&
      (flares.includes(`pattern:${key}`) || flares.includes("pattern:*"))
    )
      return true;

    return "restricted";
  }
}
