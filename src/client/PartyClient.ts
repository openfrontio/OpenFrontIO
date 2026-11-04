// The player's party: a group of friends that moves between games together.
//
// The leader plays as usual; every game they join (a public lobby, a private
// lobby, one they host) is announced to the party, and every other member's
// client joins the same game. In the game each member tells the server which
// party they came with, and team games seat the party on one team — ahead
// of, and overriding, clan tags (TeamAssignment.ts).
//
// Homepage-safe: no game-client imports. Protocol in PartySchemas.ts.

import {
  ClanTagSchema,
  GAME_ID_REGEX,
  JoinUsernameSchema,
} from "@openfront/engine-api/Schemas";
import {
  decodePartyServerMessage,
  encodePartyClientMessage,
  PARTY_RESUME_GRACE_MS,
  PartyClientMessage,
  PartyClosedReason,
  PartyState,
} from "@openfront/shared/PartySchemas";
import { ClientEnv } from "./ClientEnv";

export type PartyStatus = "idle" | "connecting" | "connected" | "reconnecting";

export interface PartyView {
  status: PartyStatus;
  // The last state the server sent; null outside a party.
  state: PartyState | null;
  // Why the last party ended or could not be joined, until the next attempt.
  error: PartyClosedReason | "unreachable" | null;
}

export interface PartyIdentity {
  username: string;
  clanTag: string | null;
}

const STORAGE_KEY = "openfront.party";
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

interface StoredParty {
  partyID: string;
  resumeToken: string;
}

function readStored(): StoredParty | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<StoredParty>;
    if (
      typeof parsed.partyID === "string" &&
      GAME_ID_REGEX.test(parsed.partyID) &&
      typeof parsed.resumeToken === "string"
    ) {
      return { partyID: parsed.partyID, resumeToken: parsed.resumeToken };
    }
  } catch {
    // Storage blocked or corrupt: no party to resume.
  }
  return null;
}

function writeStored(value: StoredParty | null): void {
  try {
    if (value === null) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage blocked: the party just won't survive a reload.
  }
}

// The invite code from a `#party=<code>` link, or null.
export function parsePartyHash(hash: string): string | null {
  const match = /^#party=([A-Za-z0-9]+)$/.exec(hash);
  if (match === null || !GAME_ID_REGEX.test(match[1])) return null;
  return match[1];
}

export function partyInviteLink(partyID: string): string {
  return `${window.location.origin}/#party=${partyID}`;
}

export class PartyClient {
  private ws: WebSocket | null = null;
  private current: PartyView = { status: "idle", state: null, error: null };
  private readonly listeners = new Set<(view: PartyView) => void>();
  private readonly followListeners = new Set<(gameID: string) => void>();
  private identity: () => PartyIdentity = () => ({
    username: "Player",
    clanTag: null,
  });
  // What the next (re)connect says in its hello.
  private target: { partyID?: string; resumeToken?: string } | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private droppedAt: number | null = null;

  setIdentityProvider(provider: () => PartyIdentity): void {
    this.identity = provider;
  }

  view(): PartyView {
    return this.current;
  }

  // Calls back now and on every change; returns the unsubscribe.
  subscribe(cb: (view: PartyView) => void): () => void {
    this.listeners.add(cb);
    cb(this.current);
    return () => this.listeners.delete(cb);
  }

  // Fired on members (never the leader) when the leader joined a game.
  onFollow(cb: (gameID: string) => void): () => void {
    this.followListeners.add(cb);
    return () => this.followListeners.delete(cb);
  }

  inParty(): boolean {
    return this.current.state !== null;
  }

  partyID(): string | undefined {
    return this.current.state?.partyID;
  }

  isLeader(): boolean {
    const s = this.current.state;
    return s !== null && s.leaderID === s.selfID;
  }

  // Only alone in the party counts as not grouping with anyone.
  hasOthers(): boolean {
    return (this.current.state?.members.length ?? 0) > 1;
  }

  create(): void {
    this.start({});
  }

  join(partyID: string): void {
    if (!GAME_ID_REGEX.test(partyID)) {
      this.update({ status: "idle", state: null, error: "not_found" });
      return;
    }
    if (this.current.state?.partyID === partyID) return;
    this.start({ partyID });
  }

  // Picks the party back up after a reload, when this tab was in one.
  resume(): void {
    const stored = readStored();
    if (stored === null || this.ws !== null) return;
    this.start(stored);
  }

  leave(): void {
    this.send({ type: "leave" });
    this.reset(null);
  }

  kick(memberID: string): void {
    this.send({ type: "kick", memberID });
  }

  promote(memberID: string): void {
    this.send({ type: "promote", memberID });
  }

  // The leader joined a game: bring the party along. No-op for members.
  announceGame(gameID: string): void {
    if (!this.isLeader()) return;
    this.send({ type: "follow", gameID });
  }

  private start(target: { partyID?: string; resumeToken?: string }): void {
    this.reset(null);
    this.target = target;
    this.reconnectAttempt = 0;
    this.droppedAt = null;
    this.update({ status: "connecting", state: null, error: null });
    this.connect();
  }

  private connect(): void {
    const target = this.target;
    if (target === null) return;
    let url: string;
    try {
      url =
        target.partyID === undefined
          ? `${ClientEnv.serverWsBase()}/w${Math.floor(
              Math.random() * ClientEnv.numWorkers(),
            )}/party`
          : `${ClientEnv.gameWsBase(target.partyID)}/${ClientEnv.gameWorkerPath(
              target.partyID,
            )}/party`;
    } catch (e) {
      console.warn("party: no server to connect to", e);
      this.reset("unreachable");
      return;
    }
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      const identity = this.identity();
      const username = JoinUsernameSchema.safeParse(identity.username);
      const clanTag = ClanTagSchema.safeParse(identity.clanTag);
      ws.send(
        encodePartyClientMessage({
          type: "hello",
          partyID: target.partyID,
          resumeToken: target.resumeToken,
          username: username.success ? username.data : "Player",
          clanTag: clanTag.success ? clanTag.data : null,
        }),
      );
    };
    ws.onmessage = (event: MessageEvent) => {
      if (this.ws !== ws || !(event.data instanceof ArrayBuffer)) return;
      let msg;
      try {
        msg = decodePartyServerMessage(new Uint8Array(event.data));
      } catch (e) {
        console.warn("party: undecodable frame", e);
        return;
      }
      switch (msg.type) {
        case "state": {
          this.reconnectAttempt = 0;
          this.droppedAt = null;
          // Every reconnect from here on resumes this seat.
          this.target = {
            partyID: msg.partyID,
            resumeToken: msg.resumeToken,
          };
          writeStored(this.target as StoredParty);
          this.update({ status: "connected", state: msg, error: null });
          break;
        }
        case "follow": {
          for (const cb of this.followListeners) cb(msg.gameID);
          break;
        }
        case "closed": {
          this.reset(msg.reason === "left" ? null : msg.reason);
          break;
        }
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.target === null) return;
    const now = Date.now();
    this.droppedAt ??= now;
    // Past the server's grace the seat is gone anyway; a resume would only
    // be refused.
    const graceLeft = PARTY_RESUME_GRACE_MS - (now - this.droppedAt);
    if (
      this.target.resumeToken !== undefined &&
      graceLeft <= 0 &&
      this.reconnectAttempt > 0
    ) {
      this.reset("unreachable");
      return;
    }
    if (this.reconnectAttempt >= RECONNECT_DELAYS_MS.length) {
      this.reset("unreachable");
      return;
    }
    const delay = RECONNECT_DELAYS_MS[this.reconnectAttempt++];
    this.update({ ...this.current, status: "reconnecting" });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private send(msg: PartyClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(encodePartyClientMessage(msg));
    }
  }

  // Out of the party: drop the socket and the stored seat.
  private reset(error: PartyView["error"]): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws !== null) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.close();
    }
    this.target = null;
    writeStored(null);
    this.update({ status: "idle", state: null, error });
  }

  private update(view: PartyView): void {
    this.current = view;
    for (const cb of this.listeners) cb(view);
  }
}

export const party = new PartyClient();
