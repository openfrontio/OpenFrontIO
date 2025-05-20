export interface Fx {
  renderTick(duration: number, ctx: CanvasRenderingContext2D): boolean;
}

export enum FxType {
  Nuke = "Nuke",
}
