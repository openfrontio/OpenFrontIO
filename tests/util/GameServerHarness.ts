// Shared fixtures for tests that drive a GameServer directly.
//
// Every fixture here is schema-valid: ids are 8 alphanumerics, usernames are
// 3+ chars, clan tags 2–5. That matters because the server validates the start
// info and encodes every frame with the binary wire, both of which reject the
// "p1" / "creator-cid" placeholders older tests used — those tests could only
// pass by mocking the Schemas module. Use cid() to spell a readable id.

import { vi } from "vitest";
import {
  ClientMessage,
  GameConfig,
  PublicGameType,
  ServerMessage,
} from "../../src/core/Schemas";
import { Client } from "../../src/server/Client";
import { GameServer, GameServerDeps } from "../../src/server/GameServer";
import { type MatchTelemetryEmitter } from "../../src/server/telemetry/MatchTelemetry";
import { ZbContext } from "../../zbin";
import { clientFrame, decodeSentServerMessage, testGameConfig } from "./Wire";

// A schema-valid 8-char id from a readable tag: cid("p1") === "p1000000".
// Throws rather than silently mangling a tag that cannot be made valid. Zero
// padding means tags that differ only by trailing zeros ("c1", "c10") would
// alias, so every id produced is remembered per test module and a second tag
// mapping to an existing id throws instead of hiding a collision in a fixture.
const cidTags = new Map<string, string>();
export function cid(tag: string): string {
  if (!/^[A-Za-z0-9]{1,8}$/.test(tag)) {
    throw new Error(`cid: "${tag}" must be 1-8 alphanumerics`);
  }
  const id = tag.padEnd(8, "0");
  const prior = cidTags.get(id);
  if (prior !== undefined && prior !== tag) {
    throw new Error(`cid: "${tag}" collides with "${prior}" (both -> ${id})`);
  }
  cidTags.set(id, tag);
  return id;
}

export function mockLogger(): any {
  const log: any = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  log.child = vi.fn(() => log);
  return log;
}

export interface MockWs {
  on: (event: string, handler: (...args: any[]) => void) => void;
  removeAllListeners: (event?: string) => void;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
  readonly OPEN: 1;
  /** Fire a raw ws event ("close", "error", or "message" with a frame). */
  trigger: (event: string, ...args: any[]) => Promise<void>;
  /** Drive the socket the way a connected client would. */
  emit: (msg: ClientMessage) => Promise<void>;
  /** Queue a message using the listeners currently attached to the socket. */
  queue: (msg: ClientMessage) => Promise<void>;
  /** Every frame the server sent, decoded. Pass the game's dictionary context
   *  for frames sent after the start message (see Wire.ts). */
  sent: (ctx?: ZbContext) => ServerMessage[];
}

// A stateful stand-in for `ws.WebSocket`: records listeners so a test can fire
// "message" / "close", and captures sends so it can read what the server said.
// readyState leaves OPEN once the socket is closed from either side, as the
// real one does, so server guards like `readyState === OPEN` behave the same.
export function makeMockWs(): MockWs {
  const listeners = new Map<string, ((...args: any[]) => void)[]>();
  const CLOSED = 3;
  const ws: MockWs = {
    on: (event, handler) => {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
    },
    removeAllListeners: (event) => {
      if (event === undefined) listeners.clear();
      else listeners.delete(event);
    },
    send: vi.fn(),
    close: vi.fn(() => {
      ws.readyState = CLOSED;
    }),
    readyState: 1,
    OPEN: 1,
    trigger: async (event, ...args) => {
      if (event === "close") ws.readyState = CLOSED;
      for (const handler of listeners.get(event) ?? []) {
        await handler(...args);
      }
    },
    emit: (msg) => ws.trigger("message", clientFrame(msg)),
    queue: (msg) => {
      const handlers = [...(listeners.get("message") ?? [])];
      const frame = clientFrame(msg);
      return Promise.resolve().then(async () => {
        for (const handler of handlers) {
          await handler(frame);
        }
      });
    },
    sent: (ctx) =>
      ws.send.mock.calls.map(([frame]) => decodeSentServerMessage(frame, ctx)),
  };
  return ws;
}

export interface ClientOpts {
  clientID?: string;
  persistentID?: string;
  role?: string | null;
  ip?: string;
  username?: string;
  clanTag?: string | null;
  ws?: MockWs;
  cosmetics?: Client["cosmetics"];
  publicId?: string;
  friends?: string[];
  spectator?: boolean;
  trusted?: boolean;
}

let nextClient = 1;

// A joined-ready Client. Defaults are distinct per call (id, persistentID,
// IP): the winner and live-stats votes are weighted by unique IP, so a shared
// default would collapse every electorate to one voter. The default id is
// zero-padded on the left ("c0000001") so no two counter values alias.
export function makeClient(opts: ClientOpts = {}): Client {
  const n = nextClient++;
  const clientID = opts.clientID ?? `c${String(n).padStart(7, "0")}`;
  return new Client(
    clientID,
    opts.persistentID ?? `${clientID}-pid`,
    null,
    opts.role ?? null,
    undefined,
    opts.ip ?? `10.0.${Math.floor(n / 256)}.${n % 256}`,
    opts.username ?? `user_${clientID}`,
    opts.clanTag ?? null,
    (opts.ws ?? makeMockWs()) as any,
    opts.cosmetics,
    opts.publicId,
    opts.friends ?? [],
    opts.spectator ?? false,
    opts.trusted ?? false,
  );
}

export const mockWsOf = (client: Client): MockWs => client.ws as any;

export interface GameOpts {
  id?: string;
  log?: any;
  createdAt?: number;
  config?: Partial<GameConfig>;
  creatorPersistentID?: string;
  startsAt?: number;
  publicGameType?: PublicGameType;
  matchmakingTeams?: string[][];
  telemetry?: MatchTelemetryEmitter;
  buildHash?: string;
  // Overrides for what the game reaches outside itself for. By default the
  // archive upload and the tribe fetch are inert spies: pass your own
  // `archive` to read the record a game produced.
  deps?: Partial<GameServerDeps>;
}

// A private FFA lobby by default. `config` is layered over testGameConfig so a
// test names only what it cares about.
export function makeGame(opts: GameOpts = {}): GameServer {
  const deps: Partial<GameServerDeps> = {
    archive: vi.fn(async () => {}),
    fetchTribes: vi.fn(async () => []),
  };
  if (opts.telemetry !== undefined) deps.telemetry = opts.telemetry;
  if (opts.buildHash !== undefined) deps.telemetryBuildHash = opts.buildHash;
  Object.assign(deps, opts.deps);
  return new GameServer(
    {
      id: opts.id ?? cid("game"),
      log: opts.log ?? mockLogger(),
      createdAt: opts.createdAt ?? Date.now(),
      gameConfig: testGameConfig(opts.config),
      creatorPersistentID: opts.creatorPersistentID,
      startsAt: opts.startsAt,
      publicGameType: opts.publicGameType,
      matchmakingTeams: opts.matchmakingTeams,
    },
    deps,
  );
}

// Take the game through the real lobby -> game transition (what
// GameManager.tick does), instead of flipping private flags.
export function startGame(game: GameServer): void {
  game.prestart();
  game.start();
}
