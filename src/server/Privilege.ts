import { PatternDecoder, territoryPatterns } from "../core/Cosmetics";
import { Cosmetic } from "../core/CosmeticSchemas";

const patternData = territoryPatterns;

export class PrivilegeChecker {
  private patternData: Cosmetic;

  constructor(patternData: Cosmetic) {
    this.patternData = patternData;
  }

  isPatternAllowed(
    base64: string,
    roles: string[],
    flares: string[],
  ): true | "restricted" | "unlisted" | "invalid" {
    const found = Object.entries(this.patternData.pattern).find(
      ([, entry]) => entry.pattern === base64,
    );

    if (!found) {
      if (!PatternDecoder.isValid(base64)) {
        return "invalid";
      }
      if (!flares.includes("pattern:*")) {
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
      if (roles.some((role) => groupRoles.includes(role))) {
        return true;
      }
    }

    return flares.includes(`pattern:${key}`) ? true : "restricted";
  }
}

let cachedChecker: PrivilegeChecker | null = null;

export function getPrivilegeChecker(): PrivilegeChecker {
  if (cachedChecker === null) {
    cachedChecker = new PrivilegeChecker(patternData);
  }
  return cachedChecker;
}
