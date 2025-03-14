import WebSocket from "ws";
import { ClientID } from "../core/Schemas";
import { Tick } from "../core/game/Game";

export class Client {
  public lastPing: number;

  public hashes: Map<Tick, number> = new Map();

  constructor(
    public readonly clientID: ClientID,
    public readonly persistentID: string,
    public readonly ip: string,
    public readonly username: string,
    public readonly ws: WebSocket,
  ) {}
}
