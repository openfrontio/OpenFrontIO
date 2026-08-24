import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameMode } from "../../src/core/game/Game";
import { GameConfigSchema } from "../../src/core/Schemas";
import { MapPlaylist } from "../../src/server/MapPlaylist";

vi.mock("../../src/server/MapLandTiles", () => ({
  getMapLandTiles: async () => 1_000_000,
}));

// Overtime is a modifier on a quarter of public FFA games: it should follow
// the roll in FFA, and never appear in team or special lobbies.
describe("MapPlaylist overtime", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    randomSpy = vi.spyOn(Math, "random");
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  it("enables overtime and its lobby modifier on a low FFA roll", async () => {
    randomSpy.mockReturnValue(0.1);
    const config = await new MapPlaylist().gameConfig("ffa");
    expect(config.gameMode).toBe(GameMode.FFA);
    expect(config.overtime).toEqual({ enabled: true });
    expect(config.publicGameModifiers?.isOvertime).toBe(true);
    expect(GameConfigSchema.safeParse(config).success).toBe(true);
  });

  it("leaves overtime off on a high FFA roll", async () => {
    randomSpy.mockReturnValue(0.9);
    const config = await new MapPlaylist().gameConfig("ffa");
    expect(config.overtime).toBeUndefined();
    expect(config.publicGameModifiers?.isOvertime).toBeUndefined();
  });

  it("never enables overtime in team lobbies", async () => {
    randomSpy.mockReturnValue(0.1);
    const config = await new MapPlaylist().gameConfig("team");
    expect(config.gameMode).toBe(GameMode.Team);
    expect(config.overtime).toBeUndefined();
    expect(config.publicGameModifiers?.isOvertime).toBeUndefined();
  });

  it("never enables overtime in special lobbies", async () => {
    randomSpy.mockReturnValue(0.1);
    const config = await new MapPlaylist().gameConfig("special");
    expect(config.overtime).toBeUndefined();
    expect(config.publicGameModifiers?.isOvertime).toBeUndefined();
  });
});
