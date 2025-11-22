import { TileRef } from "./GameMap";

export type PingType = "attack" | "retreat" | "defend" | "watchOut";

export type Ping = {
  type: PingType;
  tile: TileRef;
};
