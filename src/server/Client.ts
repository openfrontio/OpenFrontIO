import WebSocket from "ws";
import { ClientID } from "../core/Schemas";
import { PlayerID, Tick } from "../core/game/Game";
import { generateID } from "../core/Util";

export class Client {
  public lastPing: number;

  public hashes: Map<Tick, number> = new Map();

  public readonly playerID: PlayerID = generateID();

  constructor(
    public readonly clientID: ClientID,
    public readonly persistentID: string,
    public readonly ip: string,
    public readonly username: string,
    public readonly ws: WebSocket,
  ) {}
}
