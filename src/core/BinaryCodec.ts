import {
  canEncodeGeneratedBinaryClientGameplayMessage,
  decodeGeneratedBinaryClientGameplayMessage,
  decodeGeneratedBinaryServerGameplayMessage,
  encodeGeneratedBinaryClientGameplayMessage,
  encodeGeneratedBinaryServerGameplayMessage,
  type BinaryClientGameplayMessage,
  type BinaryServerGameplayMessage,
} from "./__generated__/binary/generated";
import { type BinaryProtocolContext } from "./protocol/BinaryRuntime";
import { ClientMessage, ClientMessageSchema } from "./Schemas";

export function isBinaryGameplayClientMessage(
  message: ClientMessage,
): message is BinaryClientGameplayMessage {
  return canEncodeGeneratedBinaryClientGameplayMessage(message);
}

export function encodeBinaryClientGameplayMessage(
  message: BinaryClientGameplayMessage,
  context: BinaryProtocolContext,
): Uint8Array {
  return encodeGeneratedBinaryClientGameplayMessage(message, context);
}

export function decodeBinaryClientGameplayMessage(
  data: ArrayBuffer | Uint8Array,
  context: BinaryProtocolContext,
): BinaryClientGameplayMessage {
  return ClientMessageSchema.parse(
    decodeGeneratedBinaryClientGameplayMessage(data, context),
  ) as BinaryClientGameplayMessage;
}

export function encodeBinaryServerGameplayMessage(
  message: BinaryServerGameplayMessage,
  context: BinaryProtocolContext,
): Uint8Array {
  return encodeGeneratedBinaryServerGameplayMessage(message, context);
}

export function decodeBinaryServerGameplayMessage(
  data: ArrayBuffer | Uint8Array,
  context: BinaryProtocolContext,
): BinaryServerGameplayMessage {
  return decodeGeneratedBinaryServerGameplayMessage(data, context);
}
