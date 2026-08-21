import { describe, expect, it } from "vitest";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  UnitType,
} from "../../src/core/game/Game";
import {
  ADMIN_BOT_CLIENT_ID,
  ClientMessage,
  ClientMessageSchema,
  GameConfig,
  LogSeverity,
  PublicLobbyMessage,
  PublicLobbyMessageSchema,
  ServerMessage,
  ServerMessageSchema,
  StampedIntent,
  Turn,
} from "../../src/core/Schemas";
import { replacer } from "../../src/core/Util";
import {
  createGameWireContext,
  decodeClientMessage,
  decodeLobbyMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeLobbyMessage,
  encodeServerMessage,
} from "../../src/core/ZbinWire";
import { ZbDecodeError } from "../../zbin";

const PLAYERS = [
  { clientID: "aB3dEf7h" },
  { clientID: "Xk9mNp2q" },
  { clientID: "Zz8wVu5t" },
];

const [P1, P2, P3] = PLAYERS.map((p) => p.clientID);

// Server and client each build their own context from the same roster, the way
// GameServer.start() and Transport's start handler do.
function ctxPair() {
  return [createGameWireContext(PLAYERS), createGameWireContext(PLAYERS)];
}

const CONFIG: GameConfig = {
  gameMap: GameMapType.World,
  difficulty: Difficulty.Medium,
  donateGold: true,
  donateTroops: true,
  gameType: GameType.Public,
  gameMode: GameMode.FFA,
  gameMapSize: GameMapSize.Normal,
  nations: "default",
  bots: 200,
  infiniteGold: false,
  infiniteTroops: false,
  instantBuild: false,
  randomSpawn: false,
};

// One of every intent type, as stamped intents inside a turn.
const SAMPLE_INTENTS: StampedIntent[] = [
  { type: "spawn", clientID: P1, tile: 123456 },
  { type: "attack", clientID: P1, targetID: P2, troops: 5123.75 },
  { type: "attack", clientID: P2, targetID: null, troops: null },
  { type: "cancel_attack", clientID: P1, attackID: "a1b2c3d4" },
  { type: "boat", clientID: P2, troops: 100.5, dst: 998877 },
  { type: "cancel_boat", clientID: P2, unitID: 42 },
  { type: "allianceRequest", clientID: P1, recipient: P3 },
  { type: "allianceReject", clientID: P3, requestor: P1 },
  { type: "allianceExtension", clientID: P1, recipient: P3 },
  { type: "breakAlliance", clientID: P1, recipient: P3 },
  { type: "targetPlayer", clientID: P2, target: P1 },
  { type: "emoji", clientID: P1, recipient: "AllPlayers", emoji: 3 },
  { type: "emoji", clientID: P1, recipient: P2, emoji: 0 },
  { type: "donate_gold", clientID: P1, recipient: P2, gold: 1000000 },
  { type: "donate_troops", clientID: P1, recipient: P2, troops: null },
  {
    type: "build_unit",
    clientID: P2,
    unit: UnitType.Port,
    tile: 7,
    amount: 3,
  },
  {
    type: "upgrade_structure",
    clientID: P2,
    unit: UnitType.City,
    unitId: 88,
  },
  { type: "embargo", clientID: P1, targetID: P2, action: "start" },
  { type: "embargo_all", clientID: P1, action: "stop" },
  { type: "move_warship", clientID: P3, unitIds: [1, 2, 3], tile: 555 },
  { type: "delete_unit", clientID: P3, unitId: 9 },
  { type: "mark_disconnected", clientID: P1, isDisconnected: true },
  { type: "kick_player", clientID: P1, targetClientID: P2 },
  {
    type: "quick_chat",
    clientID: P1,
    recipient: P2,
    quickChatKey: "help.troops",
    target: P3,
  },
  { type: "toggle_pause", clientID: ADMIN_BOT_CLIENT_ID, paused: true },
  {
    type: "update_game_config",
    clientID: P1,
    config: { bots: 5, instantBuild: true },
  },
  { type: "toggle_game_start_timer", clientID: P1 },
];

const SERVER_MESSAGES: ServerMessage[] = [
  { type: "ping" },
  { type: "turn", turn: { turnNumber: 12345, intents: [] } },
  { type: "turn", turn: { turnNumber: 999, intents: SAMPLE_INTENTS } },
  {
    type: "turn",
    turn: { turnNumber: 4, intents: [], hash: 1234.5 },
  },
  {
    type: "prestart",
    gameMap: GameMapType.Europe,
    gameMapSize: GameMapSize.Compact,
  },
  {
    type: "start",
    turns: [{ turnNumber: 0, intents: SAMPLE_INTENTS.slice(0, 2) }],
    lobbyCreatedAt: 1_700_000_000_000,
    myClientID: P1,
    gameStartInfo: {
      gameID: "gM3xQ1zR",
      lobbyCreatedAt: 1_700_000_000_000,
      config: CONFIG,
      players: [
        { clientID: P1, username: "alpha", clanTag: "ABC" },
        {
          clientID: P2,
          username: "bravo",
          clanTag: null,
          isLobbyCreator: true,
          teamIndex: 1,
          friends: [P1],
          cosmetics: { flag: "flag:mars", verified: true },
        },
        { clientID: P3, username: "charlie", clanTag: null },
      ],
      tribes: [{ name: "Wolves" }],
    },
  },
  {
    type: "desync",
    turn: 77,
    correctHash: 12345.5,
    clientsWithCorrectHash: 3,
    totalActiveClients: 5,
    yourHash: 999.25,
  },
  { type: "error", error: "full-lobby" },
  { type: "error", error: "kicked", message: "by host" },
  {
    type: "lobby_info",
    myClientID: P1,
    lobby: {
      gameID: "gM3xQ1zR",
      serverTime: 1_700_000_000_000,
      startsAt: 1_700_000_030_000,
      gameConfig: CONFIG,
      clients: [
        { clientID: P1, username: "alpha", clanTag: null, teamIndex: 0 },
        { clientID: P2, username: "bravo", clanTag: "XY", verified: true },
      ],
      lobbyCreatorClientID: P1,
    },
  },
  { type: "new_lobby", gameID: "nEwL0bby" },
];

const TOKEN = "3f1b8c8e-4a2f-4a0e-9d5e-6f2a1b3c4d5e";

const CLIENT_MESSAGES: ClientMessage[] = [
  { type: "ping" },
  { type: "hash", hash: 3735928559.5, turnNumber: 120 },
  {
    type: "intent",
    intent: { type: "attack", targetID: P3, troops: 17.25 },
  },
  {
    type: "join",
    token: TOKEN,
    gameID: "gM3xQ1zR",
    username: "alpha",
    clanTag: "ABC",
    turnstileToken: null,
    cosmetics: {
      flag: "country:us",
      patternName: "stripes_01",
      effects: { nukeTrail: "sparkle" },
      verified: true,
    },
  },
  {
    type: "rejoin",
    gameID: "gM3xQ1zR",
    lastTurn: 4321,
    token: TOKEN,
  },
  { type: "log", severity: LogSeverity.Warn, log: "abcd1234" },
  {
    type: "winner",
    winner: ["player", P1, P2],
    allPlayersStats: {
      [P1]: {
        attacks: [10n, 20n, 0n],
        gold: [1n, 2n, 3n, 4n, 5n, 6n],
        killedBy: null,
        deathPosition: 2,
        kills: [{ victim: P2, tick: 400n }],
        units: { city: [3n, 0n, 0n, 0n, 1n] },
      },
      [P2]: { betrayals: 1n, finalTiles: 5000n },
    },
  },
  {
    type: "live_stats",
    stats: {
      turn: 900,
      players: [
        {
          clientID: P1,
          tilesOwned: 1234,
          troops: 5000.5,
          gold: "123456789012345678901234567890",
          isAlive: true,
          team: null,
          killedBy: null,
          deathPosition: null,
        },
        {
          clientID: P2,
          tilesOwned: 0,
          troops: 0,
          gold: "0",
          isAlive: false,
          team: "Red",
          killedBy: P1,
          deathPosition: 3,
        },
      ],
    },
  },
];

const LOBBY_MESSAGES: PublicLobbyMessage[] = [
  {
    type: "full",
    serverTime: 1_700_000_000_000,
    games: {
      ffa: [
        {
          gameID: "gM3xQ1zR",
          numClients: 42,
          startsAt: 1_700_000_030_000,
          gameConfig: CONFIG,
          publicGameType: "ffa",
        },
      ],
      hosted: [
        {
          gameID: "hOsT3d01",
          numClients: 3,
          publicGameType: "hosted",
          label: "Tournament finals 🏆",
          accent: "gold",
          featured: true,
        },
      ],
    },
  },
  {
    type: "counts",
    serverTime: 1_700_000_000_000,
    counts: { gM3xQ1zR: 42, hOsT3d01: 3 },
  },
];

// The JSON path a message would have taken before zbin, so binary decoding can
// be checked against it rather than against the in-memory literal alone.
function viaJson<T>(schema: { parse: (v: unknown) => T }, msg: unknown): T {
  return schema.parse(JSON.parse(JSON.stringify(msg, replacer)));
}

describe("zbin wire: server messages", () => {
  it.each(SERVER_MESSAGES.map((m) => [m.type, m] as const))(
    "round-trips a %s message",
    (_type, msg) => {
      const [sctx, cctx] = ctxPair();
      const decoded = decodeServerMessage(encodeServerMessage(msg, sctx), cctx);
      expect(decoded).toEqual(viaJson(ServerMessageSchema, msg));
    },
  );

  it("encodes the start message without the dictionary", () => {
    // The start message carries the roster the receiver seeds its table from,
    // so a client that has no table yet must still be able to read it.
    const [sctx] = ctxPair();
    const start = SERVER_MESSAGES.find((m) => m.type === "start")!;
    const bytes = encodeServerMessage(start, sctx);
    expect(decodeServerMessage(bytes, undefined)).toEqual(
      viaJson(ServerMessageSchema, start),
    );
  });

  it("keeps an empty turn under 8 bytes", () => {
    const [sctx] = ctxPair();
    const bytes = encodeServerMessage(
      { type: "turn", turn: { turnNumber: 12345, intents: [] } },
      sctx,
    );
    expect(bytes.length).toBeLessThanOrEqual(8);
  });

  it("is much smaller than JSON for a realistic turn", () => {
    const [sctx] = ctxPair();
    const turn: Turn = {
      turnNumber: 12345,
      intents: [
        { type: "attack", clientID: P1, targetID: P2, troops: 5123.75 },
        {
          type: "build_unit",
          clientID: P2,
          unit: UnitType.Port,
          tile: 998877,
        },
      ],
    };
    const msg: ServerMessage = { type: "turn", turn };
    const jsonSize = JSON.stringify(msg).length;
    expect(encodeServerMessage(msg, sctx).length).toBeLessThan(jsonSize / 5);
  });

  it("rejects truncated frames", () => {
    const [sctx, cctx] = ctxPair();
    const bytes = encodeServerMessage(
      {
        type: "turn",
        turn: { turnNumber: 1, intents: SAMPLE_INTENTS.slice(0, 3) },
      },
      sctx,
    );
    for (let cut = 1; cut < bytes.length; cut++) {
      expect(() => decodeServerMessage(bytes.subarray(0, cut), cctx)).toThrow(
        ZbDecodeError,
      );
    }
  });

  it("rejects trailing bytes", () => {
    const [sctx, cctx] = ctxPair();
    const bytes = encodeServerMessage({ type: "ping" }, sctx);
    const padded = new Uint8Array(bytes.length + 1);
    padded.set(bytes);
    expect(() => decodeServerMessage(padded, cctx)).toThrow(ZbDecodeError);
  });

  it("unmapped ids (admin bot) survive via the inline escape", () => {
    const [sctx, cctx] = ctxPair();
    const msg: ServerMessage = {
      type: "turn",
      turn: {
        turnNumber: 5,
        intents: [
          {
            type: "toggle_pause",
            clientID: ADMIN_BOT_CLIENT_ID,
            paused: false,
          },
        ],
      },
    };
    expect(decodeServerMessage(encodeServerMessage(msg, sctx), cctx)).toEqual(
      msg,
    );
  });

  it("fails loudly when the peers seeded different rosters", () => {
    const sctx = createGameWireContext(PLAYERS);
    const cctx = createGameWireContext(PLAYERS.slice(0, 1));
    const bytes = encodeServerMessage(
      {
        type: "turn",
        turn: {
          turnNumber: 1,
          intents: [{ type: "targetPlayer", clientID: P1, target: P3 }],
        },
      },
      sctx,
    );
    expect(() => decodeServerMessage(bytes, cctx)).toThrow(ZbDecodeError);
  });
});

describe("zbin wire: client messages", () => {
  it.each(CLIENT_MESSAGES.map((m) => [m.type, m] as const))(
    "round-trips a %s message",
    (_type, msg) => {
      const [cctx, sctx] = ctxPair();
      const decoded = decodeClientMessage(encodeClientMessage(msg, cctx), sctx);
      expect(decoded).toEqual(viaJson(ClientMessageSchema, msg));
    },
  );

  it("round-trips join and rejoin with no dictionary yet", () => {
    // Both are sent before the game starts, when neither peer has a table.
    for (const msg of CLIENT_MESSAGES.filter(
      (m) => m.type === "join" || m.type === "rejoin",
    )) {
      const decoded = decodeClientMessage(
        encodeClientMessage(msg, undefined),
        undefined,
      );
      expect(decoded).toEqual(viaJson(ClientMessageSchema, msg));
    }
  });

  it("keeps an attack intent to about a dozen bytes", () => {
    const [cctx] = ctxPair();
    const bytes = encodeClientMessage(
      { type: "intent", intent: { type: "attack", targetID: P2, troops: 500 } },
      cctx,
    );
    expect(bytes.length).toBeLessThanOrEqual(14);
  });

  it("preserves bigint stats exactly", () => {
    const [cctx, sctx] = ctxPair();
    const huge = 2n ** 200n + 12345n;
    const msg: ClientMessage = {
      type: "winner",
      winner: ["team", "Red", P1],
      allPlayersStats: { [P1]: { gold: [huge], betrayals: -7n } },
    };
    const decoded = decodeClientMessage(encodeClientMessage(msg, cctx), sctx);
    expect(decoded).toEqual(msg);
  });

  it("accepts stats that arrive as decimal strings", () => {
    // Engine values are bigints, but the same schema also reads archived JSON
    // where they are strings; both must encode to the same bytes.
    const [cctx, sctx] = ctxPair();
    const asBigint: ClientMessage = {
      type: "winner",
      winner: undefined,
      allPlayersStats: { [P1]: { betrayals: 42n } },
    };
    const asString = {
      ...asBigint,
      allPlayersStats: { [P1]: { betrayals: "42" } },
    };
    expect(
      encodeClientMessage(asString as unknown as ClientMessage, cctx),
    ).toEqual(encodeClientMessage(asBigint, cctx));
    expect(
      decodeClientMessage(encodeClientMessage(asBigint, cctx), sctx),
    ).toEqual(asBigint);
  });

  it("rejects truncated frames", () => {
    const [cctx, sctx] = ctxPair();
    const bytes = encodeClientMessage(
      { type: "hash", hash: 1.5, turnNumber: 300 },
      cctx,
    );
    for (let cut = 1; cut < bytes.length; cut++) {
      expect(() => decodeClientMessage(bytes.subarray(0, cut), sctx)).toThrow(
        ZbDecodeError,
      );
    }
  });

  it("rejects a payload that decodes but violates the schema", () => {
    // parseBytes runs full zod validation, so a structurally valid frame with
    // an out-of-range value is still rejected.
    const [cctx, sctx] = ctxPair();
    const bytes = encodeClientMessage(
      {
        type: "rejoin",
        gameID: "not a game id!" as never,
        lastTurn: 1,
        token: TOKEN,
      },
      cctx,
    );
    expect(() => decodeClientMessage(bytes, sctx)).toThrow();
  });
});

describe("zbin wire: lobby list messages", () => {
  it.each(LOBBY_MESSAGES.map((m) => [m.type, m] as const))(
    "round-trips a %s message",
    (_type, msg) => {
      const decoded = decodeLobbyMessage(encodeLobbyMessage(msg));
      expect(decoded).toEqual(viaJson(PublicLobbyMessageSchema, msg));
    },
  );

  // The lobby socket carries no player ids, so it gets no dictionary: the
  // saving here is structural (varints, no keys, no punctuation) only.
  it("shrinks the counts broadcast below JSON", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 20; i++) {
      counts[`g${String(i).padStart(7, "0")}`] = i * 3;
    }
    const msg: PublicLobbyMessage = {
      type: "counts",
      serverTime: 1_700_000_000_000,
      counts,
    };
    const jsonSize = JSON.stringify(msg).length;
    expect(encodeLobbyMessage(msg).length).toBeLessThan(jsonSize * 0.7);
  });

  it("shrinks the full snapshot well below JSON", () => {
    const msg = LOBBY_MESSAGES[0];
    const jsonSize = JSON.stringify(msg).length;
    expect(encodeLobbyMessage(msg).length).toBeLessThan(jsonSize / 3);
  });

  it("rejects corrupt frames", () => {
    const bytes = encodeLobbyMessage(LOBBY_MESSAGES[1]);
    expect(() => decodeLobbyMessage(bytes.subarray(0, 2))).toThrow(
      ZbDecodeError,
    );
  });
});
