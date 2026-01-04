export interface Fx {
  renderTick(duration: number, ctx: CanvasRenderingContext2D): boolean;
}

export enum FxType {
  MiniFire = "MiniFire",
  MiniSmoke = "MiniSmoke",
  MiniBigSmoke = "MiniBigSmoke",
  MiniSmokeAndFire = "MiniSmokeAndFire",
  MiniExplosion = "MiniExplosion",
  UnitExplosion = "UnitExplosion",
  BuildingExplosion = "BuildingExplosion",
  SinkingShip = "SinkingShip",
  Nuke = "Nuke",
  SAMExplosion = "SAMExplosion",
  UnderConstruction = "UnderConstruction",
  Dust = "Dust",
  Conquest = "Conquest",
  FireworkAll = "FireworkAll",
  FireworkRed = "FireworkRed",
  FireworkYellow = "FireworkYellow",
  FireworkCyan = "FireworkCyan",
  ConquestChampagne = "ConquestChampagne",
}
