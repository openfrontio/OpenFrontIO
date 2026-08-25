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
import { GameServer } from "../../src/server/GameServer";
import {
  noopMatchTelemetryEmitter,
  type MatchTelemetryEmitter,
} from "../../src/server/telemetry/MatchTelemetry";
import { ZbContext } from "../../zbin";
import { clientFrame, decodeSentServerMessage, testGameConfig } from "./Wire";

// A schema-valid 8-char id from a readable tag: cid("p1") === "p1000000".
// Throws rather than silently mangling a tag that cannot be made valid, so a
// collision between two tags cannot hide in a fixture.
export function cid(tag: string): string {
  if (!/^[A-Za-z0-9]{1,8}$/.test(tag)) {
    throw new Error(`cid: "${tag}" must be 1-8 alphanumerics`);
  }
  return tag.padEnd(8, "0");
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
  /** Every frame the server sent, decoded. Pass the game's dictionary context
   *  for frames sent after the start message (see Wire.ts). */
  sent: (ctx?: ZbContext) => ServerMessage[];
}

// A stateful stand-in for `ws.WebSocket`: records listeners so a test can fire
// "message" / "close", and captures sends so it can read what the server said.
export function makeMockWs(): MockWs {
  const listeners = new Map<string, ((...args: any[]) => void)[]>();
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
    close: vi.fn(),
    readyState: 1,
    OPEN: 1,
    trigger: async (event, ...args) => {
      for (const handler of listeners.get(event) ?? []) {
        await handler(...args);
      }
    },
    emit: (msg) => ws.trigger("message", clientFrame(msg)),
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
}

let nextClient = 1;

// A joined-ready Client. Defaults are distinct per call (id, persistentID,
// IP): the winner and live-stats votes are weighted by unique IP, so a shared
// default would collapse every electorate to one voter.
export function makeClient(opts: ClientOpts = {}): Client {
  const n = nextClient++;
  const clientID = opts.clientID ?? cid(`c${n}`);
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
}

// A private FFA lobby by default. `config` is layered over testGameConfig so a
// test names only what it cares about.
export function makeGame(opts: GameOpts = {}): GameServer {
  return new GameServer(
    opts.id ?? cid("game"),
    opts.log ?? mockLogger(),
    opts.createdAt ?? Date.now(),
    testGameConfig(opts.config),
    opts.creatorPersistentID,
    opts.startsAt,
    opts.publicGameType,
    opts.matchmakingTeams,
    opts.telemetry ?? noopMatchTelemetryEmitter,
    opts.buildHash ?? "DEV",
  );
}

// Take the game through the real lobby -> game transition (what
// GameManager.tick does), instead of flipping private flags.
export function startGame(game: GameServer): void {
  game.prestart();
  game.start();
}
