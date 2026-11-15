import {
  IntentSchema,
  GameConfigSchema,
  TurnSchema,
} from "@openfront/engine-api/Schemas";
import { VersionedSchema } from "@openfront/engine-lib/snapshot/SnapshotType";
import {
  TokenPayloadSchema,
  UserMeResponseSchema,
  PlayerProfileSchema,
  PublicPlayerGamesResponseSchema,
  RankedLeaderboardResponseSchema,
  PaymentsCheckoutResponseSchema,
  ProgressionConfigSchema,
} from "@openfront/shared/ApiSchemas";
import {
  ServerMessageSchema,
  ClientMessageSchema,
  ClientMessage,
  ServerMessage,
} from "@openfront/shared/WireSchemas";
import { createGameWireContext } from "@openfront/shared/ZbinWire";
import { describe, it } from "vitest";

describe("Zod Schema Real-World Benchmark (50k iterations)", () => {
  const ITERS = 50000;

  const clientPing: ClientMessage = { type: "ping", sentAt: Date.now() };
  const clientIntent: ClientMessage = {
    type: "intent",
    intent: {
      type: "attack",
      targetID: "12345678",
      troops: 55.5,
    },
  };
  const serverTurn: ServerMessage = {
    type: "turn",
    turn: {
      turnNumber: 150,
      intents: [
        {
          type: "attack",
          targetID: "12345678",
          troops: 55.5,
          clientID: "player123",
        },
      ],
      hash: 12345678.9,
    },
  };
  const wireCtx = createGameWireContext([]);
  const clientPingBytes = ClientMessageSchema.serialize(clientPing, wireCtx);
  const serverTurnBytes = ServerMessageSchema.serialize(serverTurn, wireCtx);

  const userMePayload = {
    user: {
      email: "player@example.com",
      discord: { id: "123456789" },
    },
    player: {
      publicId: "pub-1234-5678",
      adfree: true,
      canCreatePublicLobbies: true,
      achievements: { singleplayerMap: [] },
      friends: ["friend-1", "friend-2"],
      subscription: {
        tier: "pro",
        status: "active",
        currentPeriodEnd: new Date(),
      },
    },
  };

  const playerProfilePayload = {
    createdAt: new Date().toISOString(),
    username: "GrandMaster.1234",
    stats: {
      Singleplayer: {},
      Public: {},
    },
    ffaRating: {
      rating: 1850.5,
      uncertainty: 45.2,
      tier: "Gold I",
      games: 120,
      wins: 45,
      peak: 1910.0,
    },
  };

  const intentPayload = {
    type: "attack",
    targetID: "target12",
    troops: 100,
  };

  const turnPayload = {
    turnNumber: 250,
    intents: [],
    hash: 98765432.1,
  };

  const versionedPayload = {
    v: 1,
    d: { map: "world", players: 90, tick: 500 },
  };

  it("benchmarks all schemas", () => {
    // 1. ClientMessage.parseBytes
    let t0 = performance.now();
    for (let i = 0; i < ITERS; i++)
      ClientMessageSchema.parseBytes(clientPingBytes, wireCtx);
    const clientMsgParseBytesMs = performance.now() - t0;

    // 2. ServerMessage.parseBytes
    t0 = performance.now();
    for (let i = 0; i < ITERS; i++)
      ServerMessageSchema.parseBytes(serverTurnBytes, wireCtx);
    const serverMsgParseBytesMs = performance.now() - t0;

    // 3. ClientMessage.safeParse
    t0 = performance.now();
    for (let i = 0; i < ITERS; i++) ClientMessageSchema.safeParse(clientIntent);
    const clientMsgSafeParseMs = performance.now() - t0;

    // 4. ServerMessage.safeParse
    t0 = performance.now();
    for (let i = 0; i < ITERS; i++) ServerMessageSchema.safeParse(serverTurn);
    const serverMsgSafeParseMs = performance.now() - t0;

    // 5. UserMeResponse.safeParse
    t0 = performance.now();
    for (let i = 0; i < ITERS; i++)
      UserMeResponseSchema.safeParse(userMePayload);
    const userMeSafeParseMs = performance.now() - t0;

    // 6. PlayerProfile.safeParse
    t0 = performance.now();
    for (let i = 0; i < ITERS; i++)
      PlayerProfileSchema.safeParse(playerProfilePayload);
    const profileSafeParseMs = performance.now() - t0;

    // 7. Intent.safeParse
    t0 = performance.now();
    for (let i = 0; i < ITERS; i++) IntentSchema.safeParse(intentPayload);
    const intentSafeParseMs = performance.now() - t0;

    // 8. Turn.safeParse
    t0 = performance.now();
    for (let i = 0; i < ITERS; i++) TurnSchema.safeParse(turnPayload);
    const turnSafeParseMs = performance.now() - t0;

    // 9. Versioned.safeParse
    t0 = performance.now();
    for (let i = 0; i < ITERS; i++) VersionedSchema.safeParse(versionedPayload);
    const versionedSafeParseMs = performance.now() - t0;

    console.log(
      `PERF_METRICS_JSON:${JSON.stringify({
        clientMsgParseBytesMs,
        serverMsgParseBytesMs,
        clientMsgSafeParseMs,
        serverMsgSafeParseMs,
        userMeSafeParseMs,
        profileSafeParseMs,
        intentSafeParseMs,
        turnSafeParseMs,
        versionedSafeParseMs,
      })}`,
    );
  });
});
