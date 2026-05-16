// Re-export the boundary contract type
export type { FrameData } from "../types";

// Shared derive functions
export { computeAllianceClusters } from "./derive/alliance-clusters";
export {
  extractAttackRings,
  extractAttackRingsFromIds,
} from "./derive/attack-rings";
export {
  extractNukeTelegraphs,
  extractNukeTelegraphsFromIds,
} from "./derive/nuke-telegraphs";
export { computePlayerStatus } from "./derive/player-status";
export { buildRelationMatrix, buildTeamMap } from "./derive/relation-matrix";

// Upload
export type { RelationMatrixResult } from "./derive/relation-matrix";
export { uploadFrameData } from "./upload";
export type { FrameUploadTarget, UploadOptions } from "./upload";
