import type { Cosmetics } from "../../src/core/CosmeticSchemas";
import { PrivilegeCheckerImpl } from "../../src/server/Privilege";

describe("PrivilegeChecker.isCustomFlagAllowed (with mock cosmetics)", () => {
  const dummyPatternDecoder = (_base64: string) => {
    throw new Error("Method not implemented");
  };

  const mockCosmetics: Cosmetics = {
    flag: {
      color: {
        a: { color: "#ff0000", flares: ["cosmetic:red"], name: "red" },
        b: { color: "#00ff00", name: "green" },
        c: { color: "#0000ff", flares: ["cosmetic:blue"], name: "blue" },
      },
      layers: {
        a: {
          flares: ["cosmetic:flags"],
          name: "chocolate",
        },
        b: { name: "center_hline" },
        c: { name: "admin_layer" },
      },
    },
    patterns: {},
  };

  const checker = new PrivilegeCheckerImpl(mockCosmetics, dummyPatternDecoder);

  it("allowed: unrestricted layer/color", () => {
    expect(checker.isCustomFlagAllowed("!b-b", [])).toBe(true);
  });

  it("allowed: donor layer with correct flare", () => {
    expect(checker.isCustomFlagAllowed("!a-b", ["cosmetic:flags"])).toBe(true);
  });

  it("allowed: color with correct flare", () => {
    expect(checker.isCustomFlagAllowed("!b-c", ["cosmetic:blue"])).toBe(true);
  });

  it("invalid: non-existent layer", () => {
    expect(checker.isCustomFlagAllowed("!zzz-a", [])).toBe("invalid");
  });

  it("invalid: non-existent color", () => {
    expect(checker.isCustomFlagAllowed("!a-zzz", [])).toBe("invalid");
  });

  it("allowed: superFlare allows all listed", () => {
    expect(checker.isCustomFlagAllowed("!a-a", ["flag:*"])).toBe(true);
    expect(checker.isCustomFlagAllowed("!b-b", ["flag:*"])).toBe(true);
    expect(checker.isCustomFlagAllowed("!c-a", ["flag:*"])).toBe(true);
    expect(checker.isCustomFlagAllowed("!a-c", ["flag:*"])).toBe(true);
  });

  it("invalid: superFlare does not allow non-existent", () => {
    expect(checker.isCustomFlagAllowed("!zzz-zzz", ["flag:*"])).toBe("invalid");
  });
  it("allowed: flare flag:layer:chocolate allows chocolate layer", () => {
    expect(checker.isCustomFlagAllowed("!a-b", ["flag:layer:chocolate"])).toBe(
      true,
    );
  });
  it("allowed: flare flag:color:blue allows blue color", () => {
    expect(checker.isCustomFlagAllowed("!b-c", ["flag:color:blue"])).toBe(true);
  });
  it("restricted: only color flare, layer still restricted", () => {
    expect(checker.isCustomFlagAllowed("!a-c", ["cosmetic:blue"])).toBe(
      "restricted",
    );
  });
  it("restricted: only layer flare, color still restricted", () => {
    expect(checker.isCustomFlagAllowed("!c-a", ["cosmetic:flags"])).toBe(
      "restricted",
    );
  });

  it("allowed: two segments, both unrestricted", () => {
    expect(checker.isCustomFlagAllowed("!b-b_b-b", [])).toBe(true);
  });
  it("allowed: two segments, both by flare", () => {
    expect(
      checker.isCustomFlagAllowed("!a-c_a-c", [
        "cosmetic:flags",
        "cosmetic:blue",
      ]),
    ).toBe(true);
    expect(checker.isCustomFlagAllowed("!a-c_a-c", ["cosmetic:flags"])).toBe(
      "restricted",
    );
    expect(checker.isCustomFlagAllowed("!a-c_a-c", ["cosmetic:blue"])).toBe(
      "restricted",
    );
  });
});
