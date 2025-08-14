export type UIState = {
  attackRatio: number;
  nukePreview?: {
    active: boolean;
    nukeType: string; // "Atom Bomb" | "Hydrogen Bomb" | "MIRV"
  };
  nukeAnchorScreen?: { x: number; y: number }; // ← new
};
