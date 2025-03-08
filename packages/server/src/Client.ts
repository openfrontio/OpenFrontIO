import type { ClientID } from "@openfrontio/core/src/Schemas";
import type { Tick } from "@openfrontio/core/src/game/Game";
import WebSocket from "ws";

export class Client {
  public lastPing: number;

  public hashes: Map<Tick, number> = new Map();

  constructor(
    public readonly clientID: ClientID,
    public readonly persistentID: string,
    public readonly ip: string | null,
    public readonly username: string,
    public readonly ws: WebSocket,
  ) {}
}
