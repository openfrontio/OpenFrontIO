import {
  ClientLobbyChatSchema,
  GameConfigSchema,
  ServerLobbyChatSchema,
} from "../src/core/Schemas";

describe("Lobby Chat Schemas", () => {
  test("GameConfigSchema applies default chatEnabled false", () => {
    const cfg = GameConfigSchema.parse({
      gameMap: "World",
      difficulty: "Medium",
      donateGold: false,
      donateTroops: false,
      gameType: "Private",
      gameMode: "Free For All",
      gameMapSize: "Normal",
      disableNPCs: false,
      bots: 0,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
    } as any);
    expect(cfg.chatEnabled).toBe(false);
  });

  test("ClientLobbyChatSchema valid message", () => {
    const msg = ClientLobbyChatSchema.parse({
      type: "lobby_chat",
      clientID: "ABCDEFGH",
      text: "Hello everyone",
    });
    expect(msg.text).toBe("Hello everyone");
  });

  test("ClientLobbyChatSchema rejects long text", () => {
    const longText = "A".repeat(301);
    const result = ClientLobbyChatSchema.safeParse({
      type: "lobby_chat",
      clientID: "ABCDEFGH",
      text: longText,
    });
    expect(result.success).toBe(false);
  });

  test("ServerLobbyChatSchema valid message", () => {
    const msg = ServerLobbyChatSchema.parse({
      type: "lobby_chat",
      username: "TestUser",
      isHost: true,
      text: "Hi host",
    });
    expect(msg.username).toBe("TestUser");
    expect(msg.isHost).toBe(true);
  });

  test("ServerLobbyChatSchema rejects missing fields", () => {
    const result = ServerLobbyChatSchema.safeParse({
      type: "lobby_chat",
      text: "Hi host",
    });
    expect(result.success).toBe(false);
  });
});
