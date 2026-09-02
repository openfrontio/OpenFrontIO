import { describe, expect, it } from "vitest";
import {
  getTranslatedPlayerTeamLabel,
  resolveTeamClanTag,
} from "../../src/client/Utils";

describe("resolveTeamClanTag", () => {
  it("returns null for empty team", () => {
    expect(resolveTeamClanTag([])).toBeNull();
  });

  it("returns null when no players have clan tags", () => {
    expect(
      resolveTeamClanTag([
        { clanTag: null },
        { clanTag: undefined },
        { clanTag: "" },
        { clanTag: "   " },
      ]),
    ).toBeNull();
  });

  it("qualifies solo player with clan tag (100% > 50%)", () => {
    expect(resolveTeamClanTag([{ clanTag: "MARS" }])).toBe("MARS");
  });

  describe("Duos (2 players)", () => {
    it("returns null when 1 player has clan and 1 is un-clanned (50% is not > 50%)", () => {
      expect(
        resolveTeamClanTag([{ clanTag: "MARS" }, { clanTag: null }]),
      ).toBeNull();
    });

    it("returns clan tag when both players share clan (100% > 50%)", () => {
      expect(
        resolveTeamClanTag([{ clanTag: "MARS" }, { clanTag: "MARS" }]),
      ).toBe("MARS");
    });

    it("returns coalition when 2 players have different clans (100% >= 70%, 50% >= 30%)", () => {
      expect(
        resolveTeamClanTag([{ clanTag: "UN" }, { clanTag: "MARS" }]),
      ).toBe("MARS / UN");
    });
  });

  describe("Trios (3 players)", () => {
    it("returns majority clan when 2 out of 3 match (66.7% > 50%)", () => {
      expect(
        resolveTeamClanTag([
          { clanTag: "MARS" },
          { clanTag: "MARS" },
          { clanTag: "UN" },
        ]),
      ).toBe("MARS");
      expect(
        resolveTeamClanTag([
          { clanTag: "MARS" },
          { clanTag: "MARS" },
          { clanTag: null },
        ]),
      ).toBe("MARS");
    });

    it("returns null when 1 MARS, 1 UN, 1 un-clanned (66.7% < 70% coalition threshold)", () => {
      expect(
        resolveTeamClanTag([
          { clanTag: "MARS" },
          { clanTag: "UN" },
          { clanTag: null },
        ]),
      ).toBeNull();
    });

    it("returns null for 3-way split with 1 player each", () => {
      expect(
        resolveTeamClanTag([
          { clanTag: "A" },
          { clanTag: "B" },
          { clanTag: "C" },
        ]),
      ).toBeNull();
    });
  });

  describe("Quads (4 players)", () => {
    it("returns null when 2 have clan and 2 are un-clanned (50% is not > 50%)", () => {
      expect(
        resolveTeamClanTag([
          { clanTag: "MARS" },
          { clanTag: "MARS" },
          { clanTag: null },
          { clanTag: null },
        ]),
      ).toBeNull();
    });

    it("returns majority clan when 3 out of 4 match (75% > 50%)", () => {
      expect(
        resolveTeamClanTag([
          { clanTag: "MARS" },
          { clanTag: "MARS" },
          { clanTag: "MARS" },
          { clanTag: "UN" },
        ]),
      ).toBe("MARS");
    });

    it("returns coalition when split 2 vs 2 between two clans (100% >= 70%, 50% >= 30%)", () => {
      expect(
        resolveTeamClanTag([
          { clanTag: "MARS" },
          { clanTag: "MARS" },
          { clanTag: "UN" },
          { clanTag: "UN" },
        ]),
      ).toBe("MARS / UN");
    });

    it("returns null when 2 MARS, 1 UN, 1 un-clanned (UN is 25% < 30% individual floor)", () => {
      expect(
        resolveTeamClanTag([
          { clanTag: "MARS" },
          { clanTag: "MARS" },
          { clanTag: "UN" },
          { clanTag: null },
        ]),
      ).toBeNull();
    });
  });

  describe("Model C Proportional Coalition (5+ players)", () => {
    it("recognizes near-tie 3 vs 2 in 6-player team (83.3% >= 70%, 33.3% >= 30%)", () => {
      expect(
        resolveTeamClanTag([
          { clanTag: "MARS" },
          { clanTag: "MARS" },
          { clanTag: "MARS" },
          { clanTag: "UN" },
          { clanTag: "UN" },
          { clanTag: null },
        ]),
      ).toBe("MARS / UN");
    });

    it("recognizes 2 vs 2 in 5-player team (80% >= 70%, 40% >= 30%)", () => {
      expect(
        resolveTeamClanTag([
          { clanTag: "MARS" },
          { clanTag: "MARS" },
          { clanTag: "UN" },
          { clanTag: "UN" },
          { clanTag: null },
        ]),
      ).toBe("MARS / UN");
    });

    it("returns null in 10-player team when coalition only has 60% (60% < 70%)", () => {
      expect(
        resolveTeamClanTag([
          { clanTag: "MARS" },
          { clanTag: "MARS" },
          { clanTag: "MARS" },
          { clanTag: "UN" },
          { clanTag: "UN" },
          { clanTag: "UN" },
          { clanTag: null },
          { clanTag: null },
          { clanTag: null },
          { clanTag: null },
        ]),
      ).toBeNull();
    });

    it("recognizes coalition in 10-player team when 4 MARS + 3 UN (70% >= 70%, 30% >= 30%)", () => {
      expect(
        resolveTeamClanTag([
          { clanTag: "MARS" },
          { clanTag: "MARS" },
          { clanTag: "MARS" },
          { clanTag: "MARS" },
          { clanTag: "UN" },
          { clanTag: "UN" },
          { clanTag: "UN" },
          { clanTag: null },
          { clanTag: null },
          { clanTag: null },
        ]),
      ).toBe("MARS / UN");
    });
  });

  it("supports getter functions for clanTag (PlayerView-like interface)", () => {
    expect(
      resolveTeamClanTag([
        { clanTag: () => "MARS" },
        { clanTag: () => "MARS" },
      ]),
    ).toBe("MARS");
  });
});

describe("getTranslatedPlayerTeamLabel", () => {
  it("returns base team label when clan tag is omitted or null", () => {
    expect(getTranslatedPlayerTeamLabel("Red")).toBe("Red");
    expect(getTranslatedPlayerTeamLabel("Red", null)).toBe("Red");
    expect(getTranslatedPlayerTeamLabel("Team 1")).toBe("Team 1");
    expect(getTranslatedPlayerTeamLabel("Team 1", null)).toBe("Team 1");
    expect(getTranslatedPlayerTeamLabel(null)).toBe("");
  });

  it("formats clan team label when clan tag is present", () => {
    expect(getTranslatedPlayerTeamLabel("Red", "MARS")).toBe(
      "Clan [MARS] (Red)",
    );
    expect(getTranslatedPlayerTeamLabel("Team 1", "MARS / UN")).toBe(
      "Clan [MARS / UN] (Team 1)",
    );
  });
});
