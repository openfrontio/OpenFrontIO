import { z } from "zod";

export interface Fx {
  renderTick(duration: number, ctx: CanvasRenderingContext2D): boolean;
}

export const FxTypeSchema = z.enum([
  "MiniFire",
  "MiniSmoke",
  "MiniBigSmoke",
  "MiniSmokeAndFire",
  "MiniExplosion",
  "UnitExplosion",
  "BuildingExplosion",
  "SinkingShip",
  "Nuke",
  "SAMExplosion",
  "UnderConstruction",
  "Dust",
  "Conquest",
  "Santa",
  "Snowman",
  "HappyElf",
  "SadElf",
  "Sparks",
]);
export type FxType = z.infer<typeof FxTypeSchema>;
