import WebSocket from "ws";
import { TokenPayload } from "../core/ApiSchemas";
import { PlayerID, Tick } from "../core/game/Game";
import { ClientID } from "../core/Schemas";
import { generateID } from "../core/Util";

export class Client {
  public lastPing: number;

  public hashes: Map<Tick, number> = new Map();

  public readonly playerID: PlayerID = generateID();

  constructor(
    public readonly clientID: ClientID,
    public readonly persistentID: string,
    public readonly claims: TokenPayload | null,
    public readonly ip: string,
    public readonly username: string,
    public readonly ws: WebSocket,
    public readonly flag: string | null,
  ) {}
}
