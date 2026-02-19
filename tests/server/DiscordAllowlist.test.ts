import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

vi.mock("../../src/core/configuration/ConfigLoader", () => ({
  getServerConfigFromServer: () => ({
    otelEnabled: () => false,
    otelAuthHeader: () => "",
    otelEndpoint: () => "",
    env: () => 0,
  }),
  getServerConfig: () => ({
    otelEnabled: () => false,
  }),
}));

import { GameEnv } from "../../src/core/configuration/Config";
import { GameType } from "../../src/core/game/Game";
import { Client } from "../../src/server/Client";
import { GameServer } from "../../src/server/GameServer";

const ALLOWED_DISCORD_ID = "12345678901234567";
const BLOCKED_DISCORD_ID = "76543210987654321";
const REQUIRED_GUILD_ID = "1474121677725241406";
const REQUIRED_ROLE_ID = "422545450919526411";
const REQUIRED_ROLE_ID_2 = "422545450919526412";

class MockWebSocket {
  public readyState: number = WebSocket.OPEN;
  public sentMessages: string[] = [];

  private listeners = new Map<string, Array<(...args: any[]) => void>>();

  public send = vi.fn((message: string) => {
    this.sentMessages.push(message);
  });

  public close = vi.fn(() => {
    this.readyState = WebSocket.CLOSED;
  });

  public on = vi.fn((event: string, handler: (...args: any[]) => void) => {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(handler);
    this.listeners.set(event, handlers);
    return this;
  });

  public removeAllListeners = vi.fn((event?: string) => {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  });
}

describe("Discord allowlist", () => {
  let mockLogger: any;
  let mockConfig: any;

  beforeEach(() => {
    vi.useFakeTimers();
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    mockConfig = {
      turnIntervalMs: () => 100,
      gameCreationRate: () => 1000,
      env: () => GameEnv.Dev,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  const createClient = (
    clientID: string,
    persistentID: string,
    discordId: string | undefined,
    discordGuildRoles?: Record<string, string[]>,
  ) => {
    const ws = new MockWebSocket();
    const client = new Client(
      clientID as any,
      persistentID,
      null,
      undefined,
      undefined,
      "127.0.0.1",
      clientID,
      clientID,
      ws as unknown as WebSocket,
      undefined,
      discordId,
      discordGuildRoles,
    );
    return { client, ws };
  };

  it("rejects joins when discord id is not allowlisted", () => {
    const game = new GameServer(
      "testgame1",
      mockLogger,
      Date.now(),
      mockConfig,
      {
        gameType: GameType.Private,
        allowedDiscordIds: [ALLOWED_DISCORD_ID],
      } as any,
      "creator-pid",
    );

    const { client, ws } = createClient(
      "blocked-client",
      "blocked-pid",
      BLOCKED_DISCORD_ID,
    );
    const result = game.joinClient(client);

    expect(result).toBe("kicked");
    const errorMsg = JSON.parse(ws.sentMessages[0] ?? "{}");
    expect(errorMsg.error).toBe("kick_reason.discord_not_allowed");
  });

  it("kicks disconnected clients after allowlist update to prevent rejoin bypass", () => {
    const game = new GameServer(
      "testgame2",
      mockLogger,
      Date.now(),
      mockConfig,
      {
        gameType: GameType.Private,
      } as any,
      "creator-pid",
    );

    const { client } = createClient(
      "player-client",
      "player-pid",
      BLOCKED_DISCORD_ID,
    );
    expect(game.joinClient(client)).toBe("joined");

    game.activeClients = [];
    game.updateGameConfig({ allowedDiscordIds: [ALLOWED_DISCORD_ID] });

    expect(game.getClientIdForPersistentId("player-pid")).toBeNull();
  });

  it("hides allowlist ids from non-creator lobby broadcasts", () => {
    const game = new GameServer(
      "testgame3",
      mockLogger,
      Date.now(),
      mockConfig,
      {
        gameType: GameType.Private,
        allowedDiscordIds: [ALLOWED_DISCORD_ID],
      } as any,
      "creator-pid",
    );

    const { client: creatorClient, ws: creatorWs } = createClient(
      "creator-client",
      "creator-pid",
      undefined,
    );
    expect(game.joinClient(creatorClient)).toBe("joined");

    const { client: guestClient, ws: guestWs } = createClient(
      "guest-client",
      "guest-pid",
      ALLOWED_DISCORD_ID,
    );
    expect(game.joinClient(guestClient)).toBe("joined");

    const creatorLobbyInfo = creatorWs.sentMessages
      .map((msg) => JSON.parse(msg))
      .reverse()
      .find((msg) => msg.type === "lobby_info");
    const guestLobbyInfo = guestWs.sentMessages
      .map((msg) => JSON.parse(msg))
      .reverse()
      .find((msg) => msg.type === "lobby_info");

    expect(creatorLobbyInfo?.lobby?.gameConfig?.allowedDiscordIds).toEqual([
      ALLOWED_DISCORD_ID,
    ]);
    expect(
      Object.prototype.hasOwnProperty.call(
        guestLobbyInfo?.lobby?.gameConfig ?? {},
        "allowedDiscordIds",
      ),
    ).toBe(false);
  });

  it("rejects joins when required discord role is missing", () => {
    const game = new GameServer(
      "testgame4",
      mockLogger,
      Date.now(),
      mockConfig,
      {
        gameType: GameType.Private,
        requiredDiscordGuildId: REQUIRED_GUILD_ID,
        requiredDiscordRoleId: REQUIRED_ROLE_ID,
      } as any,
      "creator-pid",
    );

    const { client, ws } = createClient(
      "blocked-client",
      "blocked-pid",
      BLOCKED_DISCORD_ID,
    );
    const result = game.joinClient(client);

    expect(result).toBe("kicked");
    const errorMsg = JSON.parse(ws.sentMessages[0] ?? "{}");
    expect(errorMsg.error).toBe("kick_reason.discord_role_not_allowed");
  });

  it("allows joins when required discord role is present in guild roles", () => {
    const game = new GameServer(
      "testgame5",
      mockLogger,
      Date.now(),
      mockConfig,
      {
        gameType: GameType.Private,
        requiredDiscordGuildId: REQUIRED_GUILD_ID,
        requiredDiscordRoleId: REQUIRED_ROLE_ID,
      } as any,
      "creator-pid",
    );

    const ws = new MockWebSocket();
    const client = new Client(
      "allowed-client" as any,
      "allowed-pid",
      null,
      undefined,
      undefined,
      "127.0.0.1",
      "allowed-client",
      "allowed-client",
      ws as unknown as WebSocket,
      undefined,
      ALLOWED_DISCORD_ID,
      {
        [REQUIRED_GUILD_ID]: [REQUIRED_ROLE_ID],
      },
    );

    expect(game.joinClient(client)).toBe("joined");
  });

  it("allows joins when any configured required role pair matches", () => {
    const game = new GameServer(
      "testgame6",
      mockLogger,
      Date.now(),
      mockConfig,
      {
        gameType: GameType.Private,
        requiredDiscordRoles: [
          { guildId: REQUIRED_GUILD_ID, roleId: REQUIRED_ROLE_ID },
          { guildId: REQUIRED_GUILD_ID, roleId: REQUIRED_ROLE_ID_2 },
        ],
      } as any,
      "creator-pid",
    );

    const { client: blockedClient, ws: blockedWs } = createClient(
      "blocked-client",
      "blocked-pid",
      ALLOWED_DISCORD_ID,
      {
        [REQUIRED_GUILD_ID]: [],
      },
    );
    expect(game.joinClient(blockedClient)).toBe("kicked");
    const blockedError = JSON.parse(blockedWs.sentMessages[0] ?? "{}");
    expect(blockedError.error).toBe("kick_reason.discord_role_not_allowed");

    const { client: allowedClient } = createClient(
      "allowed-client",
      "allowed-pid",
      ALLOWED_DISCORD_ID,
      {
        [REQUIRED_GUILD_ID]: [REQUIRED_ROLE_ID_2],
      },
    );
    expect(game.joinClient(allowedClient)).toBe("joined");
  });
});
