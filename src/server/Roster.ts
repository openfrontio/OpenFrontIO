import WebSocket from "ws";
import { ClientID } from "../core/Schemas";
import { Client } from "./Client";

// Who is in the game: everyone who ever joined, who is connected right now,
// the socket each connection holds, and the per-account flags a returning
// player is judged by (may they reconnect, were they admitted, were they
// kicked). Bookkeeping only — the join policy (allowlist, IP cap, duplicate
// sessions, host-left) stays in GameServer, which decides what to call.
export class Roster {
  // Connected clients in join order; a reconnect moves the client to the end.
  private connected: Client[] = [];
  // Every client that ever joined, by clientID. Never shrinks: someone who
  // joined and left keeps their record, so they can still be kicked and
  // still appear in the host's post-game reconciliation.
  private everyone = new Map<ClientID, Client>();
  private sockets = new Set<WebSocket>();
  // persistentID -> clientID for reconnection. Cleared by forgetReconnect (a
  // lobby-phase leave) so the seat is free again.
  private reconnectable = new Map<string, ClientID>();
  // persistentIDs that have passed join authorization (incl. Turnstile) for
  // this game at least once. Survives forgetReconnect, unlike the reconnect
  // mapping, so a returning player can skip the single-use Turnstile re-check.
  private admitted = new Set<string>();
  private kicked = new Set<string>();
  private disconnected = new Map<ClientID, boolean>();

  add(client: Client): void {
    this.sockets.add(client.ws);
    this.reconnectable.set(client.persistentID, client.clientID);
    this.admitted.add(client.persistentID);
    this.connected.push(client);
    this.everyone.set(client.clientID, client);
  }

  // Hands the client a new socket. The old one is closed and forgotten, and
  // the client moves to the end of the connected order.
  reconnect(client: Client, ws: WebSocket): void {
    this.sockets.add(ws);
    if (client.ws !== ws) {
      this.sockets.delete(client.ws);
      client.ws.removeAllListeners();
      client.ws.close();
    }
    client.ws = ws;
    this.connected = this.connected.filter(
      (c) => c.clientID !== client.clientID,
    );
    this.connected.push(client);
  }

  // The client's socket went away. Their record and reconnect mapping stay.
  markLeft(client: Client): void {
    this.sockets.delete(client.ws);
    this.connected = this.connected.filter(
      (c) => c.clientID !== client.clientID,
    );
  }

  // Drops the reconnect mapping, so the persistentID comes back through the
  // full join path and its seat counts as free. Admission is kept.
  forgetReconnect(client: Client): void {
    this.reconnectable.delete(client.persistentID);
  }

  // Bans the persistentID (no rejoin, no reconnect, no admission) whether or
  // not the client is still connected, and drops it from the connected list.
  // Returns whether it was connected.
  kick(client: Client): boolean {
    this.kicked.add(client.persistentID);
    const wasConnected = this.connected.some(
      (c) => c.clientID === client.clientID,
    );
    this.connected = this.connected.filter(
      (c) => c.clientID !== client.clientID,
    );
    return wasConnected;
  }

  // Removes and returns the connected clients that have not pinged for more
  // than `maxSilenceMs` as of `now`.
  pruneStale(now: number, maxSilenceMs: number): Client[] {
    const stale: Client[] = [];
    const alive: Client[] = [];
    for (const client of this.connected) {
      (now - client.lastPing > maxSilenceMs ? stale : alive).push(client);
    }
    this.connected = alive;
    return stale;
  }

  // Closes every socket still open.
  closeAll(reason: string): void {
    this.sockets.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, reason);
      }
    });
  }

  active(): readonly Client[] {
    return this.connected;
  }

  // Whether this client holds a connection right now. One dropped by
  // markLeft, kick or pruneStale is gone from the connected list while its
  // record — and its socket's listeners — can outlive it.
  isConnected(client: Client): boolean {
    return this.connected.includes(client);
  }

  // Connected clients who will actually play. Spectators are excluded
  // everywhere a "player" is meant: the lobby cap, gameStartInfo, the votes.
  players(): Client[] {
    return this.connected.filter((c) => !c.spectator);
  }

  all(): ReadonlyMap<ClientID, Client> {
    return this.everyone;
  }

  get(clientID: ClientID): Client | undefined {
    return this.everyone.get(clientID);
  }

  // The client this persistentID may reconnect as, if the mapping is still
  // held. Does not consult the kick list: that is the caller's policy.
  byPersistentId(persistentID: string): Client | undefined {
    const clientID = this.reconnectable.get(persistentID);
    return clientID === undefined ? undefined : this.everyone.get(clientID);
  }

  isKicked(persistentID: string): boolean {
    return this.kicked.has(persistentID);
  }

  // Whether this persistentID has already been admitted (passed Turnstile and
  // other join authorization) for this game. Kicked players are excluded so
  // a kick still forces them back through the gate.
  wasAdmitted(persistentID: string): boolean {
    if (this.kicked.has(persistentID)) return false;
    return this.admitted.has(persistentID);
  }

  // Unknown clients count as disconnected.
  isDisconnected(clientID: ClientID): boolean {
    return this.disconnected.get(clientID) ?? true;
  }

  setDisconnected(clientID: ClientID, isDisconnected: boolean): void {
    this.disconnected.set(clientID, isDisconnected);
  }

  // The electorate for the winner and live-stats votes. Spectators run the
  // simulation but may not vote, so counting them would raise the bar for a
  // majority without anyone able to meet it: five spectators watching four
  // players make a strict majority of nine unreachable, and the game would
  // never reach consensus, never archive, and never be scored.
  votingUniqueIPs(): number {
    return new Set(this.players().map((c) => c.ip)).size;
  }
}
