import { ClientID, GameStartInfo, StampedIntent } from "../Schemas";
import { AllPlayers } from "../game/Game";

export const BINARY_PROTOCOL_VERSION = 1;

const BINARY_HEADER_SIZE = 4;
const NO_PLAYER_INDEX = 0xffff;
const ALL_PLAYERS_INDEX = 0xfffe;
const INLINE_PLAYER_ID_INDEX = 0xfffd;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface BinaryProtocolContext {
  readonly playerIds: readonly ClientID[];
  readonly playerIdToIndex: ReadonlyMap<ClientID, number>;
}

export interface BinaryFrameHeader {
  readonly messageType: number;
  readonly flags: number;
}

export function binaryContextFromGameStartInfo(
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

function playerIndexToId(
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
