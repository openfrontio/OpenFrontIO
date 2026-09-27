import winston from "winston";
import WebSocket from "ws";
import { z } from "zod";
import { CloseCode } from "../core/CloseCodes";
import {
  PublicGameType,
  PublicGameTypeSchema,
  ScheduledPublicGameTypeSchema,
} from "../core/Schemas";
import { InternalGameInfo, InternalGameInfoSchema } from "./IPCBridgeSchema";
import { ServerEnv } from "./ServerEnv";

// The master's socket to its site's lobby coordinator (infra
// docs/lobby-coordinator.md): one Durable Object per site that merges every
// master's public lobbies into one roster per build and decides which lobby
// counts down next and which server creates the next one.
//
// This class owns only the transport: connect with backoff, say hello, send
// reports at the agreed cadence, parse what comes back, and answer "is the
// coordinator alive?" (a roster arrived recently). What to do with a roster
// or a command is MasterLobbyService's business, through `handlers`.

// A roster this old means the coordinator is gone: the master runs its own
// single-server scheduling until the next one lands. The coordinator pushes
// an unchanged roster at least every 2s, so this leaves two missed pushes.
export const COORDINATOR_STALE_MS = 5_000;
// The coordinator drops a master after 15s without a report; a socket that
// has delivered nothing for as long is dead on our side too (open sockets
// can be dead), so it is torn down and reconnected rather than waited on.
export const SOCKET_SILENCE_MS = 15_000;
// Reports: at most one a second while lobbies change, at least one every
// 5s as a heartbeat, whatever the workers report.
export const REPORT_MIN_INTERVAL_MS = 1_000;
export const REPORT_HEARTBEAT_MS = 5_000;
// Reconnect backoff: 1s doubling to 30s. A refusal that will not clear by
// itself (a 4xx on the upgrade, the site turning shared lobbies off, this
// letter bound to another host) is retried slowly instead; being replaced
// by a newer socket for the same letter is not retried at all.
export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
export const RECONNECT_SLOW_MS = 60_000;

// 4200–4299: coordinator close codes (LobbyCoordinator.ts, infra).
export const CoordinatorCloseCode = {
  Replaced: 4200,
  Disabled: 4201,
  BadHello: 4202,
  Silent: 4203,
  WrongHost: 4204,
} as const;

export interface CoordinatorHello {
  letter: string;
  host: string;
  version: string;
  numWorkers: number;
  instanceId?: string;
}

// Lobbies in a roster are other masters' InternalGameInfo; each is checked
// so one bad entry drops itself, not the roster, exactly as the master does
// with a worker's report.
const RosterSchema = z.object({
  type: z.literal("roster"),
  serverTime: z.number(),
  games: z.partialRecord(PublicGameTypeSchema, z.array(z.unknown())),
  delistGameIDs: z.array(z.string()).optional(),
});
const CreateGameSchema = z.object({
  type: z.literal("createGame"),
  publicGameType: ScheduledPublicGameTypeSchema,
  recentMaps: z.array(z.string()),
});
const UpdateLobbySchema = z.object({
  type: z.literal("updateLobby"),
  gameID: z.string(),
  startsAt: z.number(),
});
const CoordinatorMessageSchema = z.discriminatedUnion("type", [
  RosterSchema,
  CreateGameSchema,
  UpdateLobbySchema,
]);

export interface CoordinatorRoster {
  serverTime: number;
  games: Record<PublicGameType, InternalGameInfo[]>;
  delistGameIDs: string[];
}
export type CoordinatorCreateGame = z.infer<typeof CreateGameSchema>;
export type CoordinatorUpdateLobby = z.infer<typeof UpdateLobbySchema>;

export interface CoordinatorHandlers {
  onRoster(roster: CoordinatorRoster): void;
  onCreateGame(msg: CoordinatorCreateGame): void;
  onUpdateLobby(msg: CoordinatorUpdateLobby): void;
}

// The slice of `ws` the client uses, so tests can hand in a fake.
export interface CoordinatorSocket {
  on(event: "open", cb: () => void): unknown;
  on(event: "message", cb: (data: unknown) => void): unknown;
  on(event: "close", cb: (code: number, reason: Buffer) => void): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
  on(
    event: "unexpected-response",
    cb: (req: unknown, res: { statusCode?: number }) => void,
  ): unknown;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}
export type CoordinatorSocketFactory = (
  url: string,
  headers: Record<string, string>,
) => CoordinatorSocket;

export interface LobbyCoordinatorClientOptions {
  url: string;
  apiKey: string;
  hello: CoordinatorHello;
  handlers: CoordinatorHandlers;
  log: winston.Logger;
  connect?: CoordinatorSocketFactory;
  now?: () => number;
}

/** The coordinator URL for this server's site, or null under local dev. */
export function coordinatorUrl(site: string | undefined): string | null {
  if (site === undefined || ServerEnv.lobbyCoordinator() !== "api") {
    return null;
  }
  const base = ServerEnv.jwtIssuer().replace(/^http/, "ws");
  return `${base}/cluster/lobbies?site=${encodeURIComponent(site)}`;
}

export class LobbyCoordinatorClient {
  private readonly connect: CoordinatorSocketFactory;
  private readonly now: () => number;
  private socket: CoordinatorSocket | null = null;
  private open = false;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private backoffMs = RECONNECT_MIN_MS;
  private lastRosterAt = 0;
  // When the current socket was created (connect attempt) and when it
  // opened. The silence guard in tick() measures from the latest of these
  // and the last roster, so a fresh socket gets the full SOCKET_SILENCE_MS
  // to complete its handshake and deliver its first roster. A handshake
  // that never answers fires no event at all, so the guard must run while
  // still connecting. isCoordinated() deliberately looks at neither — only
  // a roster proves liveness.
  private attemptedAt = 0;
  private connectedAt = 0;
  // The latest lobbies the master gave us; sent on the next eligible tick.
  private pendingReport: { lobbies: InternalGameInfo[]; liveGames: number } = {
    lobbies: [],
    liveGames: 0,
  };
  private reportDirty = false;
  private lastReportAt = 0;

  constructor(private readonly opts: LobbyCoordinatorClientOptions) {
    this.connect =
      opts.connect ??
      ((url, headers) =>
        new WebSocket(url, {
          headers,
          // ws has no default: without it a handshake the far end never
          // answers hangs forever with no event. tick() guards this too.
          handshakeTimeout: SOCKET_SILENCE_MS,
        }) as unknown as CoordinatorSocket);
    this.now = opts.now ?? Date.now;
  }

  start(): void {
    if (this.tickTimer !== null) return;
    this.stopped = false;
    this.tickTimer = setInterval(() => this.tick(), REPORT_MIN_INTERVAL_MS);
    this.tickTimer.unref?.();
    this.openSocket();
  }

  stop(): void {
    this.stopped = true;
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    this.tickTimer = null;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close(CloseCode.Normal, "master stopping");
    this.socket = null;
    this.open = false;
  }

  /**
   * Whether a roster arrived recently enough to trust the coordinator with
   * scheduling. Deliberately not "is the socket open": an open socket can be
   * dead, and only the roster push proves the coordinator is alive.
   */
  isCoordinated(now: number = this.now()): boolean {
    return (
      this.lastRosterAt !== 0 && now - this.lastRosterAt < COORDINATOR_STALE_MS
    );
  }

  /** The master's own lobbies as of now. Coalesced; nothing is sent here. */
  report(lobbies: InternalGameInfo[], liveGames: number): void {
    this.pendingReport = { lobbies, liveGames };
    this.reportDirty = true;
  }

  private openSocket(): void {
    if (this.stopped) return;
    let socket: CoordinatorSocket;
    try {
      socket = this.connect(this.opts.url, { "x-api-key": this.opts.apiKey });
    } catch (error) {
      this.opts.log.warn("lobby coordinator: connect failed", { error });
      this.scheduleReconnect(this.nextBackoff());
      return;
    }
    this.socket = socket;
    this.attemptedAt = this.now();
    socket.on("open", () => {
      if (this.socket !== socket) return;
      this.open = true;
      this.connectedAt = this.now();
      // Backoff is NOT reset here: a socket that opens and is then closed
      // with BadHello or Silent must keep escalating. It resets on the
      // first roster, the point where the connection has proven useful.
      this.opts.log.info("lobby coordinator: connected", {
        url: this.opts.url,
      });
      this.send({ type: "hello", ...this.opts.hello });
      // The first report goes with the hello: the coordinator's roster needs
      // this master's lobbies to be complete, and a fresh socket has no
      // "last report" for the heartbeat to compare against.
      this.sendReport();
    });
    socket.on("message", (data) => {
      if (this.socket !== socket) return;
      this.handleMessage(String(data));
    });
    socket.on("unexpected-response", (_req, res) => {
      if (this.socket !== socket) return;
      // Any 4xx is a deliberate refusal that a retry will not change on its
      // own: 403 shared_lobbies_disabled (the site has the feature off),
      // 401 (wrong API key), 400 (bad site). Retry slowly rather than hammer
      // it; a 5xx is an outage and gets the ordinary backoff.
      const status = res.statusCode ?? 0;
      this.opts.log.warn("lobby coordinator: upgrade refused", { status });
      this.dropSocket(socket);
      // With a listener registered, ws leaves the aborted handshake to us:
      // terminate() in the CONNECTING state destroys the request, and
      // nothing else will (no `close` is emitted for a socket that never
      // opened).
      socket.terminate();
      const refused = status >= 400 && status < 500;
      this.scheduleReconnect(refused ? RECONNECT_SLOW_MS : this.nextBackoff());
    });
    socket.on("error", (err) => {
      if (this.socket !== socket) return;
      this.opts.log.warn("lobby coordinator: socket error", {
        error: err.message,
      });
      // `close` follows an error on ws; the reconnect is scheduled there.
    });
    socket.on("close", (code, reason) => {
      if (this.socket !== socket) return;
      this.opts.log.info("lobby coordinator: disconnected", {
        code,
        reason: String(reason),
      });
      this.dropSocket(socket);
      if (code === CoordinatorCloseCode.Replaced) {
        // A newer socket for this letter connected: another process owns it
        // now (normally our own successor during a restart). Reconnecting
        // would only take turns evicting each other.
        this.opts.log.warn(
          "lobby coordinator: replaced by a newer connection for this letter, not reconnecting",
        );
        return;
      }
      const slow =
        code === CoordinatorCloseCode.Disabled ||
        code === CoordinatorCloseCode.WrongHost;
      this.scheduleReconnect(slow ? RECONNECT_SLOW_MS : this.nextBackoff());
    });
  }

  private dropSocket(socket: CoordinatorSocket): void {
    if (this.socket === socket) this.socket = null;
    this.open = false;
  }

  private nextBackoff(): number {
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, RECONNECT_MAX_MS);
    return delay;
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.stopped || this.reconnectTimer !== null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delayMs);
    this.reconnectTimer.unref?.();
  }

  // Once a second: tear down a socket the coordinator has gone quiet on
  // (or never answered), then send a report if the lobbies changed or the
  // heartbeat is due.
  private tick(): void {
    if (this.socket === null) return;
    const now = this.now();
    const lastSign = Math.max(
      this.lastRosterAt,
      this.connectedAt,
      this.attemptedAt,
    );
    if (now - lastSign > SOCKET_SILENCE_MS) {
      this.opts.log.warn(
        this.open
          ? "lobby coordinator: no roster for 15s, reconnecting"
          : "lobby coordinator: handshake not answered in 15s, reconnecting",
      );
      const socket = this.socket;
      this.dropSocket(socket);
      socket.terminate();
      this.scheduleReconnect(this.nextBackoff());
      return;
    }
    if (!this.open) return;
    if (this.reportDirty || now - this.lastReportAt >= REPORT_HEARTBEAT_MS) {
      this.sendReport();
    }
  }

  private sendReport(): void {
    this.reportDirty = false;
    this.lastReportAt = this.now();
    this.send({ type: "report", ...this.pendingReport });
  }

  private send(msg: unknown): void {
    const socket = this.socket;
    if (socket === null || !this.open) return;
    try {
      socket.send(JSON.stringify(msg));
    } catch (error) {
      this.opts.log.warn("lobby coordinator: send failed", { error });
      this.dropSocket(socket);
      socket.terminate();
      this.scheduleReconnect(this.nextBackoff());
    }
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const result = CoordinatorMessageSchema.safeParse(parsed);
    if (!result.success) {
      this.opts.log.error("lobby coordinator: dropping invalid message");
      return;
    }
    const msg = result.data;
    switch (msg.type) {
      case "roster": {
        this.lastRosterAt = this.now();
        this.backoffMs = RECONNECT_MIN_MS;
        const games: Record<PublicGameType, InternalGameInfo[]> = {
          ffa: [],
          team: [],
          special: [],
          hosted: [],
        };
        for (const type of PublicGameTypeSchema.options) {
          for (const entry of msg.games[type] ?? []) {
            const lobby = InternalGameInfoSchema.safeParse(entry);
            if (lobby.success) games[type].push(lobby.data);
            else {
              this.opts.log.error(
                "lobby coordinator: dropping invalid lobby in roster",
              );
            }
          }
        }
        this.opts.handlers.onRoster({
          serverTime: msg.serverTime,
          games,
          delistGameIDs: msg.delistGameIDs ?? [],
        });
        break;
      }
      case "createGame":
        this.opts.handlers.onCreateGame(msg);
        break;
      case "updateLobby":
        this.opts.handlers.onUpdateLobby(msg);
        break;
    }
  }
}
