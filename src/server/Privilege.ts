import { PatternDecoder } from "../core/Cosmetics";
import { Cosmetic } from "../core/CosmeticSchemas";
type PatternEntry = {
  pattern: string;
  role_group?: string[];
};
export class PrivilegeChecker {
  private patternData: Cosmetic;

  constructor(patternData: Cosmetic) {
    this.patternData = patternData;
  }

  isPatternAllowed(
    base64: string,
    roles: readonly string[] | undefined,
    flares: readonly string[] | undefined,
  ): true | "restricted" | "unlisted" | "invalid" {
    const roleList = roles ?? [];
    const flareList = flares ?? [];

    let found: [string, PatternEntry] | undefined;
    for (const key in this.patternData.pattern) {
      const entry = this.patternData.pattern[key];
      if (entry.pattern === base64) {
        found = [key, entry];
        break;
      }
    }

    if (!found) {
      try {
        new PatternDecoder(base64);
      } catch (e) {
        return "invalid";
      }
      if (!flareList.includes("pattern:*")) {
        return "unlisted";
      }
      return true;
    }

    const [key, entry] = found;
    const allowedGroups = entry.role_group ?? [];

    if (allowedGroups.length === 0) {
      return true;
    }

    for (const groupName of allowedGroups) {
      const groupRoles = this.patternData.role_group?.[groupName] || [];
      if (roleList.some((role) => groupRoles.includes(role))) {
        return true;
      }
    }

    if (!flareList.includes(`pattern:${key}`)) {
      return "restricted";
    }
    return true;
  }
}
