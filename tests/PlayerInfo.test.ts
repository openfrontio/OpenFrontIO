import { PlayerInfo, PlayerType } from "../src/core/game/Game";

describe("PlayerInfo", () => {
  describe("clanTag from explicit clanTag parameter", () => {
    test("should set clanTag from clanTag parameter", () => {
      const playerInfo = new PlayerInfo(
        "PlayerName",
        PlayerType.Human,
        null,
        "player_id",
        false,
        "abc",
      );
      expect(playerInfo.clanTag).toBe("abc");
    });

    test("should preserve already-uppercase clan tag", () => {
      const playerInfo = new PlayerInfo(
        "PlayerName",
        PlayerType.Human,
        null,
        "player_id",
        false,
        "CLAN",
      );
      expect(playerInfo.clanTag).toBe("CLAN");
    });

    test("should set clan to null when clanTag is not provided", () => {
      const playerInfo = new PlayerInfo(
        "PlayerName",
        PlayerType.Human,
        null,
        "player_id",
      );
      expect(playerInfo.clanTag).toBeNull();
    });

    test("should set clan to null when clanTag is null", () => {
      const playerInfo = new PlayerInfo(
        "PlayerName",
        PlayerType.Human,
        null,
        "player_id",
        false,
        null,
      );
      expect(playerInfo.clanTag).toBeNull();
    });

    test("should set clan to null when clanTag is undefined", () => {
      const playerInfo = new PlayerInfo(
        "PlayerName",
        PlayerType.Human,
        null,
        "player_id",
        false,
        undefined,
      );
      expect(playerInfo.clanTag).toBeNull();
    });
  });

  describe("displayName", () => {
    test("should construct display name with clan tag", () => {
      const playerInfo = new PlayerInfo(
        "PlayerName",
        PlayerType.Human,
        null,
        "player_id",
        false,
        "CLAN",
      );
      expect(playerInfo.displayName).toBe("[CLAN] PlayerName");
    });

    test("should return just name when no clan tag", () => {
      const playerInfo = new PlayerInfo(
        "PlayerName",
        PlayerType.Human,
        null,
        "player_id",
      );
      expect(playerInfo.displayName).toBe("PlayerName");
    });

    test("should preserve clan tag casing in display name", () => {
      const playerInfo = new PlayerInfo(
        "PlayerName",
        PlayerType.Human,
        null,
        "player_id",
        false,
        "abc",
      );
      expect(playerInfo.displayName).toBe("[abc] PlayerName");
    });
  });
});
