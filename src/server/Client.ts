import WebSocket from "ws";
import { TokenPayload } from "../core/ApiSchemas";
import { Tick } from "../core/game/Game";
import { ClientID, PlayerCosmetics, Winner } from "../core/Schemas";

export class Client {
  public lastPing: number = Date.now();

  public hashes: Map<Tick, number> = new Map();

  public reportedWinner: Winner | null = null;

  constructor(
    public readonly clientID: ClientID,
    public readonly persistentID: string,
    public readonly claims: TokenPayload | null,
    public readonly roles: string[] | undefined,
    public readonly flares: string[] | undefined,
    public readonly ip: string,
    public readonly username: string,
    public ws: WebSocket,
    public readonly cosmetics: PlayerCosmetics | undefined,
    public readonly isRejoin: boolean = false,
  ) {}
}
