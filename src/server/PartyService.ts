import {
  decodePartyClientMessage,
  encodePartyServerMessage,
  PARTY_MAX_SIZE,
  PARTY_RESUME_GRACE_MS,
  PartyClientMessage,
  PartyClosedReason,
  PartyServerMessage,
} from "@openfront/shared/PartySchemas";
import { generateID } from "@openfront/shared/SharedUtil";
import { customAlphabet } from "nanoid";
import { RawData, WebSocket, WebSocketServer } from "ws";
import { censorPlayer } from "./Censor";

// The parties hosted on this worker (see PartySchemas.ts for the protocol).
//
// A party is pure coordination: who is in it, who leads, and which game the
// leader went to last. Members follow the leader by joining that game the
// ordinary way; the game server then seats them together because each one
// tells it the party id. Nothing here is persisted: a worker restart ends
// every party on it, and the clients simply show the party as gone.

// The transport, as little of a WebSocket as the service needs, so tests can
// drive it without a server.
export interface PartyConnection {
  send(data: Uint8Array): void;
  close(): void;
}

export interface PartyServiceOptions {
  // Mints an id that routes to this worker (ServerEnv.generateGameIdForWorker),
  // or null when none could be found.
  mintPartyID: () => string | null;
  graceMs?: number;
  // How long a fresh socket may stay silent before sending its hello.
  helloTimeoutMs?: number;
  // Frames a socket may send per rateWindowMs before it is cut off.
  rateLimit?: number;
  rateWindowMs?: number;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
}

interface Member {
  memberID: string;
  resumeToken: string;
  username: string;
  clanTag: string | null;
  conn: PartyConnection | null;
  graceTimer: unknown;
}

interface Party {
  id: string;
  // Join order: the next leader is the earliest member still connected.
  members: Member[];
  leaderID: string;
  gameID: string | undefined;
}

interface ConnectionState {
  party: Party | null;
  member: Member | null;
  helloTimer: unknown;
  windowStart: number;
  framesInWindow: number;
}

const resumeToken = customAlphabet(
  "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ",
  24,
);

export class PartyService {
  private readonly parties = new Map<string, Party>();
  private readonly connections = new Map<PartyConnection, ConnectionState>();
  private readonly graceMs: number;
  private readonly helloTimeoutMs: number;
  private readonly rateLimit: number;
  private readonly rateWindowMs: number;
  private readonly setTimer: (cb: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly now: () => number;

  constructor(private readonly options: PartyServiceOptions) {
    this.graceMs = options.graceMs ?? PARTY_RESUME_GRACE_MS;
    this.helloTimeoutMs = options.helloTimeoutMs ?? 10_000;
    this.rateLimit = options.rateLimit ?? 30;
    this.rateWindowMs = options.rateWindowMs ?? 10_000;
    this.setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimer =
      options.clearTimer ??
      ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.now = options.now ?? Date.now;
  }

  partyCount(): number {
    return this.parties.size;
  }

  connectionCount(): number {
    return this.connections.size;
  }

  onOpen(conn: PartyConnection): void {
    const state: ConnectionState = {
      party: null,
      member: null,
      helloTimer: null,
      windowStart: this.now(),
      framesInWindow: 0,
    };
    state.helloTimer = this.setTimer(() => {
      if (state.member === null) this.reject(conn, "invalid");
    }, this.helloTimeoutMs);
    this.connections.set(conn, state);
  }

  onMessage(conn: PartyConnection, data: Uint8Array): void {
    const state = this.connections.get(conn);
    if (state === undefined) return;
    const now = this.now();
    if (now - state.windowStart >= this.rateWindowMs) {
      state.windowStart = now;
      state.framesInWindow = 0;
    }
    if (++state.framesInWindow > this.rateLimit) {
      conn.close();
      this.onClose(conn);
      return;
    }
    let msg: PartyClientMessage;
    try {
      msg = decodePartyClientMessage(data);
    } catch {
      if (state.member === null) this.reject(conn, "invalid");
      return;
    }
    if (msg.type === "hello") {
      if (state.member !== null) return;
      this.hello(conn, state, msg);
      return;
    }
    const party = state.party;
    const member = state.member;
    if (party === null || member === null) {
      this.reject(conn, "invalid");
      return;
    }
    switch (msg.type) {
      case "follow": {
        if (party.leaderID !== member.memberID) return;
        if (party.gameID === msg.gameID) return;
        party.gameID = msg.gameID;
        for (const m of party.members) {
          if (m === member) continue;
          this.send(m, { type: "follow", gameID: msg.gameID });
        }
        this.broadcastState(party);
        return;
      }
      case "kick": {
        if (party.leaderID !== member.memberID) return;
        const target = party.members.find((m) => m.memberID === msg.memberID);
        if (target === undefined || target === member) return;
        this.removeMember(party, target, "kicked");
        return;
      }
      case "promote": {
        if (party.leaderID !== member.memberID) return;
        if (!party.members.some((m) => m.memberID === msg.memberID)) return;
        party.leaderID = msg.memberID;
        this.broadcastState(party);
        return;
      }
      case "leave": {
        this.removeMember(party, member, "left");
        return;
      }
    }
  }

  onClose(conn: PartyConnection): void {
    const state = this.connections.get(conn);
    if (state === undefined) return;
    this.connections.delete(conn);
    if (state.helloTimer !== null) this.clearTimer(state.helloTimer);
    const { party, member } = state;
    // A member whose socket was replaced by a resume no longer points here.
    if (party === null || member === null || member.conn !== conn) return;
    member.conn = null;
    // Keep the seat (and the lead) for a while: a reload or a cross-host
    // navigation into a game drops the socket, and the client comes back
    // with its resume token.
    member.graceTimer = this.setTimer(() => {
      member.graceTimer = null;
      if (member.conn === null && party.members.includes(member)) {
        this.removeMember(party, member, null);
      }
    }, this.graceMs);
    this.broadcastState(party);
  }

  private hello(
    conn: PartyConnection,
    state: ConnectionState,
    msg: Extract<PartyClientMessage, { type: "hello" }>,
  ): void {
    const { username, clanTag } = censorPlayer(msg.username, msg.clanTag);
    let party: Party;
    let member: Member | undefined;
    if (msg.partyID === undefined) {
      const id = this.options.mintPartyID();
      if (id === null || this.parties.has(id)) {
        this.reject(conn, "invalid");
        return;
      }
      member = this.newMember(username, clanTag);
      party = {
        id,
        members: [member],
        leaderID: member.memberID,
        gameID: undefined,
      };
      this.parties.set(id, party);
    } else {
      const existing = this.parties.get(msg.partyID);
      if (existing === undefined) {
        this.reject(conn, "not_found");
        return;
      }
      party = existing;
      member =
        msg.resumeToken === undefined
          ? undefined
          : party.members.find((m) => m.resumeToken === msg.resumeToken);
      if (member !== undefined) {
        // Resume: take the seat back, replacing any socket still on it.
        if (member.graceTimer !== null) {
          this.clearTimer(member.graceTimer);
          member.graceTimer = null;
        }
        const old = member.conn;
        if (old !== null && old !== conn) {
          const oldState = this.connections.get(old);
          if (oldState !== undefined) oldState.member = null;
          old.close();
        }
        member.username = username;
        member.clanTag = clanTag;
      } else {
        if (party.members.length >= PARTY_MAX_SIZE) {
          this.reject(conn, "full");
          return;
        }
        member = this.newMember(username, clanTag);
        party.members.push(member);
      }
    }
    member.conn = conn;
    state.party = party;
    state.member = member;
    if (state.helloTimer !== null) {
      this.clearTimer(state.helloTimer);
      state.helloTimer = null;
    }
    this.broadcastState(party);
  }

  private newMember(username: string, clanTag: string | null): Member {
    const used = new Set<string>();
    for (const p of this.parties.values()) {
      for (const m of p.members) used.add(m.memberID);
    }
    let memberID = generateID();
    while (used.has(memberID)) memberID = generateID();
    return {
      memberID,
      resumeToken: resumeToken(),
      username,
      clanTag,
      conn: null,
      graceTimer: null,
    };
  }

  // Takes a member out for good. `reason` is told to the member when their
  // socket is still open (kick, leave); null when they already dropped.
  private removeMember(
    party: Party,
    member: Member,
    reason: PartyClosedReason | null,
  ): void {
    party.members = party.members.filter((m) => m !== member);
    if (member.graceTimer !== null) {
      this.clearTimer(member.graceTimer);
      member.graceTimer = null;
    }
    const conn = member.conn;
    member.conn = null;
    if (conn !== null) {
      const state = this.connections.get(conn);
      if (state !== undefined) {
        state.party = null;
        state.member = null;
      }
      if (reason !== null) this.sendTo(conn, { type: "closed", reason });
      conn.close();
    }
    if (party.members.length === 0) {
      this.parties.delete(party.id);
      return;
    }
    if (party.leaderID === member.memberID) {
      const next =
        party.members.find((m) => m.conn !== null) ?? party.members[0];
      party.leaderID = next.memberID;
    }
    this.broadcastState(party);
  }

  private reject(conn: PartyConnection, reason: PartyClosedReason): void {
    this.sendTo(conn, { type: "closed", reason });
    conn.close();
    this.onClose(conn);
  }

  private broadcastState(party: Party): void {
    const members = party.members.map((m) => ({
      memberID: m.memberID,
      username: m.username,
      clanTag: m.clanTag,
      connected: m.conn !== null,
    }));
    for (const m of party.members) {
      this.send(m, {
        type: "state",
        partyID: party.id,
        selfID: m.memberID,
        resumeToken: m.resumeToken,
        leaderID: party.leaderID,
        members,
        gameID: party.gameID,
      });
    }
  }

  private send(member: Member, msg: PartyServerMessage): void {
    if (member.conn !== null) this.sendTo(member.conn, msg);
  }

  private sendTo(conn: PartyConnection, msg: PartyServerMessage): void {
    try {
      conn.send(encodePartyServerMessage(msg));
    } catch {
      // A socket that is closing; its close handler cleans up.
    }
  }
}

// Hooks a WebSocketServer's connections up to the service.
export function servePartySockets(
  wss: WebSocketServer,
  service: PartyService,
): void {
  wss.on("connection", (ws: WebSocket) => {
    const conn: PartyConnection = {
      send: (data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      },
      close: () => ws.close(),
    };
    service.onOpen(conn);
    ws.on("message", (data: RawData, isBinary: boolean) => {
      if (!isBinary || !Buffer.isBuffer(data)) {
        service.onMessage(conn, new Uint8Array());
        return;
      }
      service.onMessage(conn, data);
    });
    ws.on("close", () => service.onClose(conn));
    ws.on("error", () => ws.close());
  });
}
