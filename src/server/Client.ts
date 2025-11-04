import WebSocket from "ws";
import { TokenPayload } from "../core/ApiSchemas";
import { Tick } from "../core/game/Game";
import { ClientID } from "../core/Schemas";

export class Client {
  public lastPing: number = Date.now();
  public isDisconnected: boolean = false;

  public hashes: Map<Tick, number> = new Map();

  constructor(
    public readonly clientID: ClientID,
    public readonly persistentID: string,
    public readonly claims: TokenPayload | null,
    public readonly roles: string[] | undefined,
    public readonly flares: string[] | undefined,
    public readonly ip: string,
    public readonly username: string,
    public readonly ws: WebSocket,
    public readonly flag: string | undefined,
    public readonly pattern: string | undefined,
  ) {}
}
