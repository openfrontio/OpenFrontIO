// Renderer types (units, players, tiles, names, config)
export { PlayerTypeEnum, TrainType } from "./Renderer";
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
} from "./Renderer";

// Frame data — boundary contract between game integration and features
export type { FrameData } from "./FrameData";

// Frame events — per-frame ephemeral events (rendering FX + stats events)
export { EMPTY_FRAME_EVENTS } from "./FrameEvents";
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
} from "./FrameEvents";

// Frame source — mode-agnostic subscription interface
export type { FrameSource, GameStartConfig } from "./FrameSource";

// Game update types
export type { GameStartInfo, GameUpdateViewData } from "./Game";

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
} from "./Replay";

// Game update type constants and event payloads (shared between shim + codec)
export { GameUpdateType, MessageType } from "./GameUpdates";
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
} from "./GameUpdates";

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
} from "./UnitType";
