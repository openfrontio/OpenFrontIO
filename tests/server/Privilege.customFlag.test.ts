import type { Cosmetics } from "../../src/core/CosmeticSchemas";
import { PrivilegeChecker } from "../../src/server/Privilege";

describe("PrivilegeChecker.isCustomFlagAllowed (with mock cosmetics)", () => {
  const dummyPatternDecoder = (_base64: string) => {
    throw new Error("Method not implemented");
  };

  const mockCosmetics: Cosmetics = {
    role_groups: {
      donor: ["role_donor"],
      admin: ["role_admin"],
    },
    patterns: {},
    flag: {
      layers: {
        a: {
          name: "chocolate",
          role_group: "donor",
          flares: ["cosmetic:flags"],
        },
        b: { name: "center_hline" },
        c: { name: "admin_layer", role_group: "admin" },
      },
      color: {
        a: { color: "#ff0000", name: "red", role_group: "admin" },
        b: { color: "#00ff00", name: "green" },
        c: { color: "#0000ff", name: "blue", flares: ["cosmetic:blue"] },
      },
    },
  };

  const checker = new PrivilegeChecker(mockCosmetics, dummyPatternDecoder);

  it("allowed: unrestricted layer/color", () => {
    expect(checker.isCustomFlagAllowed("!b-b", [], [])).toBe(true);
  });

  it("restricted: donor layer without role", () => {
    expect(checker.isCustomFlagAllowed("!a-b", [], [])).toBe("restricted");
  });

  it("allowed: donor layer with donor role", () => {
    expect(checker.isCustomFlagAllowed("!a-b", ["role_donor"], [])).toBe(true);
  });

  it("allowed: donor layer with correct flare", () => {
    expect(checker.isCustomFlagAllowed("!a-b", [], ["cosmetic:flags"])).toBe(
      true,
    );
  });

  it("restricted: admin color without role", () => {
    expect(checker.isCustomFlagAllowed("!b-a", [], [])).toBe("restricted");
  });

  it("allowed: admin color with admin role", () => {
    expect(checker.isCustomFlagAllowed("!b-a", ["role_admin"], [])).toBe(true);
  });

  it("allowed: color with correct flare", () => {
    expect(checker.isCustomFlagAllowed("!b-c", [], ["cosmetic:blue"])).toBe(
      true,
    );
  });

  it("invalid: non-existent layer", () => {
    expect(checker.isCustomFlagAllowed("!zzz-a", ["role_donor"], [])).toBe(
      "invalid",
    );
  });

  it("invalid: non-existent color", () => {
    expect(checker.isCustomFlagAllowed("!a-zzz", ["role_donor"], [])).toBe(
      "invalid",
    );
  });

  it("allowed: superFlare allows all listed", () => {
    expect(checker.isCustomFlagAllowed("!a-a", [], ["flag:*"])).toBe(true);
    expect(checker.isCustomFlagAllowed("!b-b", [], ["flag:*"])).toBe(true);
    expect(checker.isCustomFlagAllowed("!c-a", [], ["flag:*"])).toBe(true);
    expect(checker.isCustomFlagAllowed("!a-c", [], ["flag:*"])).toBe(true);
  });

  it("invalid: superFlare does not allow non-existent", () => {
    expect(checker.isCustomFlagAllowed("!zzz-zzz", [], ["flag:*"])).toBe(
      "invalid",
    );
  });
  it("allowed: flare flag:layer:chocolate allows chocolate layer", () => {
    expect(
      checker.isCustomFlagAllowed("!a-b", [], ["flag:layer:chocolate"]),
    ).toBe(true);
  });
  it("allowed: flare flag:color:blue allows blue color", () => {
    expect(checker.isCustomFlagAllowed("!b-c", [], ["flag:color:blue"])).toBe(
      true,
    );
  });
  it("restricted: only color flare, layer still restricted", () => {
    expect(checker.isCustomFlagAllowed("!a-c", [], ["cosmetic:blue"])).toBe(
      "restricted",
    );
  });
  it("restricted: only layer flare, color still restricted", () => {
    expect(checker.isCustomFlagAllowed("!c-a", [], ["cosmetic:flags"])).toBe(
      "restricted",
    );
  });
  it("allowed: layer by role, color by flare", () => {
    // layer a: role_group donor, color c: flares ["cosmetic:blue"]
    expect(
      checker.isCustomFlagAllowed("!a-c", ["role_donor"], ["cosmetic:blue"]),
    ).toBe(true);
  });
  it("restricted: layer by role, color by flare (missing flare)", () => {
    expect(checker.isCustomFlagAllowed("!a-c", ["role_donor"], [])).toBe(
      "restricted",
    );
  });
  it("restricted: layer by role, color by flare (missing role)", () => {
    expect(checker.isCustomFlagAllowed("!a-c", [], ["cosmetic:blue"])).toBe(
      "restricted",
    );
  });
  it("allowed: layer by flare, color by role", () => {
    // layer a: flares ["cosmetic:flags"], color a: role_group admin
    expect(
      checker.isCustomFlagAllowed("!a-a", ["role_admin"], ["cosmetic:flags"]),
    ).toBe(true);
  });
  it("restricted: layer by flare, color by role (missing flare)", () => {
    expect(checker.isCustomFlagAllowed("!a-a", ["role_admin"], [])).toBe(
      "restricted",
    );
  });
  it("restricted: layer by flare, color by role (missing role)", () => {
    expect(checker.isCustomFlagAllowed("!a-a", [], ["cosmetic:flags"])).toBe(
      "restricted",
    );
  });
  it("allowed: two segments, both unrestricted", () => {
    expect(checker.isCustomFlagAllowed("!b-b_b-b", [], [])).toBe(true);
  });
  it("restricted: two segments, one restricted by layer role", () => {
    expect(checker.isCustomFlagAllowed("!a-b_b-b", [], [])).toBe("restricted");
    expect(checker.isCustomFlagAllowed("!a-b_b-b", ["role_donor"], [])).toBe(
      true,
    );
  });
  it("restricted: two segments, one restricted by color role", () => {
    expect(checker.isCustomFlagAllowed("!b-a_b-b", [], [])).toBe("restricted");
    expect(checker.isCustomFlagAllowed("!b-a_b-b", ["role_admin"], [])).toBe(
      true,
    );
  });
  it("allowed: two segments, one by role, one by flare", () => {
    expect(
      checker.isCustomFlagAllowed(
        "!a-c_b-b",
        ["role_donor"],
        ["cosmetic:blue"],
      ),
    ).toBe(true);
    expect(checker.isCustomFlagAllowed("!a-c_b-b", ["role_donor"], [])).toBe(
      "restricted",
    );
    expect(checker.isCustomFlagAllowed("!a-c_b-b", [], ["cosmetic:blue"])).toBe(
      "restricted",
    );
  });
  it("allowed: two segments, both by flare", () => {
    expect(
      checker.isCustomFlagAllowed(
        "!a-c_a-c",
        [],
        ["cosmetic:flags", "cosmetic:blue"],
      ),
    ).toBe(true);
    expect(
      checker.isCustomFlagAllowed("!a-c_a-c", [], ["cosmetic:flags"]),
    ).toBe("restricted");
    expect(checker.isCustomFlagAllowed("!a-c_a-c", [], ["cosmetic:blue"])).toBe(
      "restricted",
    );
  });
});
