import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameConfigSchema } from "../../src/core/Schemas";
import { MapPlaylist } from "../../src/server/MapPlaylist";

vi.mock("../../src/server/MapLandTiles", () => ({
  getMapLandTiles: async () => 1_000_000,
}));

// A third of scheduled public games are trusted-only, whatever their type.
// The roll is the LAST Math.random() call gameConfig makes, so a spy that
// answers every earlier roll (map, modifiers) with the same value still
// decides trust by that value.
describe("MapPlaylist trusted-only public games", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    randomSpy = vi.spyOn(Math, "random");
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  for (const type of ["ffa", "team", "special"] as const) {
    it(`marks a ${type} lobby trusted-only on a low roll`, async () => {
      randomSpy.mockReturnValue(0.1);
      const config = await new MapPlaylist().gameConfig(type);
      expect(config.trusted).toBe(true);
      expect(GameConfigSchema.safeParse(config).success).toBe(true);
    });

    it(`leaves a ${type} lobby open on a high roll`, async () => {
      randomSpy.mockReturnValue(0.9);
      const config = await new MapPlaylist().gameConfig(type);
      expect(config.trusted).toBeUndefined();
    });
  }

  it("rolls trust at the one-third threshold", async () => {
    randomSpy.mockReturnValue(1 / 3 - 0.001);
    expect((await new MapPlaylist().gameConfig("ffa")).trusted).toBe(true);
    randomSpy.mockReturnValue(1 / 3 + 0.001);
    expect((await new MapPlaylist().gameConfig("ffa")).trusted).toBeUndefined();
  });
});
