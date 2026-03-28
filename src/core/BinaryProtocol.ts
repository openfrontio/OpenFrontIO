import {
  BinaryIntentType,
  BinaryMessageType,
  hasBinaryIntentOpcode,
  intentTypeToOpcode,
  opcodeToIntentType,
} from "./__generated__/binary/generated";
import {
  ALL_PLAYERS_INDEX,
  BINARY_HEADER_SIZE,
  BINARY_PROTOCOL_VERSION,
  binaryContextFromGameStartInfo,
  createBinaryProtocolContext,
  INLINE_PLAYER_ID_INDEX,
  NO_PLAYER_INDEX,
  playerIndexToId,
  requireClientId,
  stampedIntentClientIndex,
  type BinaryProtocolContext,
} from "./protocol/BinaryRuntime";

export {
  ALL_PLAYERS_INDEX,
  BINARY_HEADER_SIZE,
  BINARY_PROTOCOL_VERSION,
  binaryContextFromGameStartInfo,
  BinaryIntentType,
  BinaryMessageType,
  createBinaryProtocolContext,
  hasBinaryIntentOpcode,
  INLINE_PLAYER_ID_INDEX,
  intentTypeToOpcode,
  NO_PLAYER_INDEX,
  opcodeToIntentType,
  playerIndexToId,
  requireClientId,
  stampedIntentClientIndex,
};

export type {
  BinaryClientGameplayMessage,
  BinaryServerGameplayMessage,
} from "./__generated__/binary/generated";
export type { BinaryProtocolContext };
