import { describe, expect, it } from "vitest";
import {
  binaryContextFromGameStartInfo,
  decodeBinaryClientGameplayMessage,
  decodeBinaryServerGameplayMessage,
  encodeBinaryClientGameplayMessage,
  encodeBinaryServerGameplayMessage,
  isBinaryGameplayClientMessage,
} from "../../src/core/BinaryCodec";
import { BINARY_PROTOCOL_VERSION } from "../../src/core/BinaryProtocol";
import {
  ClientHashMessage,
  ClientHashSchema,
  ClientIntentMessage,
  ClientIntentMessageSchema,
  ClientPingMessage,
  ClientPingMessageSchema,
  QuickChatKeySchema,
  ServerDesyncMessage,
  ServerDesyncSchema,
  ServerTurnMessage,
  ServerTurnMessageSchema,
} from "../../src/core/Schemas";
import { AllPlayers, UnitType } from "../../src/core/game/Game";

const quickChatKey = QuickChatKeySchema.options[0];

const context = binaryContextFromGameStartInfo({
  players: [
    { clientID: "P0000001" },
    { clientID: "P0000002" },
    { clientID: "P0000003" },
  ],
} as any);

const clientIntentMessages: ClientIntentMessage[] = [
  {
    type: "intent",
    intent: {
      type: "attack",
      targetID: "P0000002",
      troops: 12.5,
    },
  },
  {
    type: "intent",
    intent: {
      type: "attack",
      targetID: "kli0dx59",
      troops: 18,
    },
  },
  {
    type: "intent",
    intent: {
      type: "attack",
      targetID: null,
      troops: null,
    },
  },
  {
    type: "intent",
    intent: {
      type: "cancel_attack",
      attackID: "attack-123",
    },
  },
  {
    type: "intent",
    intent: {
      type: "spawn",
      tile: 42,
    },
  },
  {
    type: "intent",
    intent: {
      type: "mark_disconnected",
      clientID: "P0000002",
      isDisconnected: true,
    },
  },
  {
    type: "intent",
    intent: {
      type: "boat",
      troops: 99,
      dst: 123,
    },
  },
  {
    type: "intent",
    intent: {
      type: "cancel_boat",
      unitID: 77,
    },
  },
  {
    type: "intent",
    intent: {
      type: "allianceRequest",
      recipient: "P0000002",
    },
  },
  {
    type: "intent",
    intent: {
      type: "allianceReject",
      requestor: "P0000002",
    },
  },
  {
    type: "intent",
    intent: {
      type: "breakAlliance",
      recipient: "P0000002",
    },
  },
  {
    type: "intent",
    intent: {
      type: "targetPlayer",
      target: "P0000002",
    },
  },
  {
    type: "intent",
    intent: {
      type: "emoji",
      recipient: "P0000002",
      emoji: 3,
    },
  },
  {
    type: "intent",
    intent: {
      type: "emoji",
      recipient: AllPlayers,
      emoji: 4,
    },
  },
  {
    type: "intent",
    intent: {
      type: "donate_gold",
      recipient: "P0000002",
      gold: 250,
    },
  },
  {
    type: "intent",
    intent: {
      type: "donate_gold",
      recipient: "P0000002",
      gold: null,
    },
  },
  {
    type: "intent",
    intent: {
      type: "donate_troops",
      recipient: "P0000002",
      troops: 25,
    },
  },
  {
    type: "intent",
    intent: {
      type: "donate_troops",
      recipient: "P0000002",
      troops: null,
    },
  },
  {
    type: "intent",
    intent: {
      type: "build_unit",
      unit: UnitType.Warship,
      tile: 7,
      rocketDirectionUp: true,
    },
  },
  {
    type: "intent",
    intent: {
      type: "build_unit",
      unit: UnitType.Port,
      tile: 8,
    },
  },
  {
    type: "intent",
    intent: {
      type: "upgrade_structure",
      unit: UnitType.City,
      unitId: 9,
    },
  },
  {
    type: "intent",
    intent: {
      type: "embargo",
      targetID: "P0000002",
      action: "start",
    },
  },
  {
    type: "intent",
    intent: {
      type: "embargo_all",
      action: "stop",
    },
  },
  {
    type: "intent",
    intent: {
      type: "move_warship",
      unitId: 55,
      tile: 88,
    },
  },
  {
    type: "intent",
    intent: {
      type: "quick_chat",
      recipient: "P0000002",
      quickChatKey,
      target: "P0000003",
    },
  },
  {
    type: "intent",
    intent: {
      type: "quick_chat",
      recipient: "P0000002",
      quickChatKey,
    },
  },
  {
    type: "intent",
    intent: {
      type: "allianceExtension",
      recipient: "P0000002",
    },
  },
  {
    type: "intent",
    intent: {
      type: "delete_unit",
      unitId: 101,
    },
  },
  {
    type: "intent",
    intent: {
      type: "toggle_pause",
      paused: true,
    },
  },
  {
    type: "intent",
    intent: {
      type: "kick_player",
      target: "P0000002",
    },
  },
];

describe("BinaryCodec", () => {
  it.each(clientIntentMessages)(
    "round-trips client gameplay intent %#",
    (message) => {
      const encoded = encodeBinaryClientGameplayMessage(message, context);
      const decoded = decodeBinaryClientGameplayMessage(encoded, context);
      expect(ClientIntentMessageSchema.parse(decoded)).toEqual(message);
      expect(decoded).toEqual(message);
    },
  );

  it("round-trips hash messages", () => {
    const message: ClientHashMessage = {
      type: "hash",
      turnNumber: 12,
      hash: 34567,
    };
    const encoded = encodeBinaryClientGameplayMessage(message, context);
    const decoded = decodeBinaryClientGameplayMessage(encoded, context);
    expect(ClientHashSchema.parse(decoded)).toEqual(message);
    expect(decoded).toEqual(message);
  });

  it("round-trips ping messages", () => {
    const message: ClientPingMessage = {
      type: "ping",
    };
    const encoded = encodeBinaryClientGameplayMessage(message, context);
    const decoded = decodeBinaryClientGameplayMessage(encoded, context);
    expect(ClientPingMessageSchema.parse(decoded)).toEqual(message);
    expect(decoded).toEqual(message);
  });

  it("only classifies supported intents as binary gameplay messages", () => {
    expect(
      isBinaryGameplayClientMessage({
        type: "intent",
        intent: {
          type: "kick_player",
          target: "P0000002",
        },
      } as ClientIntentMessage),
    ).toBe(true);

    expect(
      isBinaryGameplayClientMessage({
        type: "intent",
        intent: {
          type: "update_game_config",
          config: {},
        },
      } as ClientIntentMessage),
    ).toBe(false);
  });

  it("round-trips server turn messages", () => {
    const message: ServerTurnMessage = {
      type: "turn",
      turn: {
        turnNumber: 5,
        intents: [
          {
            type: "spawn",
            tile: 10,
            clientID: "P0000001",
          },
          {
            type: "emoji",
            recipient: AllPlayers,
            emoji: 2,
            clientID: "P0000002",
          },
        ],
      },
    };
    const encoded = encodeBinaryServerGameplayMessage(message, context);
    const decoded = decodeBinaryServerGameplayMessage(encoded, context);
    expect(ServerTurnMessageSchema.parse(decoded)).toEqual(message);
    expect(decoded).toEqual(message);
  });

  it("round-trips server turn messages with non-lobby target ids", () => {
    const message: ServerTurnMessage = {
      type: "turn",
      turn: {
        turnNumber: 6,
        intents: [
          {
            type: "attack",
            targetID: "kli0dx59",
            troops: 9,
            clientID: "P0000001",
          },
        ],
      },
    };
    const encoded = encodeBinaryServerGameplayMessage(message, context);
    const decoded = decodeBinaryServerGameplayMessage(encoded, context);
    expect(ServerTurnMessageSchema.parse(decoded)).toEqual(message);
    expect(decoded).toEqual(message);
  });

  it("round-trips server desync messages", () => {
    const message: ServerDesyncMessage = {
      type: "desync",
      turn: 9,
      correctHash: 777,
      clientsWithCorrectHash: 3,
      totalActiveClients: 4,
    };
    const encoded = encodeBinaryServerGameplayMessage(message, context);
    const decoded = decodeBinaryServerGameplayMessage(encoded, context);
    expect(ServerDesyncSchema.parse(decoded)).toEqual(message);
    expect(decoded).toEqual(message);
  });

  it("rejects unknown protocol versions", () => {
    const encoded = encodeBinaryClientGameplayMessage(
      {
        type: "ping",
      },
      context,
    );
    encoded[0] = BINARY_PROTOCOL_VERSION + 1;
    expect(() => decodeBinaryClientGameplayMessage(encoded, context)).toThrow(
      /Unsupported binary protocol version/,
    );
  });

  it("rejects invalid player indexes", () => {
    const encoded = encodeBinaryServerGameplayMessage(
      {
        type: "turn",
        turn: {
          turnNumber: 1,
          intents: [
            {
              type: "spawn",
              tile: 3,
              clientID: "P0000001",
            },
          ],
        },
      },
      context,
    );
    encoded[10] = 99;
    expect(() => decodeBinaryServerGameplayMessage(encoded, context)).toThrow(
      /Invalid player index/,
    );
  });

  it("rejects invalid intent flags", () => {
    const encoded = encodeBinaryClientGameplayMessage(
      {
        type: "intent",
        intent: {
          type: "spawn",
          tile: 1,
        },
      },
      context,
    );
    encoded[5] = 0x04;
    expect(() => decodeBinaryClientGameplayMessage(encoded, context)).toThrow(
      /Unsupported flags/,
    );
  });

  it("rejects oversized binary strings during encoding", () => {
    expect(() =>
      encodeBinaryClientGameplayMessage(
        {
          type: "intent",
          intent: {
            type: "cancel_attack",
            attackID: "a".repeat(0x10000),
          },
        },
        context,
      ),
    ).toThrow(/Binary string too long/);
  });

  it("rejects client binary messages that violate semantic schemas", () => {
    const encoded = encodeBinaryClientGameplayMessage(
      {
        type: "intent",
        intent: {
          type: "attack",
          targetID: "bad",
          troops: 10,
        },
      } as any,
      context,
    );

    expect(() => decodeBinaryClientGameplayMessage(encoded, context)).toThrow();
  });

  it("rejects server binary messages that violate semantic schemas", () => {
    const encoded = encodeBinaryServerGameplayMessage(
      {
        type: "turn",
        turn: {
          turnNumber: 1,
          intents: [
            {
              type: "attack",
              targetID: "bad",
              troops: 3,
              clientID: "P0000001",
            },
          ],
        },
      } as any,
      context,
    );

    expect(() => decodeBinaryServerGameplayMessage(encoded, context)).toThrow();
  });

  it("rejects truncated frames", () => {
    const encoded = encodeBinaryServerGameplayMessage(
      {
        type: "desync",
        turn: 4,
        correctHash: null,
        clientsWithCorrectHash: 1,
        totalActiveClients: 2,
      },
      context,
    );
    const truncated = encoded.subarray(0, encoded.length - 1);
    expect(() => decodeBinaryServerGameplayMessage(truncated, context)).toThrow(
      /Unexpected end of binary frame/,
    );
  });
});
