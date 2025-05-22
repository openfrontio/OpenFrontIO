export interface Fx {
  renderTick(duration: number, ctx: CanvasRenderingContext2D): boolean;
}

export enum FxType {
  MiniFire = "MiniFire",
  MiniSmoke = "MiniSmoke",
  MiniBigSmoke = "MiniBigSmoke",
  MiniSmokeAndFire = "MiniSmokeAndFire",
  Nuke = "Nuke",
  SAMExplosion = "SAMExplosion",
}
