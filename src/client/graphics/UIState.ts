import { NukeType } from "../../core/StatsSchemas";

export type UIState = {
  attackRatio: number;
  nukePreview?: {
    active: boolean;
    nukeType: NukeType;
  };
  nukeAnchor?: { x: number; y: number };
};
