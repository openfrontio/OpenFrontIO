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
    public readonly role: string | null,
    public readonly flares: string[] | undefined,
    public readonly ip: string,
    public username: string,
    public clanTag: string | null,
    public ws: WebSocket,
    public readonly cosmetics: PlayerCosmetics | undefined,
    public readonly publicId: string | undefined,
    public readonly friends: string[],
    // Set once at join, and again by GameServer when someone arrives after the
    // game has started — the player list is already frozen, so they can only watch.
    public spectator: boolean = false,
    // Whether the API reported this account as trusted when it joined (the
    // gate for GameConfig.trusted). Anonymous joins are never trusted.
    public readonly trusted: boolean = false,
  ) {}
}
