import { describe, expect, test } from "vitest";
import { previewPackageVersion } from "../scripts/cosmeticPreviewVersion";

// semver.org's regex for a valid version.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

describe("previewPackageVersion", () => {
  test.each([
    ["0123456789abcdef0123456789abcdef01234567", false],
    ["0123456789abcdef0123456789abcdef01234567", true],
    ["a2e51ee021f00000000000000000000000000000", false],
    ["1234567890ffffffffffffffffffffffffffffff", false],
  ])("%s (dirty: %s) is valid semver", (commit, dirty) => {
    expect(previewPackageVersion("0.1.0", commit, dirty)).toMatch(SEMVER);
  });

  test("carries the commit's first ten characters after a g", () => {
    const commit = "0123456789abcdef0123456789abcdef01234567";
    expect(previewPackageVersion("0.1.0", commit, false)).toBe(
      "0.1.0-g0123456789",
    );
    expect(previewPackageVersion("0.1.0", commit, true)).toBe(
      "0.1.0-g0123456789.dirty",
    );
  });
});
