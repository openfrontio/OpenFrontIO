import { describe, expect, it, vi } from "vitest";
import { GameConfig, GameConfigSchema } from "../../src/core/Schemas";
import { MapPlaylist } from "../../src/server/MapPlaylist";

vi.mock("../../src/server/MapLandTiles", () => ({
  getMapLandTiles: async () => 1_000_000,
}));

// Every 6th scheduled public game is trusted-only, counted across FFA, team
// and special in creation order: five open lobbies, then one locked. A
// rotation, not a roll, so the lobbies on offer are never all locked at once.
describe("MapPlaylist trusted-only public games", () => {
  it("marks every 6th game trusted-only across all types", async () => {
    const playlist = new MapPlaylist();
    const types = [
      "ffa",
      "team",
      "special",
      "ffa",
      "team",
      "special",
      "ffa",
      "team",
      "special",
      "ffa",
      "team",
      "special",
    ] as const;
    const trusted: boolean[] = [];
    for (const type of types) {
      const config = await playlist.gameConfig(type);
      expect(GameConfigSchema.safeParse(config).success).toBe(true);
      trusted.push(config.trusted === true);
    }
    expect(trusted).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it("counts per playlist instance, starting open", async () => {
    const a = new MapPlaylist();
    const b = new MapPlaylist();
    for (let i = 0; i < 5; i++) await a.gameConfig("ffa");
    expect((await a.gameConfig("ffa")).trusted).toBe(true);
    // b has its own counter: its first game is open.
    expect((await b.gameConfig("ffa")).trusted).toBeUndefined();
  });

  it("caps trusted games at 25 players so they fill", async () => {
    // 1M land tiles gives open-lobby tiers of 50/40/25 (75 in team mode), so
    // any uncapped roll would regularly exceed the trusted cap.
    const playlist = new MapPlaylist();
    const types = ["ffa", "team", "special"] as const;
    let trustedSeen = 0;
    for (let i = 0; i < 24; i++) {
      const config = await playlist.gameConfig(types[i % 3]);
      if (config.trusted) {
        trustedSeen++;
        expect(config.maxPlayers).toBeLessThanOrEqual(25);
      }
    }
    expect(trustedSeen).toBe(4);
  });

  it("never rolls the crowded modifier for trusted special games", async () => {
    // Crowded would set 60/125 players only for the trusted cap to undo it,
    // leaving a badge with no effect — so it must be excluded up front.
    const playlist = new MapPlaylist() as unknown as {
      getSpecialConfig(trusted: boolean): Promise<GameConfig>;
    };
    for (let i = 0; i < 50; i++) {
      const config = await playlist.getSpecialConfig(true);
      expect(config.publicGameModifiers?.isCrowded).toBeUndefined();
      expect(config.maxPlayers).toBeLessThanOrEqual(25);
    }
  });

  it("does not depend on Math.random", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.1);
    try {
      const playlist = new MapPlaylist();
      expect((await playlist.gameConfig("ffa")).trusted).toBeUndefined();
      randomSpy.mockReturnValue(0.9);
      for (let i = 0; i < 4; i++) await playlist.gameConfig("team");
      expect((await playlist.gameConfig("special")).trusted).toBe(true);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
