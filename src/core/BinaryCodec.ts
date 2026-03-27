import {
  BINARY_INTENT_DEFINITION_BY_OPCODE,
  BINARY_INTENT_DEFINITION_BY_TYPE,
  BINARY_MESSAGE_DEFINITION_BY_TYPE,
  isBinaryGameplayClientMessage,
} from "./__generated__/binary/generated";
import {
  BinaryClientGameplayMessage,
  BinaryMessageType,
  type BinaryProtocolContext,
  BinaryServerGameplayMessage,
} from "./BinaryProtocol";
import {
  assertFlags,
  binaryContextFromGameStartInfo,
  BinaryReader,
  BinaryWriter,
  decodeDefinedFields,
  encodeDefinedFields,
  encodeFlags,
  requireClientId,
  stampedIntentClientIndex,
  toUint8Array,
} from "./protocol/BinaryRuntime";
import {
  ClientHashMessage,
  ClientIntentMessage,
  ClientPingMessage,
  Intent,
  ServerDesyncMessage,
  ServerTurnMessage,
  StampedIntent,
} from "./Schemas";

const hashMessageDefinition = requiredAutoMessageDefinition("hash", "client");
const pingMessageDefinition = requiredAutoMessageDefinition("ping", "client");
const desyncMessageDefinition = requiredAutoMessageDefinition(
  "desync",
  "server",
);

function requiredAutoMessageDefinition(
  type: string,
  direction: "client" | "server",
) {
  const definition = BINARY_MESSAGE_DEFINITION_BY_TYPE.get(type);
  if (!definition) {
    throw new Error(`Missing binary message definition for ${type}`);
  }
  if (definition.direction !== direction || definition.envelope !== "auto") {
    throw new Error(`Unexpected binary message envelope for ${type}`);
  }
  return definition;
}

function encodeIntentPayload(
  writer: BinaryWriter,
  intent: Intent,
  context: BinaryProtocolContext,
) {
  const definition = BINARY_INTENT_DEFINITION_BY_TYPE.get(intent.type);
  if (!definition) {
    throw new Error(`Unsupported binary intent type: ${intent.type}`);
  }
  writer.writeUint8(definition.opcode);
  const flags = encodeFlags(
    `binary intent type ${intent.type}`,
    definition.fields,
    intent as Record<string, unknown>,
  );
  writer.writeUint16(flags);
  encodeDefinedFields(
    writer,
    definition.fields,
    intent as Record<string, unknown>,
    context,
  );
}

function decodeIntentPayload(
  reader: BinaryReader,
  context: BinaryProtocolContext,
): Intent {
  const opcode = reader.readUint8();
  const definition = BINARY_INTENT_DEFINITION_BY_OPCODE.get(opcode);
  if (!definition) {
    throw new Error(`Unknown binary intent opcode: ${opcode}`);
  }
  const flags = reader.readUint16();
  assertFlags(
    `binary intent type ${definition.type}`,
    flags,
    definition.allowedFlags,
  );
  return {
    type: definition.type,
    ...decodeDefinedFields(reader, definition.fields, flags, context),
  } as Intent;
}

function encodeAutoMessage(
  messageType: number,
  definition: typeof hashMessageDefinition,
  source: Record<string, unknown>,
  context: BinaryProtocolContext,
): Uint8Array {
  const writer = new BinaryWriter();
  return writer.writeFrame(messageType, () => {
    if (definition.allowedFlags !== 0) {
      writer.writeUint16(
        encodeFlags(definition.type, definition.fields, source),
      );
    }
    encodeDefinedFields(writer, definition.fields, source, context);
  });
}

function decodeAutoMessage<T extends { type: string }>(
  data: ArrayBuffer | Uint8Array,
  definition: typeof hashMessageDefinition,
  context: BinaryProtocolContext,
): T {
  const reader = new BinaryReader(toUint8Array(data));
  reader.readHeader(definition.messageType);
  const flags = definition.allowedFlags !== 0 ? reader.readUint16() : 0;
  assertFlags(
    `binary message type ${definition.type}`,
    flags,
    definition.allowedFlags,
  );
  const decoded = {
    type: definition.type,
    ...decodeDefinedFields(reader, definition.fields, flags, context),
  } as T;
  reader.ensureFinished();
  return decoded;
}

export {
  binaryContextFromGameStartInfo,
  isBinaryGameplayClientMessage,
  toUint8Array,
};

export function encodeBinaryClientGameplayMessage(
  message: BinaryClientGameplayMessage,
  context: BinaryProtocolContext,
): Uint8Array {
  switch (message.type) {
    case "intent":
      return encodeClientIntentMessage(message, context);
    case "hash":
      return encodeClientHashMessage(message, context);
    case "ping":
      return encodeClientPingMessage(message, context);
  }
}

export function decodeBinaryClientGameplayMessage(
  data: ArrayBuffer | Uint8Array,
  context: BinaryProtocolContext,
): ClientIntentMessage | ClientHashMessage | ClientPingMessage {
  const bytes = toUint8Array(data);
  if (bytes.byteLength < 4) {
    throw new Error("Binary frame too short");
  }
  switch (bytes[1]) {
    case BinaryMessageType.Intent:
      return decodeClientIntentMessage(bytes, context);
    case BinaryMessageType.Hash:
      return decodeClientHashMessage(bytes, context);
    case BinaryMessageType.Ping:
      return decodeClientPingMessage(bytes, context);
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
      return encodeServerDesyncMessage(message, context);
  }
}

export function decodeBinaryServerGameplayMessage(
  data: ArrayBuffer | Uint8Array,
  context: BinaryProtocolContext,
): ServerTurnMessage | ServerDesyncMessage {
  const bytes = toUint8Array(data);
  if (bytes.byteLength < 4) {
    throw new Error("Binary frame too short");
  }
  switch (bytes[1]) {
    case BinaryMessageType.Turn:
      return decodeServerTurnMessage(bytes, context);
    case BinaryMessageType.Desync:
      return decodeServerDesyncMessage(bytes, context);
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
    encodeIntentPayload(writer, message.intent, context);
  });
}

export function decodeClientIntentMessage(
  data: ArrayBuffer | Uint8Array,
  context: BinaryProtocolContext,
): ClientIntentMessage {
  const reader = new BinaryReader(toUint8Array(data));
  reader.readHeader(BinaryMessageType.Intent);
  const intent = decodeIntentPayload(reader, context);
  reader.ensureFinished();
  return {
    type: "intent",
    intent,
  };
}

export function encodeClientHashMessage(
  message: ClientHashMessage,
  context: BinaryProtocolContext,
): Uint8Array {
  return encodeAutoMessage(
    BinaryMessageType.Hash,
    hashMessageDefinition,
    message as Record<string, unknown>,
    context,
  );
}

export function decodeClientHashMessage(
  data: ArrayBuffer | Uint8Array,
  context: BinaryProtocolContext,
): ClientHashMessage {
  return decodeAutoMessage<ClientHashMessage>(
    data,
    hashMessageDefinition,
    context,
  );
}

export function encodeClientPingMessage(
  message: ClientPingMessage,
  context: BinaryProtocolContext,
): Uint8Array {
  return encodeAutoMessage(
    BinaryMessageType.Ping,
    pingMessageDefinition,
    message as Record<string, unknown>,
    context,
  );
}

export function decodeClientPingMessage(
  data: ArrayBuffer | Uint8Array,
  context: BinaryProtocolContext,
): ClientPingMessage {
  return decodeAutoMessage<ClientPingMessage>(
    data,
    pingMessageDefinition,
    context,
  );
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
      encodeIntentPayload(writer, intent, context);
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
    const intent = decodeIntentPayload(reader, context);
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
  context: BinaryProtocolContext,
): Uint8Array {
  return encodeAutoMessage(
    BinaryMessageType.Desync,
    desyncMessageDefinition,
    message as Record<string, unknown>,
    context,
  );
}

export function decodeServerDesyncMessage(
  data: ArrayBuffer | Uint8Array,
  context: BinaryProtocolContext,
): ServerDesyncMessage {
  return decodeAutoMessage<ServerDesyncMessage>(
    data,
    desyncMessageDefinition,
    context,
  );
}
