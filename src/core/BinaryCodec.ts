import {
  BINARY_INTENT_DEFINITION_BY_OPCODE,
  BINARY_INTENT_DEFINITION_BY_TYPE,
  BINARY_MESSAGE_DEFINITION_BY_MESSAGE_TYPE,
  BINARY_MESSAGE_DEFINITION_BY_TYPE,
  isBinaryGameplayClientMessage,
} from "./__generated__/binary/generated";
import {
  BinaryClientGameplayMessage,
  BinaryServerGameplayMessage,
  type BinaryProtocolContext,
} from "./BinaryProtocol";
import {
  assertFlags,
  binaryContextFromGameStartInfo,
  BinaryReader,
  BinaryWriter,
  decodeAutoEnvelope,
  decodeDefinedFields,
  encodeAutoEnvelope,
  encodeDefinedFields,
  encodeFlags,
  requireClientId,
  stampedIntentClientIndex,
  toUint8Array,
  type BinaryMessageDefinition,
} from "./protocol/BinaryRuntime";
import {
  ClientIntentMessage,
  ClientMessageSchema,
  Intent,
  ServerTurnMessage,
  StampedIntent,
} from "./Schemas";

type BinaryWireMessage = Record<string, unknown> & { type: string };
type EnvelopeEncoder = (
  message: BinaryWireMessage,
  definition: BinaryMessageDefinition,
  context: BinaryProtocolContext,
) => Uint8Array;
type EnvelopeDecoder = (
  reader: BinaryReader,
  definition: BinaryMessageDefinition,
  context: BinaryProtocolContext,
) => BinaryWireMessage;

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

const ENVELOPE_ENCODERS = {
  auto: (message, definition, context) =>
    encodeAutoEnvelope(definition, message, context),
  intent: (message, definition, context) =>
    encodeIntentEnvelopeMessage(
      message as ClientIntentMessage,
      definition,
      context,
    ),
  packedTurn: (message, definition, context) =>
    encodePackedTurnEnvelopeMessage(
      message as ServerTurnMessage,
      definition,
      context,
    ),
} satisfies Record<BinaryMessageDefinition["envelope"], EnvelopeEncoder>;

const ENVELOPE_DECODERS = {
  auto: decodeAutoEnvelope,
  intent: decodeIntentEnvelopeMessage,
  packedTurn: decodePackedTurnEnvelopeMessage,
} satisfies Record<BinaryMessageDefinition["envelope"], EnvelopeDecoder>;

function encodeBinaryMessageWithDefinition(
  message: BinaryWireMessage,
  definition: BinaryMessageDefinition,
  context: BinaryProtocolContext,
): Uint8Array {
  return ENVELOPE_ENCODERS[definition.envelope](message, definition, context);
}

function decodeBinaryMessageWithDefinition(
  reader: BinaryReader,
  definition: BinaryMessageDefinition,
  context: BinaryProtocolContext,
): BinaryWireMessage {
  return ENVELOPE_DECODERS[definition.envelope](reader, definition, context);
}

function parseDecodedClientBinaryMessage(
  decoded: BinaryWireMessage,
): BinaryClientGameplayMessage {
  // Client decode is the semantic validation boundary: after envelope-level wire
  // decoding succeeds, validate the full client message exactly once here.
  return ClientMessageSchema.parse(decoded) as BinaryClientGameplayMessage;
}

function finalizeDecodedServerBinaryMessage(
  decoded: BinaryWireMessage,
): BinaryServerGameplayMessage {
  // Server decode intentionally stops at wire validation so replay/debug tooling can
  // inspect messages that are structurally valid on the wire but fail semantic parse.
  return decoded as BinaryServerGameplayMessage;
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

function encodeIntentEnvelopeMessage(
  message: ClientIntentMessage,
  definition: BinaryMessageDefinition,
  context: BinaryProtocolContext,
): Uint8Array {
  const writer = new BinaryWriter();
  return writer.writeFrame(definition.messageType, () => {
    encodeIntentPayload(writer, message.intent, context);
  });
}

function decodeIntentEnvelopeMessage(
  reader: BinaryReader,
  definition: BinaryMessageDefinition,
  context: BinaryProtocolContext,
): ClientIntentMessage {
  const intent = decodeIntentPayload(reader, context);
  return {
    type: definition.type as ClientIntentMessage["type"],
    intent,
  };
}

function encodePackedTurnEnvelopeMessage(
  message: ServerTurnMessage,
  definition: BinaryMessageDefinition,
  context: BinaryProtocolContext,
): Uint8Array {
  const writer = new BinaryWriter();
  return writer.writeFrame(definition.messageType, () => {
    writer.writeUint32(message.turn.turnNumber);
    writer.writeUint16(message.turn.intents.length);
    for (const intent of message.turn.intents) {
      writer.writeUint16(stampedIntentClientIndex(intent, context));
      encodeIntentPayload(writer, intent, context);
    }
  });
}

function decodePackedTurnEnvelopeMessage(
  reader: BinaryReader,
  definition: BinaryMessageDefinition,
  context: BinaryProtocolContext,
): ServerTurnMessage {
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
  return {
    type: definition.type as ServerTurnMessage["type"],
    turn: {
      turnNumber,
      intents,
    },
  };
}
