/**
 * The package version for a build: the base version, then the commit it was
 * built from as a prerelease, with ".dirty" for uncommitted changes.
 *
 * The commit gets a "g" in front, as `git describe` does: a prerelease
 * identifier that is all digits is a number, and semver forbids a leading 0
 * there, so a commit like 0123456789… would make an invalid version.
 */
export function previewPackageVersion(
  base: string,
  commit: string,
  dirty: boolean,
): string {
  return `${base}-g${commit.slice(0, 10)}${dirty ? ".dirty" : ""}`;
}
