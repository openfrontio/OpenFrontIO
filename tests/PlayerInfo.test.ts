import { PlayerInfo } from "../src/core/game/Game";

describe("PlayerInfo", () => {
  describe("clan", () => {
    test("should extract clan from name when format contains [XX]", () => {
      const playerInfo = new PlayerInfo(
        "[CL]PlayerName",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("CL");
    });

    test("should extract clan from name when format contains [XXX]", () => {
      const playerInfo = new PlayerInfo(
        "[ABC]PlayerName",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("ABC");
    });

    test("should extract clan from name when format contains [XXXX]", () => {
      const playerInfo = new PlayerInfo(
        "[ABCD]PlayerName",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("ABCD");
    });

    test("should extract clan from name when format contains [XXXXX]", () => {
      const playerInfo = new PlayerInfo(
        "[ABCDE]PlayerName",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("ABCDE");
    });

    test("should extract uppercase clan from name when format contains [xxxxx]", () => {
      const playerInfo = new PlayerInfo(
        "[abcde]PlayerName",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("ABCDE");
    });

    test("should extract uppercase clan from name when format contains [XxXxX]", () => {
      const playerInfo = new PlayerInfo(
        "[AbCdE]PlayerName",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("ABCDE");
    });

    test("should extract uppercase clan from name when format contains [Xx#xX]", () => {
      const playerInfo = new PlayerInfo(
        "[Ab1cD]PlayerName",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("AB1CD");
    });

    test("should return null when name doesn't contain [", () => {
      const playerInfo = new PlayerInfo(
        "PlayerName",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBeNull();
    });

    test("should return null when name doesn't contain ]", () => {
      const playerInfo = new PlayerInfo(
        "[ABCPlayerName",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBeNull();
    });

    test("should return null when clan tag is not 2-5 alphanumeric letters", () => {
      const playerInfo = new PlayerInfo(
        "[A]PlayerName",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBeNull();
    });

    test("should return null when clan tag contains non alphanumeric characters", () => {
      const playerInfo = new PlayerInfo(
        "[A?c]PlayerName",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBeNull();
    });

    test("should return null when clan tag is too long", () => {
      const playerInfo = new PlayerInfo(
        "[ABCDEF]PlayerName",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBeNull();
    });

    test("should extract uppercase clan name from any location in the player name", () => {
      const playerInfo = new PlayerInfo(
        "Player[aa]Name",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("AA");
    });

    test("should extract only the first occurrence of a clan name match", () => {
      const playerInfo = new PlayerInfo(
        "[Ab1cD]Player[aa]Name",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("AB1CD");
    });

    test("should extract only the first occurrence of a valid clan name match and extract as uppercase", () => {
      const playerInfo = new PlayerInfo(
        "[Ab1cDEF]Player[aa]Name",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("AA");
    });

    test("should extract numeric-only clan names", () => {
      const playerInfo = new PlayerInfo(
        "[012]PlayerName",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("012");
    });

    test("should extract numeric-only clan names and only the first valid clan name", () => {
      const playerInfo = new PlayerInfo(
        "[012]Player[aa]Name",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("012");
    });

    test("should extract numeric-only clan names from anywhere within the name", () => {
      const playerInfo = new PlayerInfo(
        "Player[012]Name",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("012");
    });

    test("should extract numeric-only clan names from the end of the name", () => {
      const playerInfo = new PlayerInfo(
        "PlayerName[012]",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("012");
    });

    test("should extract uppercase alphanumeric clan names from anywhere within the name", () => {
      const playerInfo = new PlayerInfo(
        "Player[0a1B2]Name",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("0A1B2");
    });

    test("should extract uppercase alphanumeric clan names from the end of the name", () => {
      const playerInfo = new PlayerInfo(
        "PlayerName[0a1B2]",
        "HUMAN",
        null,
        "player_id",
      );
      expect(playerInfo.clan).toBe("0A1B2");
    });
  });
});
