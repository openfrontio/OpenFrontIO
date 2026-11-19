import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/client/Utils", () => ({ translateText: (k: string) => k }));
import {
  ffaTierLabelOf,
  ffaTierRank,
  formatExpectedPct,
  formatRating,
  formatRatingChange,
  formatRatingWithUncertainty,
  parseFfaTier,
} from "../../src/client/components/ffaRating/FfaTier";
import { ALL_FFA_TIERS as ALL_TIERS } from "../util/FfaTiers";

describe("FfaTier", () => {
  it("parses all 22 tiers", () => {
    expect(ALL_TIERS).toHaveLength(22);
    expect(parseFfaTier("Diamond II")).toEqual({
      base: "diamond",
      division: "II",
    });
    expect(parseFfaTier("Grandmaster")).toEqual({
      base: "grandmaster",
      division: null,
    });
    for (const t of ALL_TIERS) expect(parseFfaTier(t)).not.toBeNull();
  });

  it.each([
    "",
    "Diamond",
    "Diamond IV",
    "Grandmaster I",
    "Mythril II",
    "diamond ii",
  ])("rejects %j", (t) => {
    expect(parseFfaTier(t)).toBeNull();
  });

  it("orders tiers from Iron III to Grandmaster", () => {
    expect(ALL_TIERS.map(ffaTierRank)).toEqual([...Array(22).keys()]);
    expect(ffaTierRank("Mythril II")).toBeNull();
  });

  it("labels with the translated base and the roman division", () => {
    expect(ffaTierLabelOf("Diamond II")).toBe("ffa_rating.tier.diamond II");
    expect(ffaTierLabelOf("Grandmaster")).toBe("ffa_rating.tier.grandmaster");
    expect(ffaTierLabelOf("Mythril II")).toBe("Mythril II");
  });

  it("rounds and signs numbers", () => {
    expect(formatRating(1612.6)).toBe("1613");
    expect(formatRatingWithUncertainty(1612.6, 84.7)).toBe("1613 ± 85");
    expect(formatRatingChange(12.4)).toBe("+12");
    expect(formatRatingChange(-3.6)).toBe("-4");
    expect(formatRatingChange(-0.4)).toBe("0");
    expect(formatExpectedPct(0.0623)).toBe("6.2");
  });
});
