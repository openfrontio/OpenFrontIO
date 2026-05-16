// Renderer types (units, players, tiles, names, config)
export { PlayerTypeEnum, TrainType } from "./renderer";
export type {
  AllianceData,
  AttackData,
  AttackRingInput,
  ConquestFx,
  DeadUnitFx,
  EmojiData,
  GhostPreviewData,
  NameEntry,
  NukeTelegraphData,
  NukeTrajectoryData,
  PlayerState,
  PlayerStatic,
  PlayerStatusData,
  RendererConfig,
  TilePair,
  UnitState,
} from "./renderer";

// Frame data — boundary contract between game integration and features
export type { FrameData } from "./frame-data";

// Frame events — per-frame ephemeral events (rendering FX + stats events)
export { EMPTY_FRAME_EVENTS } from "./frame-events";
export type {
  AllianceBrokenEvent,
  AllianceExpiredEvent,
  AllianceFormedEvent,
  BonusEvent,
  DisplayMessageEvent,
  EmbargoEvent,
  EmojiEvent,
  FrameEvents,
  NukeIncomingEvent,
  TargetEvent,
  WinEvent,
} from "./frame-events";

// Frame source — mode-agnostic subscription interface
export type { FrameSource, GameStartConfig } from "./frame-source";

// Game update types
export type { GameStartInfo, GameUpdateViewData } from "./game";

// Replay types (header, frames, codec helpers)
export type {
  ChunkIndexEntry,
  FrameSnapshot,
  GridPlanRecord,
  GzipFn,
  InflateFn,
  MotionPlanRecord,
  RawDelta,
  RawFrame,
  RawKeyframe,
  ReplayHeader,
  StreamableReplayInfo,
  TrainPlanRecord,
} from "./replay";

// Game update type constants and event payloads (shared between shim + codec)
export { GameUpdateType, MessageType } from "./game-updates";
export type {
  AllianceExpiredUpdate,
  AllianceReplyUpdate,
  AttackEventUpdate,
  BonusUpdate,
  BrokeAllianceUpdate,
  DisplayMessageUpdate,
  EmbargoUpdate,
  EmojiUpdate,
  GamePausedUpdate,
  PlayerEventUpdate,
  PlayerType,
  RailroadConstructionUpdate,
  RailroadDestructionUpdate,
  RailroadSnapUpdate,
  TargetPlayerUpdate,
  UnitEventUpdate,
  UnitIncomingUpdate,
  WinUpdate,
} from "./game-updates";

// Unit type string constants and derived sets
export {
  ALL_UNIT_TYPES,
  NUKE_MAGNITUDES,
  NUKE_TYPES,
  STRUCTURE_TYPES,
  UT_ATOM_BOMB,
  UT_CITY,
  UT_DEFENSE_POST,
  UT_FACTORY,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_MIRV_WARHEAD,
  UT_MISSILE_SILO,
  UT_PORT,
  UT_SAM_LAUNCHER,
  UT_SAM_MISSILE,
  UT_SHELL,
  UT_TRADE_SHIP,
  UT_TRAIN,
  UT_TRANSPORT,
  UT_WARSHIP,
} from "./unit-type";
