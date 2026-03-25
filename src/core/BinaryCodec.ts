import {
  BINARY_HEADER_SIZE,
  BINARY_PROTOCOL_VERSION,
  BinaryClientGameplayMessage,
  BinaryMessageType,
  BinaryProtocolContext,
  BinaryServerGameplayMessage,
  INLINE_PLAYER_ID_INDEX,
  INTENT_FLAG_OPTION_A,
  INTENT_FLAG_OPTION_B,
  createBinaryProtocolContext,
  intentTypeToOpcode,
  opcodeToIntentType,
  opcodeToUnitType,
  playerIdToIndex,
  playerIndexToId,
  requireClientId,
  stampedIntentClientIndex,
  unitTypeToOpcode,
} from "./BinaryProtocol";
import {
  ClientHashMessage,
  ClientIntentMessage,
  ClientMessage,
  ClientPingMessage,
  GameStartInfo,
  Intent,
  QuickChatKeySchema,
  ServerDesyncMessage,
  ServerTurnMessage,
  StampedIntent,
} from "./Schemas";
import { AllPlayers, UnitType } from "./game/Game";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

class BinaryWriter {
  private readonly chunks: Uint8Array[] = [];
  private totalLength = 0;

  writeUint8(value: number) {
    const chunk = new Uint8Array(1);
    chunk[0] = value;
    this.push(chunk);
  }

  writeUint16(value: number) {
    const chunk = new Uint8Array(2);
    new DataView(chunk.buffer).setUint16(0, value, true);
    this.push(chunk);
  }

  writeUint32(value: number) {
    const chunk = new Uint8Array(4);
    new DataView(chunk.buffer).setUint32(0, value, true);
    this.push(chunk);
  }

  writeInt32(value: number) {
    const chunk = new Uint8Array(4);
    new DataView(chunk.buffer).setInt32(0, value, true);
    this.push(chunk);
  }

  writeFloat64(value: number) {
    const chunk = new Uint8Array(8);
    new DataView(chunk.buffer).setFloat64(0, value, true);
    this.push(chunk);
  }

  writeBoolean(value: boolean) {
    this.writeUint8(value ? 1 : 0);
  }

  writeString(value: string) {
    const encoded = textEncoder.encode(value);
    this.writeUint16(encoded.length);
    this.push(encoded);
  }

  writeFrame(
    messageType: BinaryMessageType,
    writePayload: () => void,
  ): Uint8Array {
    this.writeUint8(BINARY_PROTOCOL_VERSION);
    this.writeUint8(messageType);
    this.writeUint16(0);
    writePayload();
    return this.finish();
  }

  finish(): Uint8Array {
    const output = new Uint8Array(this.totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }

  private push(chunk: Uint8Array) {
    this.chunks.push(chunk);
    this.totalLength += chunk.length;
  }
}

class BinaryReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  readHeader(expectedType: BinaryMessageType) {
    if (this.bytes.byteLength < BINARY_HEADER_SIZE) {
      throw new Error("Binary frame too short");
    }
    const version = this.readUint8();
    if (version !== BINARY_PROTOCOL_VERSION) {
      throw new Error(`Unsupported binary protocol version: ${version}`);
    }
    const messageType = this.readUint8();
    if (messageType !== expectedType) {
      throw new Error(
        `Unexpected binary message type: expected ${expectedType}, received ${messageType}`,
      );
    }
    const flags = this.readUint16();
    if (flags !== 0) {
      throw new Error(`Unsupported binary header flags: ${flags}`);
    }
  }

  readUint8(): number {
    this.ensureAvailable(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readUint16(): number {
    this.ensureAvailable(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readUint32(): number {
    this.ensureAvailable(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readInt32(): number {
    this.ensureAvailable(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readFloat64(): number {
    this.ensureAvailable(8);
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  readBoolean(): boolean {
    const value = this.readUint8();
    if (value !== 0 && value !== 1) {
      throw new Error(`Invalid boolean value: ${value}`);
    }
    return value === 1;
  }

  readString(): string {
    const length = this.readUint16();
    this.ensureAvailable(length);
    const value = textDecoder.decode(
      this.bytes.subarray(this.offset, this.offset + length),
    );
    this.offset += length;
    return value;
  }

  ensureFinished() {
    if (this.offset !== this.bytes.byteLength) {
      throw new Error(
        `Unexpected trailing bytes: ${this.bytes.byteLength - this.offset}`,
      );
    }
  }

  private ensureAvailable(length: number) {
    if (this.offset + length > this.bytes.byteLength) {
      throw new Error("Unexpected end of binary frame");
    }
  }
}

export function binaryContextFromGameStartInfo(
  gameStartInfo: Pick<GameStartInfo, "players">,
): BinaryProtocolContext {
  return createBinaryProtocolContext(gameStartInfo);
}

export function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  return new Uint8Array(data);
}

export function encodeBinaryClientGameplayMessage(
  message: BinaryClientGameplayMessage,
  context: BinaryProtocolContext,
): Uint8Array {
  switch (message.type) {
    case "intent":
      return encodeClientIntentMessage(message, context);
    case "hash":
      return encodeClientHashMessage(message);
    case "ping":
      return encodeClientPingMessage(message);
  }
}

export function decodeBinaryClientGameplayMessage(
  data: ArrayBuffer | Uint8Array,
  context: BinaryProtocolContext,
): ClientIntentMessage | ClientHashMessage | ClientPingMessage {
  const bytes = toUint8Array(data);
  if (bytes.byteLength < BINARY_HEADER_SIZE) {
    throw new Error("Binary frame too short");
  }

  switch (bytes[1]) {
    case BinaryMessageType.Intent:
      return decodeClientIntentMessage(bytes, context);
    case BinaryMessageType.Hash:
      return decodeClientHashMessage(bytes);
    case BinaryMessageType.Ping:
      return decodeClientPingMessage(bytes);
    default:
      throw new Error(`Unknown client binary message type: ${bytes[1]}`);
  }
}

export function encodeBinaryServerGameplayMessage(
  message: BinaryServerGameplayMessage,
  context: BinaryProtocolContext,
): Uint8Array {
  switch (message.type) {
    case "turn":
      return encodeServerTurnMessage(message, context);
    case "desync":
      return encodeServerDesyncMessage(message);
  }
}

export function decodeBinaryServerGameplayMessage(
  data: ArrayBuffer | Uint8Array,
  context: BinaryProtocolContext,
): ServerTurnMessage | ServerDesyncMessage {
  const bytes = toUint8Array(data);
  if (bytes.byteLength < BINARY_HEADER_SIZE) {
    throw new Error("Binary frame too short");
  }

  switch (bytes[1]) {
    case BinaryMessageType.Turn:
      return decodeServerTurnMessage(bytes, context);
    case BinaryMessageType.Desync:
      return decodeServerDesyncMessage(bytes);
    default:
      throw new Error(`Unknown server binary message type: ${bytes[1]}`);
  }
}

export function encodeClientIntentMessage(
  message: ClientIntentMessage,
  context: BinaryProtocolContext,
): Uint8Array {
  const writer = new BinaryWriter();
  return writer.writeFrame(BinaryMessageType.Intent, () => {
    encodeIntent(writer, message.intent, context);
  });
}

export function decodeClientIntentMessage(
  data: ArrayBuffer | Uint8Array,
  context: BinaryProtocolContext,
): ClientIntentMessage {
  const reader = new BinaryReader(toUint8Array(data));
  reader.readHeader(BinaryMessageType.Intent);
  const intent = decodeIntent(reader, context);
  reader.ensureFinished();
  return {
    type: "intent",
    intent,
  };
}

export function encodeClientHashMessage(
  message: ClientHashMessage,
): Uint8Array {
  const writer = new BinaryWriter();
  return writer.writeFrame(BinaryMessageType.Hash, () => {
    writer.writeUint32(message.turnNumber);
    writer.writeInt32(message.hash);
  });
}

export function decodeClientHashMessage(
  data: ArrayBuffer | Uint8Array,
): ClientHashMessage {
  const reader = new BinaryReader(toUint8Array(data));
  reader.readHeader(BinaryMessageType.Hash);
  const turnNumber = reader.readUint32();
  const hash = reader.readInt32();
  reader.ensureFinished();
  return {
    type: "hash",
    turnNumber,
    hash,
  };
}

export function encodeClientPingMessage(
  _message: ClientPingMessage,
): Uint8Array {
  const writer = new BinaryWriter();
  return writer.writeFrame(BinaryMessageType.Ping, () => {});
}

export function decodeClientPingMessage(
  data: ArrayBuffer | Uint8Array,
): ClientPingMessage {
  const reader = new BinaryReader(toUint8Array(data));
  reader.readHeader(BinaryMessageType.Ping);
  reader.ensureFinished();
  return { type: "ping" };
}

export function encodeServerTurnMessage(
  message: ServerTurnMessage,
  context: BinaryProtocolContext,
): Uint8Array {
  const writer = new BinaryWriter();
  return writer.writeFrame(BinaryMessageType.Turn, () => {
    writer.writeUint32(message.turn.turnNumber);
    writer.writeUint16(message.turn.intents.length);
    for (const intent of message.turn.intents) {
      writer.writeUint16(stampedIntentClientIndex(intent, context));
      encodeIntent(writer, intent, context);
    }
  });
}

export function decodeServerTurnMessage(
  data: ArrayBuffer | Uint8Array,
  context: BinaryProtocolContext,
): ServerTurnMessage {
  const reader = new BinaryReader(toUint8Array(data));
  reader.readHeader(BinaryMessageType.Turn);
  const turnNumber = reader.readUint32();
  const intentCount = reader.readUint16();
  const intents: StampedIntent[] = [];
  for (let i = 0; i < intentCount; i++) {
    const clientIndex = reader.readUint16();
    const clientID = requireClientId(clientIndex, context);
    const intent = decodeIntent(reader, context);
    intents.push({
      ...intent,
      clientID,
    } as StampedIntent);
  }
  reader.ensureFinished();
  return {
    type: "turn",
    turn: {
      turnNumber,
      intents,
    },
  };
}

export function encodeServerDesyncMessage(
  message: ServerDesyncMessage,
): Uint8Array {
  const writer = new BinaryWriter();
  return writer.writeFrame(BinaryMessageType.Desync, () => {
    writer.writeUint32(message.turn);
    writer.writeBoolean(message.correctHash !== null);
    if (message.correctHash !== null) {
      writer.writeInt32(message.correctHash);
    }
    writer.writeUint16(message.clientsWithCorrectHash);
    writer.writeUint16(message.totalActiveClients);
  });
}

export function decodeServerDesyncMessage(
  data: ArrayBuffer | Uint8Array,
): ServerDesyncMessage {
  const reader = new BinaryReader(toUint8Array(data));
  reader.readHeader(BinaryMessageType.Desync);
  const turn = reader.readUint32();
  const hasCorrectHash = reader.readBoolean();
  const correctHash = hasCorrectHash ? reader.readInt32() : null;
  const clientsWithCorrectHash = reader.readUint16();
  const totalActiveClients = reader.readUint16();
  reader.ensureFinished();
  return {
    type: "desync",
    turn,
    correctHash,
    clientsWithCorrectHash,
    totalActiveClients,
  };
}

function encodeIntent(
  writer: BinaryWriter,
  intent: Intent,
  context: BinaryProtocolContext,
) {
  const intentOpcode = intentTypeToOpcode(intent.type);
  writer.writeUint8(intentOpcode);

  let flags = 0;
  switch (intent.type) {
    case "attack":
      if (intent.targetID !== null) {
        flags |= INTENT_FLAG_OPTION_A;
      }
      if (intent.troops !== null) {
        flags |= INTENT_FLAG_OPTION_B;
      }
      break;
    case "build_unit":
      if (intent.rocketDirectionUp !== undefined) {
        flags |= INTENT_FLAG_OPTION_A;
      }
      if (intent.rocketDirectionUp) {
        flags |= INTENT_FLAG_OPTION_B;
      }
      break;
    case "quick_chat":
      if (intent.target !== undefined) {
        flags |= INTENT_FLAG_OPTION_A;
      }
      break;
  }
  writer.writeUint16(flags);

  switch (intent.type) {
    case "attack":
      if (intent.targetID !== null) {
        writePlayerRef(writer, intent.targetID, context);
      }
      if (intent.troops !== null) {
        writer.writeFloat64(intent.troops);
      }
      return;
    case "cancel_attack":
      writer.writeString(intent.attackID);
      return;
    case "spawn":
      writer.writeUint32(intent.tile);
      return;
    case "mark_disconnected":
      writeRequiredPlayerRef(writer, intent.clientID, context);
      writer.writeBoolean(intent.isDisconnected);
      return;
    case "boat":
      writer.writeFloat64(intent.troops);
      writer.writeUint32(intent.dst);
      return;
    case "cancel_boat":
      writer.writeUint32(intent.unitID);
      return;
    case "allianceRequest":
      writeRequiredPlayerRef(writer, intent.recipient, context);
      return;
    case "allianceReject":
      writeRequiredPlayerRef(writer, intent.requestor, context);
      return;
    case "breakAlliance":
      writeRequiredPlayerRef(writer, intent.recipient, context);
      return;
    case "targetPlayer":
      writeRequiredPlayerRef(writer, intent.target, context);
      return;
    case "emoji":
      writePlayerRef(writer, intent.recipient, context);
      writer.writeUint16(intent.emoji);
      return;
    case "donate_gold":
      writeRequiredPlayerRef(writer, intent.recipient, context);
      if (intent.gold === null) {
        writer.writeBoolean(false);
      } else {
        writer.writeBoolean(true);
        writer.writeFloat64(intent.gold);
      }
      return;
    case "donate_troops":
      writeRequiredPlayerRef(writer, intent.recipient, context);
      if (intent.troops === null) {
        writer.writeBoolean(false);
      } else {
        writer.writeBoolean(true);
        writer.writeFloat64(intent.troops);
      }
      return;
    case "build_unit":
      writer.writeUint8(unitTypeToOpcode(intent.unit));
      writer.writeUint32(intent.tile);
      return;
    case "upgrade_structure":
      writer.writeUint8(unitTypeToOpcode(intent.unit));
      writer.writeUint32(intent.unitId);
      return;
    case "embargo":
      writeRequiredPlayerRef(writer, intent.targetID, context);
      writer.writeBoolean(intent.action === "start");
      return;
    case "embargo_all":
      writer.writeBoolean(intent.action === "start");
      return;
    case "move_warship":
      writer.writeUint32(intent.unitId);
      writer.writeUint32(intent.tile);
      return;
    case "quick_chat":
      writeRequiredPlayerRef(writer, intent.recipient, context);
      writer.writeString(intent.quickChatKey);
      if (intent.target !== undefined) {
        writeRequiredPlayerRef(writer, intent.target, context);
      }
      return;
    case "allianceExtension":
      writeRequiredPlayerRef(writer, intent.recipient, context);
      return;
    case "delete_unit":
      writer.writeUint32(intent.unitId);
      return;
    case "toggle_pause":
      writer.writeBoolean(intent.paused);
      return;
    case "kick_player":
    case "update_game_config":
      throw new Error(`Unsupported binary intent type: ${intent.type}`);
  }
}

function decodeIntent(
  reader: BinaryReader,
  context: BinaryProtocolContext,
): Intent {
  const intentType = opcodeToIntentType(reader.readUint8());
  const flags = reader.readUint16();

  switch (intentType) {
    case "attack": {
      assertIntentFlags(
        intentType,
        flags,
        INTENT_FLAG_OPTION_A | INTENT_FLAG_OPTION_B,
      );
      const hasTarget = (flags & INTENT_FLAG_OPTION_A) !== 0;
      const hasTroops = (flags & INTENT_FLAG_OPTION_B) !== 0;
      return {
        type: "attack",
        targetID: hasTarget ? readRequiredPlayerRef(reader, context) : null,
        troops: hasTroops ? reader.readFloat64() : null,
      };
    }
    case "cancel_attack":
      assertIntentFlags(intentType, flags, 0);
      return {
        type: "cancel_attack",
        attackID: reader.readString(),
      };
    case "spawn":
      assertIntentFlags(intentType, flags, 0);
      return {
        type: "spawn",
        tile: reader.readUint32(),
      };
    case "mark_disconnected":
      assertIntentFlags(intentType, flags, 0);
      return {
        type: "mark_disconnected",
        clientID: readRequiredPlayerRef(reader, context),
        isDisconnected: reader.readBoolean(),
      };
    case "boat":
      assertIntentFlags(intentType, flags, 0);
      return {
        type: "boat",
        troops: reader.readFloat64(),
        dst: reader.readUint32(),
      };
    case "cancel_boat":
      assertIntentFlags(intentType, flags, 0);
      return {
        type: "cancel_boat",
        unitID: reader.readUint32(),
      };
    case "allianceRequest":
      assertIntentFlags(intentType, flags, 0);
      return {
        type: "allianceRequest",
        recipient: readRequiredPlayerRef(reader, context),
      };
    case "allianceReject":
      assertIntentFlags(intentType, flags, 0);
      return {
        type: "allianceReject",
        requestor: readRequiredPlayerRef(reader, context),
      };
    case "breakAlliance":
      assertIntentFlags(intentType, flags, 0);
      return {
        type: "breakAlliance",
        recipient: readRequiredPlayerRef(reader, context),
      };
    case "targetPlayer":
      assertIntentFlags(intentType, flags, 0);
      return {
        type: "targetPlayer",
        target: readRequiredPlayerRef(reader, context),
      };
    case "emoji": {
      assertIntentFlags(intentType, flags, 0);
      const recipient = readPlayerRef(reader, context);
      if (recipient === null) {
        throw new Error("Emoji recipient cannot be null");
      }
      return {
        type: "emoji",
        recipient,
        emoji: reader.readUint16(),
      };
    }
    case "donate_gold": {
      assertIntentFlags(intentType, flags, 0);
      const recipient = readRequiredPlayerRef(reader, context);
      const hasGold = reader.readBoolean();
      return {
        type: "donate_gold",
        recipient,
        gold: hasGold ? reader.readFloat64() : null,
      };
    }
    case "donate_troops": {
      assertIntentFlags(intentType, flags, 0);
      const recipient = readRequiredPlayerRef(reader, context);
      const hasTroops = reader.readBoolean();
      return {
        type: "donate_troops",
        recipient,
        troops: hasTroops ? reader.readFloat64() : null,
      };
    }
    case "build_unit": {
      assertIntentFlags(
        intentType,
        flags,
        INTENT_FLAG_OPTION_A | INTENT_FLAG_OPTION_B,
      );
      const unit = decodeUnit(reader.readUint8());
      const tile = reader.readUint32();
      const hasRocketDirection = (flags & INTENT_FLAG_OPTION_A) !== 0;
      const rocketDirectionUp =
        hasRocketDirection && (flags & INTENT_FLAG_OPTION_B) !== 0;
      return {
        type: "build_unit",
        unit,
        tile,
        rocketDirectionUp: hasRocketDirection ? rocketDirectionUp : undefined,
      };
    }
    case "upgrade_structure":
      assertIntentFlags(intentType, flags, 0);
      return {
        type: "upgrade_structure",
        unit: decodeUnit(reader.readUint8()),
        unitId: reader.readUint32(),
      };
    case "embargo":
      assertIntentFlags(intentType, flags, 0);
      return {
        type: "embargo",
        targetID: readRequiredPlayerRef(reader, context),
        action: reader.readBoolean() ? "start" : "stop",
      };
    case "embargo_all":
      assertIntentFlags(intentType, flags, 0);
      return {
        type: "embargo_all",
        action: reader.readBoolean() ? "start" : "stop",
      };
    case "move_warship":
      assertIntentFlags(intentType, flags, 0);
      return {
        type: "move_warship",
        unitId: reader.readUint32(),
        tile: reader.readUint32(),
      };
    case "quick_chat": {
      assertIntentFlags(intentType, flags, INTENT_FLAG_OPTION_A);
      const recipient = readRequiredPlayerRef(reader, context);
      const quickChatKey = reader.readString();
      const target =
        (flags & INTENT_FLAG_OPTION_A) !== 0
          ? readRequiredPlayerRef(reader, context)
          : undefined;
      if (!QuickChatKeySchema.safeParse(quickChatKey).success) {
        throw new Error(`Invalid quick chat key: ${quickChatKey}`);
      }
      return {
        type: "quick_chat",
        recipient,
        quickChatKey,
        target,
      };
    }
    case "allianceExtension":
      assertIntentFlags(intentType, flags, 0);
      return {
        type: "allianceExtension",
        recipient: readRequiredPlayerRef(reader, context),
      };
    case "delete_unit":
      assertIntentFlags(intentType, flags, 0);
      return {
        type: "delete_unit",
        unitId: reader.readUint32(),
      };
    case "toggle_pause":
      assertIntentFlags(intentType, flags, 0);
      return {
        type: "toggle_pause",
        paused: reader.readBoolean(),
      };
  }

  throw new Error(`Unhandled binary intent type: ${intentType}`);
}

function decodeUnit(opcode: number): UnitType {
  return opcodeToUnitType(opcode);
}

function assertIntentFlags(
  intentType: Intent["type"],
  flags: number,
  allowedFlags: number,
) {
  const invalidFlags = flags & ~allowedFlags;
  if (invalidFlags !== 0) {
    throw new Error(
      `Unsupported flags ${invalidFlags} for binary intent type ${intentType}`,
    );
  }
}

function writePlayerRef(
  writer: BinaryWriter,
  playerId: string | null | typeof AllPlayers,
  context: BinaryProtocolContext,
) {
  if (playerId === null || playerId === AllPlayers) {
    writer.writeUint16(playerIdToIndex(playerId, context));
    return;
  }
  const mappedIndex = context.playerIdToIndex.get(playerId);
  if (mappedIndex !== undefined) {
    writer.writeUint16(mappedIndex);
    return;
  }
  writer.writeUint16(INLINE_PLAYER_ID_INDEX);
  writer.writeString(playerId);
}

function writeRequiredPlayerRef(
  writer: BinaryWriter,
  playerId: string,
  context: BinaryProtocolContext,
) {
  writePlayerRef(writer, playerId, context);
}

function readPlayerRef(
  reader: BinaryReader,
  context: BinaryProtocolContext,
): string | null | typeof AllPlayers {
  const playerIndex = reader.readUint16();
  if (playerIndex === INLINE_PLAYER_ID_INDEX) {
    return reader.readString();
  }
  return playerIndexToId(playerIndex, context);
}

function readRequiredPlayerRef(
  reader: BinaryReader,
  context: BinaryProtocolContext,
): string {
  const playerId = readPlayerRef(reader, context);
  if (playerId === null || playerId === AllPlayers) {
    throw new Error(`Expected player ID, received ${String(playerId)}`);
  }
  return playerId;
}

export function isBinaryGameplayClientMessage(
  message: ClientMessage,
): message is BinaryClientGameplayMessage {
  return (
    message.type === "intent" ||
    message.type === "hash" ||
    message.type === "ping"
  );
}
