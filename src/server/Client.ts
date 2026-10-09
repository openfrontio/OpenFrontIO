import { Tick } from "@openfront/engine-api/game/GameTypes";
import { ClientID, Winner } from "@openfront/engine-api/Schemas";
import { TokenPayload } from "@openfront/shared/ApiSchemas";
import {
  type LevelBadge,
  packLevelBadge,
} from "@openfront/shared/LevelBadgeWire";
import { ClientPlatform, PlayerCosmetics } from "@openfront/shared/WireSchemas";
import WebSocket from "ws";

export class Client {
  public lastPing: number = Date.now();

  public hashes: Map<Tick, number> = new Map();

  // This client's winner vote, keyed on winner and stats (Consensus.voteKey).
  public reportedVote: { winner: Winner; key: string } | null = null;

  // levelBadge as the lobby roster carries it (ClientInfo.levelBadge), packed
  // once here rather than for every entry of every per-recipient broadcast.
  public readonly wireLevelBadge: number | undefined;

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
    // Client-reported and unverified; metric dimension only.
    public readonly platform: ClientPlatform | "unknown" = "unknown",
    // From the server's /users/@me lookup at join (levelBadgeForPlayer);
    // undefined for guests, players who hide their level, or when the API sent
    // no progress. Display-only.
    public readonly levelBadge: LevelBadge | undefined = undefined,
  ) {
    this.wireLevelBadge = packLevelBadge(levelBadge);
  }
}
