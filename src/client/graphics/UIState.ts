export type UIState = {
  attackRatio: number;
  nukePreview?: {
    active: boolean;
    nukeType: string;
  };
  nukeAnchor?: { x: number; y: number };
};
