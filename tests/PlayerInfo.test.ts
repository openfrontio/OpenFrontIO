import { PlayerInfo, PlayerType } from "../src/core/game/Game";

describe("PlayerInfo", () => {
  describe("clan", () => {
    test("should extract clan from name when format is [XX]Name", () => {
      const playerInfo = new PlayerInfo(
        "[CL]PlayerName",
        PlayerType.Human,
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("CL");
    });

    test("should extract clan from name when format is [XXX]Name", () => {
      const playerInfo = new PlayerInfo(
        "[ABC]PlayerName",
        PlayerType.Human,
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("ABC");
    });

    test("should extract clan from name when format is [XXXX]Name", () => {
      const playerInfo = new PlayerInfo(
        "[ABCD]PlayerName",
        PlayerType.Human,
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("ABCD");
    });

    test("should extract clan from name when format is [XXXXX]Name", () => {
      const playerInfo = new PlayerInfo(
        "[ABCDE]PlayerName",
        PlayerType.Human,
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("ABCDE");
    });

    test("should extract clan from name when format is [xxxxx]Name", () => {
      const playerInfo = new PlayerInfo(
        "[abcde]PlayerName",
        PlayerType.Human,
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("abcde");
    });

    test("should extract clan from name when format is [XxXxX]Name", () => {
      const playerInfo = new PlayerInfo(
        "[AbCdE]PlayerName",
        PlayerType.Human,
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("AbCdE");
    });

    test("should return null when name doesn't start with [", () => {
      const playerInfo = new PlayerInfo(
        "PlayerName",
        PlayerType.Human,
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBeNull();
    });

    test("should return null when name doesn't contain ]", () => {
      const playerInfo = new PlayerInfo(
        "[ABCPlayerName",
        PlayerType.Human,
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBeNull();
    });

    test("should return null when clan tag is not 2-5 uppercase letters", () => {
      const playerInfo = new PlayerInfo(
        "[A]PlayerName",
        PlayerType.Human,
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBeNull();
    });

    test("should return null when clan tag contains non alphanumeric characters", () => {
      const playerInfo = new PlayerInfo(
        "[A1c]PlayerName",
        PlayerType.Human,
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBeNull();
    });

    test("should return null when clan tag is too long", () => {
      const playerInfo = new PlayerInfo(
        "[ABCDEF]PlayerName",
        PlayerType.Human,
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBeNull();
    });
  });
});
