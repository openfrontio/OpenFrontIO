import { ClientID, GameStartInfo, StampedIntent } from "../Schemas";
import { AllPlayers } from "../game/Game";

export const BINARY_PROTOCOL_VERSION = 1;
export const BINARY_HEADER_SIZE = 4;

export const NO_PLAYER_INDEX = 0xffff;
export const ALL_PLAYERS_INDEX = 0xfffe;
export const INLINE_PLAYER_ID_INDEX = 0xfffd;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type BinaryScalarWireType =
  | "bool"
  | "f64"
  | "string"
  | "u8"
  | "u16"
  | "u32"
  | "i32"
  | "enum"
  | "playerRef";

export interface BinaryFieldDefinition {
  readonly name: string;
  readonly wireType: BinaryScalarWireType;
  readonly optional?: boolean;
  readonly nullable?: boolean;
  readonly omit?: boolean;
  readonly presenceBit?: number;
  readonly valueBit?: number;
  readonly enumValues?: readonly (string | number)[];
  readonly enumWireType?: "u8" | "u16" | "u32";
  readonly allowAllPlayers?: boolean;
  readonly inlineFallback?: boolean;
}

export interface BinaryIntentDefinition {
  readonly type: string;
  readonly opcode: number;
  readonly fields: readonly BinaryFieldDefinition[];
  readonly allowedFlags: number;
}

export interface BinaryMessageDefinition {
  readonly type: string;
  readonly messageType: number;
  readonly direction: "client" | "server";
  readonly envelope: "auto" | "intent" | "packedTurn";
  readonly fields: readonly BinaryFieldDefinition[];
  readonly allowedFlags: number;
}

export interface BinaryProtocolContext {
  readonly playerIds: readonly ClientID[];
  readonly playerIdToIndex: ReadonlyMap<ClientID, number>;
}

export interface BinaryFrameHeader {
  readonly messageType: number;
  readonly flags: number;
}

export function createBinaryProtocolContext(
  gameStartInfo: Pick<GameStartInfo, "players">,
): BinaryProtocolContext {
  const playerIds = gameStartInfo.players.map((player) => player.clientID);
  const playerIdToIndex = new Map<ClientID, number>();
  playerIds.forEach((clientID, index) => {
    playerIdToIndex.set(clientID, index);
  });
  return {
    playerIds,
    playerIdToIndex,
  };
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

export class BinaryWriter {
  private buffer = new ArrayBuffer(128);
  private bytes = new Uint8Array(this.buffer);
  private view = new DataView(this.buffer);
  private length = 0;

  writeUint8(value: number) {
    this.ensureCapacity(1);
    this.view.setUint8(this.length, value);
    this.length += 1;
  }

  writeUint16(value: number) {
    this.ensureCapacity(2);
    this.view.setUint16(this.length, value, true);
    this.length += 2;
  }

  writeUint32(value: number) {
    this.ensureCapacity(4);
    this.view.setUint32(this.length, value, true);
    this.length += 4;
  }

  writeInt32(value: number) {
    this.ensureCapacity(4);
    this.view.setInt32(this.length, value, true);
    this.length += 4;
  }

  writeFloat64(value: number) {
    this.ensureCapacity(8);
    this.view.setFloat64(this.length, value, true);
    this.length += 8;
  }

  writeBoolean(value: boolean) {
    this.writeUint8(value ? 1 : 0);
  }

  writeString(value: string) {
    const encoded = textEncoder.encode(value);
    if (encoded.length > 0xffff) {
      throw new RangeError(
        `Binary string too long: ${encoded.length} bytes exceeds 65535`,
      );
    }
    this.ensureCapacity(2 + encoded.length);
    this.view.setUint16(this.length, encoded.length, true);
    this.length += 2;
    this.bytes.set(encoded, this.length);
    this.length += encoded.length;
  }

  writeFrame(messageType: number, writePayload: () => void): Uint8Array {
    this.writeUint8(BINARY_PROTOCOL_VERSION);
    this.writeUint8(messageType);
    this.writeUint16(0);
    writePayload();
    return this.finish();
  }

  finish(): Uint8Array {
    return this.bytes.subarray(0, this.length);
  }

  private ensureCapacity(additionalBytes: number) {
    const requiredLength = this.length + additionalBytes;
    if (requiredLength <= this.bytes.byteLength) {
      return;
    }

    let nextCapacity = this.bytes.byteLength;
    while (nextCapacity < requiredLength) {
      nextCapacity *= 2;
    }

    const nextBytes = new Uint8Array(nextCapacity);
    nextBytes.set(this.bytes.subarray(0, this.length));
    this.buffer = nextBytes.buffer;
    this.bytes = nextBytes;
    this.view = new DataView(this.buffer);
  }
}

export class BinaryReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  readFrameHeader(): BinaryFrameHeader {
    if (this.bytes.byteLength < BINARY_HEADER_SIZE) {
      throw new Error("Binary frame too short");
    }
    const version = this.readUint8();
    if (version !== BINARY_PROTOCOL_VERSION) {
      throw new Error(`Unsupported binary protocol version: ${version}`);
    }
    const messageType = this.readUint8();
    const flags = this.readUint16();
    if (flags !== 0) {
      throw new Error(`Unsupported binary header flags: ${flags}`);
    }
    return { messageType, flags };
  }

  readHeader(expectedType: number) {
    const { messageType } = this.readFrameHeader();
    if (messageType !== expectedType) {
      throw new Error(
        `Unexpected binary message type: expected ${expectedType}, received ${messageType}`,
      );
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

function writeScalar(
  writer: BinaryWriter,
  definition: BinaryFieldDefinition,
  value: unknown,
  context: BinaryProtocolContext,
) {
  switch (definition.wireType) {
    case "bool":
      writer.writeBoolean(value as boolean);
      return;
    case "f64":
      writer.writeFloat64(value as number);
      return;
    case "string":
      writer.writeString(value as string);
      return;
    case "u8":
      writer.writeUint8(value as number);
      return;
    case "u16":
      writer.writeUint16(value as number);
      return;
    case "u32":
      writer.writeUint32(value as number);
      return;
    case "i32":
      writer.writeInt32(value as number);
      return;
    case "enum": {
      const enumValues = definition.enumValues;
      if (!enumValues) {
        throw new Error(`Enum values missing for field ${definition.name}`);
      }
      const enumIndex = enumValues.indexOf(value as string | number);
      if (enumIndex === -1) {
        throw new Error(
          `Unknown enum value ${String(value)} for field ${definition.name}`,
        );
      }
      writeOrdinal(
        writer,
        definition.enumWireType ?? "u8",
        enumIndex + 1,
        definition.name,
      );
      return;
    }
    case "playerRef":
      if (value === null && !definition.nullable) {
        throw new Error(`Field ${definition.name} cannot be null`);
      }
      if (value === AllPlayers && !definition.allowAllPlayers) {
        throw new Error(`Field ${definition.name} cannot target AllPlayers`);
      }
      writePlayerRef(
        writer,
        value as string | null | typeof AllPlayers,
        context,
        definition.inlineFallback ?? false,
      );
      return;
  }
}

function readScalar(
  reader: BinaryReader,
  definition: BinaryFieldDefinition,
  context: BinaryProtocolContext,
): unknown {
  switch (definition.wireType) {
    case "bool":
      return reader.readBoolean();
    case "f64":
      return reader.readFloat64();
    case "string":
      return reader.readString();
    case "u8":
      return reader.readUint8();
    case "u16":
      return reader.readUint16();
    case "u32":
      return reader.readUint32();
    case "i32":
      return reader.readInt32();
    case "enum": {
      const enumValues = definition.enumValues;
      if (!enumValues) {
        throw new Error(`Enum values missing for field ${definition.name}`);
      }
      const ordinal = readOrdinal(
        reader,
        definition.enumWireType ?? "u8",
        definition.name,
      );
      const value = enumValues[ordinal - 1];
      if (value === undefined) {
        throw new Error(
          `Invalid enum ordinal ${ordinal} for field ${definition.name}`,
        );
      }
      return value;
    }
    case "playerRef": {
      const playerId = readPlayerRef(reader, context);
      if (playerId === null && !definition.nullable) {
        throw new Error(`Field ${definition.name} cannot be null`);
      }
      if (playerId === AllPlayers && !definition.allowAllPlayers) {
        throw new Error(`Field ${definition.name} cannot target AllPlayers`);
      }
      return playerId;
    }
  }
}

function writeOrdinal(
  writer: BinaryWriter,
  wireType: "u8" | "u16" | "u32",
  value: number,
  fieldName: string,
) {
  if (value <= 0) {
    throw new Error(`Invalid ordinal ${value} for field ${fieldName}`);
  }
  switch (wireType) {
    case "u8":
      writer.writeUint8(value);
      return;
    case "u16":
      writer.writeUint16(value);
      return;
    case "u32":
      writer.writeUint32(value);
      return;
  }
}

function readOrdinal(
  reader: BinaryReader,
  wireType: "u8" | "u16" | "u32",
  fieldName: string,
): number {
  const ordinal =
    wireType === "u8"
      ? reader.readUint8()
      : wireType === "u16"
        ? reader.readUint16()
        : reader.readUint32();
  if (ordinal <= 0) {
    throw new Error(`Invalid ordinal ${ordinal} for field ${fieldName}`);
  }
  return ordinal;
}

export function encodeFlags(
  definitionName: string,
  fields: readonly BinaryFieldDefinition[],
  source: Record<string, unknown>,
): number {
  let flags = 0;
  for (const field of fields) {
    if (field.omit) {
      continue;
    }
    const value = source[field.name];
    if (field.optional && field.wireType === "bool") {
      if (value !== undefined) {
        if (field.presenceBit === undefined || field.valueBit === undefined) {
          throw new Error(`Boolean flag bits missing for ${definitionName}`);
        }
        flags |= 1 << field.presenceBit;
        if (value) {
          flags |= 1 << field.valueBit;
        }
      }
      continue;
    }
    if (field.optional) {
      if (value !== undefined) {
        if (field.presenceBit === undefined) {
          throw new Error(`Presence bit missing for ${definitionName}`);
        }
        flags |= 1 << field.presenceBit;
      }
      continue;
    }
    if (field.nullable) {
      if (value !== null) {
        if (field.presenceBit === undefined) {
          throw new Error(`Presence bit missing for ${definitionName}`);
        }
        flags |= 1 << field.presenceBit;
      }
    }
  }
  return flags;
}

export function encodeDefinedFields(
  writer: BinaryWriter,
  fields: readonly BinaryFieldDefinition[],
  source: Record<string, unknown>,
  context: BinaryProtocolContext,
) {
  for (const field of fields) {
    if (field.omit) {
      continue;
    }
    const value = source[field.name];
    if (field.optional && field.wireType === "bool") {
      continue;
    }
    if (field.optional) {
      if (value !== undefined) {
        writeScalar(writer, field, value, context);
      }
      continue;
    }
    if (field.nullable) {
      if (value !== null) {
        writeScalar(writer, field, value, context);
      }
      continue;
    }
    writeScalar(writer, field, value, context);
  }
}

export function decodeDefinedFields(
  reader: BinaryReader,
  fields: readonly BinaryFieldDefinition[],
  flags: number,
  context: BinaryProtocolContext,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.omit) {
      continue;
    }
    if (field.optional && field.wireType === "bool") {
      if (field.presenceBit === undefined || field.valueBit === undefined) {
        throw new Error(`Boolean flag bits missing for ${field.name}`);
      }
      output[field.name] =
        (flags & (1 << field.presenceBit)) !== 0
          ? (flags & (1 << field.valueBit)) !== 0
          : undefined;
      continue;
    }
    if (field.optional) {
      if (field.presenceBit === undefined) {
        throw new Error(`Presence bit missing for ${field.name}`);
      }
      output[field.name] =
        (flags & (1 << field.presenceBit)) !== 0
          ? readScalar(reader, field, context)
          : undefined;
      continue;
    }
    if (field.nullable) {
      if (field.presenceBit === undefined) {
        throw new Error(`Presence bit missing for ${field.name}`);
      }
      output[field.name] =
        (flags & (1 << field.presenceBit)) !== 0
          ? readScalar(reader, field, context)
          : null;
      continue;
    }
    output[field.name] = readScalar(reader, field, context);
  }
  return output;
}

export function encodeAutoEnvelope(
  definition: BinaryMessageDefinition,
  source: Record<string, unknown>,
  context: BinaryProtocolContext,
): Uint8Array {
  const writer = new BinaryWriter();
  return writer.writeFrame(definition.messageType, () => {
    if (definition.allowedFlags !== 0) {
      writer.writeUint16(
        encodeFlags(definition.type, definition.fields, source),
      );
    }
    encodeDefinedFields(writer, definition.fields, source, context);
  });
}

export function decodeAutoEnvelope(
  reader: BinaryReader,
  definition: BinaryMessageDefinition,
  context: BinaryProtocolContext,
): Record<string, unknown> & { type: string } {
  const flags = definition.allowedFlags !== 0 ? reader.readUint16() : 0;
  assertFlags(
    `binary message type ${definition.type}`,
    flags,
    definition.allowedFlags,
  );
  return {
    type: definition.type,
    ...decodeDefinedFields(reader, definition.fields, flags, context),
  };
}

export function playerIndexToId(
  playerIndex: number,
  context: BinaryProtocolContext,
): ClientID | null | typeof AllPlayers {
  if (playerIndex === NO_PLAYER_INDEX) {
    return null;
  }
  if (playerIndex === ALL_PLAYERS_INDEX) {
    return AllPlayers;
  }
  const playerId = context.playerIds[playerIndex];
  if (playerId === undefined) {
    throw new Error(`Invalid player index: ${playerIndex}`);
  }
  return playerId;
}

export function requireClientId(
  playerIndex: number,
  context: BinaryProtocolContext,
): ClientID {
  const playerId = playerIndexToId(playerIndex, context);
  if (playerId === null || playerId === AllPlayers) {
    throw new Error(`Expected client player index, received ${playerIndex}`);
  }
  return playerId;
}

export function stampedIntentClientIndex(
  intent: Pick<StampedIntent, "clientID">,
  context: BinaryProtocolContext,
): number {
  const index = context.playerIdToIndex.get(intent.clientID);
  if (index === undefined) {
    throw new Error(`Unknown stamped client ID: ${intent.clientID}`);
  }
  return index;
}

export function writePlayerRef(
  writer: BinaryWriter,
  playerId: string | null | typeof AllPlayers,
  context: BinaryProtocolContext,
  inlineFallback = false,
) {
  if (playerId === null) {
    writer.writeUint16(NO_PLAYER_INDEX);
    return;
  }
  if (playerId === AllPlayers) {
    writer.writeUint16(ALL_PLAYERS_INDEX);
    return;
  }
  const mappedIndex = context.playerIdToIndex.get(playerId);
  if (mappedIndex !== undefined) {
    writer.writeUint16(mappedIndex);
    return;
  }
  if (!inlineFallback) {
    throw new Error(`Unknown player ID: ${playerId}`);
  }
  writer.writeUint16(INLINE_PLAYER_ID_INDEX);
  writer.writeString(playerId);
}

export function readPlayerRef(
  reader: BinaryReader,
  context: BinaryProtocolContext,
): string | null | typeof AllPlayers {
  const playerIndex = reader.readUint16();
  if (playerIndex === INLINE_PLAYER_ID_INDEX) {
    return reader.readString();
  }
  return playerIndexToId(playerIndex, context);
}

export function readRequiredPlayerRef(
  reader: BinaryReader,
  context: BinaryProtocolContext,
): string {
  const playerId = readPlayerRef(reader, context);
  if (playerId === null || playerId === AllPlayers) {
    throw new Error(`Expected player ID, received ${String(playerId)}`);
  }
  return playerId;
}

export function assertFlags(name: string, flags: number, allowedFlags: number) {
  const invalidFlags = flags & ~allowedFlags;
  if (invalidFlags !== 0) {
    throw new Error(`Unsupported flags ${invalidFlags} for ${name}`);
  }
}
