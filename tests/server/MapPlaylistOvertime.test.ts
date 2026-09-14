import { describe, expect, it, vi } from "vitest";
import { GameMode } from "../../src/core/game/Game";
import { GameConfigSchema } from "../../src/core/Schemas";
import { MapPlaylist } from "../../src/server/MapPlaylist";

vi.mock("../../src/server/MapLandTiles", () => ({
  getMapLandTiles: async () => 1_000_000,
}));

// Overtime is the default for every public FFA game (no lobby modifier), and
// never appears in team or special lobbies.
describe("MapPlaylist overtime", () => {
  it("always enables overtime in FFA lobbies", async () => {
    const config = await new MapPlaylist().gameConfig("ffa");
    expect(config.gameMode).toBe(GameMode.FFA);
    expect(config.overtime).toEqual({ enabled: true });
    expect(config.publicGameModifiers).toEqual({ isCompact: undefined });
    expect(GameConfigSchema.safeParse(config).success).toBe(true);
  });

  it("never enables overtime in team lobbies", async () => {
    const config = await new MapPlaylist().gameConfig("team");
    expect(config.gameMode).toBe(GameMode.Team);
    expect(config.overtime).toBeUndefined();
  });

  it("never enables overtime in special lobbies", async () => {
    const config = await new MapPlaylist().gameConfig("special");
    expect(config.overtime).toBeUndefined();
  });
});
