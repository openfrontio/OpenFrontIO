// Re-export the boundary contract type
export type { FrameData } from "../types";

// Shared derive functions
export { computeAllianceClusters } from "./derive/AllianceClusters";
export {
  extractAttackRings,
  extractAttackRingsFromIds,
} from "./derive/AttackRings";
export {
  extractNukeTelegraphs,
  extractNukeTelegraphsFromIds,
} from "./derive/NukeTelegraphs";
export { computePlayerStatus } from "./derive/PlayerStatus";
export { buildRelationMatrix, buildTeamMap } from "./derive/RelationMatrix";

// Upload
export type { RelationMatrixResult } from "./derive/RelationMatrix";
export { uploadFrameData } from "./Upload";
export type { FrameUploadTarget, UploadOptions } from "./Upload";
