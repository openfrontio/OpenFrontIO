import {
  ClientHashMessage,
  ClientID,
  ClientIntentMessage,
  ClientPingMessage,
  GameStartInfo,
  Intent,
  ServerDesyncMessage,
  ServerTurnMessage,
  StampedIntent,
} from "./Schemas";
import { AllPlayers, UnitType } from "./game/Game";

export const BINARY_PROTOCOL_VERSION = 1;

export const BINARY_HEADER_SIZE = 4;
export const NO_PLAYER_INDEX = 0xffff;
export const ALL_PLAYERS_INDEX = 0xfffe;

export enum BinaryMessageType {
  Intent = 1,
  Turn = 2,
  Hash = 3,
  Ping = 4,
  Desync = 5,
}

export enum BinaryIntentType {
  Attack = 1,
  CancelAttack = 2,
  Spawn = 3,
  MarkDisconnected = 4,
  BoatAttack = 5,
  CancelBoat = 6,
  AllianceRequest = 7,
  AllianceReject = 8,
  BreakAlliance = 9,
  TargetPlayer = 10,
  Emoji = 11,
  DonateGold = 12,
  DonateTroops = 13,
  BuildUnit = 14,
  UpgradeStructure = 15,
  Embargo = 16,
  EmbargoAll = 17,
  MoveWarship = 18,
  QuickChat = 19,
  AllianceExtension = 20,
  DeleteUnit = 21,
  TogglePause = 22,
}

export const INTENT_FLAG_OPTION_A = 1 << 0;
export const INTENT_FLAG_OPTION_B = 1 << 1;

export type BinaryClientGameplayMessage =
  | ClientIntentMessage
  | ClientHashMessage
  | ClientPingMessage;

export type BinaryServerGameplayMessage =
  | ServerTurnMessage
  | ServerDesyncMessage;

const INTENT_TYPE_TO_OPCODE: Record<
  Intent["type"],
  BinaryIntentType | undefined
> = {
  attack: BinaryIntentType.Attack,
  cancel_attack: BinaryIntentType.CancelAttack,
  spawn: BinaryIntentType.Spawn,
  mark_disconnected: BinaryIntentType.MarkDisconnected,
  boat: BinaryIntentType.BoatAttack,
  cancel_boat: BinaryIntentType.CancelBoat,
  allianceRequest: BinaryIntentType.AllianceRequest,
  allianceReject: BinaryIntentType.AllianceReject,
  breakAlliance: BinaryIntentType.BreakAlliance,
  targetPlayer: BinaryIntentType.TargetPlayer,
  emoji: BinaryIntentType.Emoji,
  donate_gold: BinaryIntentType.DonateGold,
  donate_troops: BinaryIntentType.DonateTroops,
  build_unit: BinaryIntentType.BuildUnit,
  upgrade_structure: BinaryIntentType.UpgradeStructure,
  embargo: BinaryIntentType.Embargo,
  embargo_all: BinaryIntentType.EmbargoAll,
  move_warship: BinaryIntentType.MoveWarship,
  quick_chat: BinaryIntentType.QuickChat,
  allianceExtension: BinaryIntentType.AllianceExtension,
  delete_unit: BinaryIntentType.DeleteUnit,
  kick_player: undefined,
  toggle_pause: BinaryIntentType.TogglePause,
  update_game_config: undefined,
};

const OPCODE_TO_INTENT_TYPE: Record<BinaryIntentType, Intent["type"]> = {
  [BinaryIntentType.Attack]: "attack",
  [BinaryIntentType.CancelAttack]: "cancel_attack",
  [BinaryIntentType.Spawn]: "spawn",
  [BinaryIntentType.MarkDisconnected]: "mark_disconnected",
  [BinaryIntentType.BoatAttack]: "boat",
  [BinaryIntentType.CancelBoat]: "cancel_boat",
  [BinaryIntentType.AllianceRequest]: "allianceRequest",
  [BinaryIntentType.AllianceReject]: "allianceReject",
  [BinaryIntentType.BreakAlliance]: "breakAlliance",
  [BinaryIntentType.TargetPlayer]: "targetPlayer",
  [BinaryIntentType.Emoji]: "emoji",
  [BinaryIntentType.DonateGold]: "donate_gold",
  [BinaryIntentType.DonateTroops]: "donate_troops",
  [BinaryIntentType.BuildUnit]: "build_unit",
  [BinaryIntentType.UpgradeStructure]: "upgrade_structure",
  [BinaryIntentType.Embargo]: "embargo",
  [BinaryIntentType.EmbargoAll]: "embargo_all",
  [BinaryIntentType.MoveWarship]: "move_warship",
  [BinaryIntentType.QuickChat]: "quick_chat",
  [BinaryIntentType.AllianceExtension]: "allianceExtension",
  [BinaryIntentType.DeleteUnit]: "delete_unit",
  [BinaryIntentType.TogglePause]: "toggle_pause",
};

const UNIT_TYPE_TO_OPCODE = new Map<UnitType, number>(
  Object.values(UnitType).map((type, index) => [type, index + 1]),
);

const OPCODE_TO_UNIT_TYPE = new Map<number, UnitType>(
  Object.values(UnitType).map((type, index) => [index + 1, type]),
);

export interface BinaryProtocolContext {
  readonly playerIds: readonly ClientID[];
  readonly playerIdToIndex: ReadonlyMap<ClientID, number>;
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

export function intentTypeToOpcode(
  intentType: Intent["type"],
): BinaryIntentType {
  const opcode = INTENT_TYPE_TO_OPCODE[intentType];
  if (opcode === undefined) {
    throw new Error(`Unsupported binary intent type: ${intentType}`);
  }
  return opcode;
}

export function opcodeToIntentType(opcode: number): Intent["type"] {
  const intentType = OPCODE_TO_INTENT_TYPE[opcode as BinaryIntentType];
  if (intentType === undefined) {
    throw new Error(`Unknown binary intent opcode: ${opcode}`);
  }
  return intentType;
}

export function unitTypeToOpcode(unitType: UnitType): number {
  const opcode = UNIT_TYPE_TO_OPCODE.get(unitType);
  if (opcode === undefined) {
    throw new Error(`Unknown unit type: ${unitType}`);
  }
  return opcode;
}

export function opcodeToUnitType(opcode: number): UnitType {
  const unitType = OPCODE_TO_UNIT_TYPE.get(opcode);
  if (unitType === undefined) {
    throw new Error(`Unknown unit opcode: ${opcode}`);
  }
  return unitType;
}

export function playerIdToIndex(
  playerId: ClientID | null | typeof AllPlayers,
  context: BinaryProtocolContext,
): number {
  if (playerId === null) {
    return NO_PLAYER_INDEX;
  }
  if (playerId === AllPlayers) {
    return ALL_PLAYERS_INDEX;
  }
  const index = context.playerIdToIndex.get(playerId);
  if (index === undefined) {
    throw new Error(`Unknown player ID: ${playerId}`);
  }
  return index;
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
