export interface Fx {
  renderTick(duration: number, ctx: CanvasRenderingContext2D): boolean;
}

export type FxType =
  | "MiniFire"
  | "MiniSmoke"
  | "MiniBigSmoke"
  | "MiniSmokeAndFire"
  | "MiniExplosion"
  | "UnitExplosion"
  | "SinkingShip"
  | "Nuke"
  | "SAMExplosion"
  | "UnderConstruction"
  | "Dust";
