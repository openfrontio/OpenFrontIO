import {
  BINARY_MESSAGE_DEFINITION_BY_MESSAGE_TYPE,
  BINARY_MESSAGE_DEFINITION_BY_TYPE,
} from "./__generated__/binary/generated";
import {
  BinaryClientGameplayMessage,
  BinaryServerGameplayMessage,
  type BinaryProtocolContext,
} from "./BinaryProtocol";
import {
  binaryContextFromGameStartInfo,
  BinaryReader,
  BinaryWriter,
  canEncodeBinaryValue,
  decodeBinaryValue,
  encodeBinaryValue,
  toUint8Array,
  type BinaryMessageDefinition,
} from "./protocol/BinaryRuntime";
import { ClientMessage, ClientMessageSchema } from "./Schemas";

type BinaryWireMessage = Record<string, unknown> & { type: string };

function isBinaryRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireBinaryMessageDefinitionByType(
  type: string,
  direction: "client" | "server",
): BinaryMessageDefinition {
  const definition = BINARY_MESSAGE_DEFINITION_BY_TYPE.get(type);
  if (!definition) {
    throw new Error(`Missing binary message definition for ${type}`);
  }
  if (definition.direction !== direction) {
    throw new Error(`Unexpected ${direction} binary message type: ${type}`);
  }
  return definition;
}

function requireBinaryMessageDefinitionByMessageType(
  messageType: number,
  direction: "client" | "server",
): BinaryMessageDefinition {
  const definition = BINARY_MESSAGE_DEFINITION_BY_MESSAGE_TYPE.get(messageType);
  if (!definition) {
    throw new Error(`Unknown ${direction} binary message type: ${messageType}`);
  }
  if (definition.direction !== direction) {
    throw new Error(
      `Unexpected ${direction} binary message type: ${definition.type}`,
    );
  }
  return definition;
}

function encodeBinaryMessageWithDefinition(
  message: BinaryWireMessage,
  definition: BinaryMessageDefinition,
  context: BinaryProtocolContext,
): Uint8Array {
  const writer = new BinaryWriter();
  return writer.writeFrame(definition.messageType, () => {
    encodeBinaryValue(
      writer,
      definition.payload,
      message,
      context,
      `binary message type ${definition.type}`,
    );
  });
}

function decodeBinaryMessageWithDefinition(
  reader: BinaryReader,
  definition: BinaryMessageDefinition,
  context: BinaryProtocolContext,
): BinaryWireMessage {
  const decoded = decodeBinaryValue(
    reader,
    definition.payload,
    context,
    `binary message type ${definition.type}`,
  );
  if (!isBinaryRecord(decoded)) {
    throw new Error(
      `Expected object payload for binary message type ${definition.type}`,
    );
  }
  return {
    type: definition.type,
    ...decoded,
  };
}

function parseDecodedClientBinaryMessage(
  decoded: BinaryWireMessage,
): BinaryClientGameplayMessage {
  // Client decode is the semantic validation boundary: after wire decoding
  // succeeds, validate the full client message exactly once here.
  return ClientMessageSchema.parse(decoded) as BinaryClientGameplayMessage;
}

function finalizeDecodedServerBinaryMessage(
  decoded: BinaryWireMessage,
): BinaryServerGameplayMessage {
  // Server decode intentionally stops at wire validation so replay/debug tooling can
  // inspect messages that are structurally valid on the wire but fail semantic parse.
  return decoded as BinaryServerGameplayMessage;
}

export { binaryContextFromGameStartInfo, toUint8Array };

export function isBinaryGameplayClientMessage(
  message: ClientMessage,
): message is BinaryClientGameplayMessage {
  const definition = BINARY_MESSAGE_DEFINITION_BY_TYPE.get(message.type);
  if (!definition || definition.direction !== "client") {
    return false;
  }
  return canEncodeBinaryValue(definition.payload, message);
}

export function encodeBinaryClientGameplayMessage(
  message: BinaryClientGameplayMessage,
  context: BinaryProtocolContext,
): Uint8Array {
  const definition = requireBinaryMessageDefinitionByType(
    message.type,
    "client",
  );
  return encodeBinaryMessageWithDefinition(message, definition, context);
}

export function decodeBinaryClientGameplayMessage(
  data: ArrayBuffer | Uint8Array,
  context: BinaryProtocolContext,
): BinaryClientGameplayMessage {
  const reader = new BinaryReader(toUint8Array(data));
  const { messageType } = reader.readFrameHeader();
  const definition = requireBinaryMessageDefinitionByMessageType(
    messageType,
    "client",
  );
  const decoded = decodeBinaryMessageWithDefinition(
    reader,
    definition,
    context,
  );
  reader.ensureFinished();
  return parseDecodedClientBinaryMessage(decoded);
}

export function encodeBinaryServerGameplayMessage(
  message: BinaryServerGameplayMessage,
  context: BinaryProtocolContext,
): Uint8Array {
  const definition = requireBinaryMessageDefinitionByType(
    message.type,
    "server",
  );
  return encodeBinaryMessageWithDefinition(message, definition, context);
}

export function decodeBinaryServerGameplayMessage(
  data: ArrayBuffer | Uint8Array,
  context: BinaryProtocolContext,
): BinaryServerGameplayMessage {
  const reader = new BinaryReader(toUint8Array(data));
  const { messageType } = reader.readFrameHeader();
  const definition = requireBinaryMessageDefinitionByMessageType(
    messageType,
    "server",
  );
  const decoded = decodeBinaryMessageWithDefinition(
    reader,
    definition,
    context,
  );
  reader.ensureFinished();
  return finalizeDecodedServerBinaryMessage(decoded);
}
