import { TileRef } from "./GameMap";

export enum PingType {
  Attack,
  Retreat,
  Defend,
  WatchOut,
}

export class Ping {
  constructor(
    public type: PingType,
    public tile: TileRef,
  ) {}
}

export class PingPlacedEvent extends Ping {}
