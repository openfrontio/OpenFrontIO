import WebSocket from "ws";
import { TokenPayload } from "../core/ApiSchemas";
import { Tick } from "../core/game/Game";
import { ClientID, PlayerCosmetics, Winner } from "../core/Schemas";

export class Client {
  public lastPing: number = Date.now();

  public hashes: Map<Tick, number> = new Map();

  public reportedWinner: Winner | null = null;

  /**
   * Whether this client supports MessagePack binary frames.
   * Set to true when the client sends `msgpack: true` in its join/rejoin
   * message. Defaults to false for backward compatibility — such clients
   * receive JSON text frames exactly as before.
   */
  public supportsMsgPack: boolean = false;

  constructor(
    public readonly clientID: ClientID,
    public readonly persistentID: string,
    public readonly claims: TokenPayload | null,
    public readonly roles: string[] | undefined,
    public readonly flares: string[] | undefined,
    public readonly ip: string,
    public username: string,
    public readonly uncensoredUsername: string,
    public ws: WebSocket,
    public readonly cosmetics: PlayerCosmetics | undefined,
  ) {}
}
