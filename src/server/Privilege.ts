import { territoryPatterns } from "../core/Cosmetics";
import { Cosmetic } from "../core/CosmeticSchemas";

const patternData = territoryPatterns;

export class PrivilegeChecker {
  private patternData: Cosmetic;

  constructor(patternData: Cosmetic) {
    this.patternData = patternData;
  }

  isPatternAllowed(
    base64: string,
    roleIDs: string[],
  ): true | "restricted" | "unlisted" {
    const found = Object.entries(this.patternData.pattern).find(
      ([, entry]) => entry.pattern === base64,
    );

    if (!found) {
      // fallback to staff privilege check
      const staffRoles = this.patternData.role_group?.["staff"] || [];
      return roleIDs.some((role) => staffRoles.includes(role))
        ? true
        : "unlisted";
    }

    const [, entry] = found;
    const allowedGroups = entry.role_group ?? [];

    if (allowedGroups.length === 0) {
      return true;
    }

    for (const groupName of allowedGroups) {
      const groupRoles = this.patternData.role_group?.[groupName] || [];
      if (roleIDs.some((role) => groupRoles.includes(role))) {
        return true;
      }
    }

    return "restricted";
  }
}

let cachedChecker: PrivilegeChecker | null = null;

export function getPrivilegeChecker(): PrivilegeChecker {
  if (cachedChecker === null) {
    cachedChecker = new PrivilegeChecker(patternData);
  }
  return cachedChecker;
}
