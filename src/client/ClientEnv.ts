import { JWK } from "jose";
import { z } from "zod";
import { ClusterConfig } from "../core/ClusterConfig";
import { GameID } from "../core/Schemas";
import { ServerList } from "../core/ServerList";
import { simpleHash } from "../core/Util";
import {
  GameEnv,
  JwksSchema,
  parseGameEnv,
} from "../core/configuration/Config";

export class ClientEnv {
  private static values: ClientEnvValues | null = null;
  private static publicKey: JWK | null = null;
  // The API-served server list (src/client/ServerList.ts), once fetched, and
  // the letter picked for new games from it. Null until a server was needed
  // and the list loaded; every accessor below then prefers it over the
  // page's own values, and falls back to them when it is absent, so the
  // client behaves exactly as today until the API serves a list.
  private static apiList: {
    list: ServerList;
    picked: string | null;
  } | null = null;

  /** Test-only. */
  static reset(): void {
    ClientEnv.values = null;
    ClientEnv.publicKey = null;
    ClientEnv.apiList = null;
  }

  // Called by src/client/ServerList.ts only. `picked` is the letter of the
  // open server chosen for this page's new games, or null when none runs
  // this build (existing games still resolve by letter; own-server calls
  // fall back to the page's values).
  static applyServerList(list: ServerList | null, picked: string | null) {
    ClientEnv.apiList = list === null ? null : { list, picked };
  }
  static serverListLoaded(): boolean {
    return ClientEnv.apiList !== null;
  }
  private static pickedServer(): { host: string; numWorkers: number } | null {
    const a = ClientEnv.apiList;
    if (a === null || a.picked === null) return null;
    return a.list.servers[a.picked] ?? null;
  }

  private static get(): ClientEnvValues {
    if (ClientEnv.values) return ClientEnv.values;
    if (typeof window === "undefined") {
      throw new Error("ClientEnv is only available on the browser main thread");
    }
    const bc = window.BOOTSTRAP_CONFIG;
    // Worker-count source: web shells inject the cluster map + own letter;
    // desktop shells predating the map still inject the numWorkers scalar.
    // Either shape must hydrate — the shell binary and the bundle it runs
    // update on separate schedules, so a new bundle under an old shell is a
    // live combination (PR 5 moves desktop to /cluster.json discovery).
    const hasWorkerSource =
      bc !== undefined &&
      ((bc.cluster !== undefined && bc.instanceLetter !== undefined) ||
        bc.numWorkers !== undefined);
    if (
      !bc ||
      bc.gameEnv === undefined ||
      !hasWorkerSource ||
      bc.turnstileSiteKey === undefined ||
      bc.jwtAudience === undefined ||
      bc.instanceId === undefined ||
      bc.gitCommit === undefined
    ) {
      throw new Error("Missing BOOTSTRAP_CONFIG");
    }
    ClientEnv.values = {
      gameEnv: parseGameEnv(bc.gameEnv),
      cluster: bc.cluster,
      instanceLetter: bc.instanceLetter,
      numWorkers: bc.numWorkers,
      turnstileSiteKey: bc.turnstileSiteKey,
      jwtAudience: bc.jwtAudience,
      instanceId: bc.instanceId,
      gitCommit: bc.gitCommit,
      // Optional: only the desktop app injects an explicit game-server host.
      // Absent on the web build (falls back to same-origin window.location).
      serverHost: bc.serverHost,
      siteHost: bc.siteHost,
    };
    return ClientEnv.values;
  }

  // TODO: the following methods are duplicated on ServerEnv. The two classes
  // read from different sources (window.BOOTSTRAP_CONFIG vs process.env) but
  // the derived logic is identical. Consolidate into a shared helper that
  // takes a source so we don't have to keep them in sync by hand.
  static env(): GameEnv {
    return ClientEnv.get().gameEnv;
  }
  // Worker count of the server this page talks to: own cluster entry when
  // the map was injected, the legacy scalar otherwise (old desktop shells).
  static numWorkers(): number {
    const picked = ClientEnv.pickedServer();
    if (picked !== null) return picked.numWorkers;
    const v = ClientEnv.get();
    if (v.cluster !== undefined && v.instanceLetter !== undefined) {
      const own = v.cluster[v.instanceLetter];
      if (own === undefined) {
        throw new Error(
          `BOOTSTRAP_CONFIG instanceLetter ${v.instanceLetter} not in cluster map`,
        );
      }
      return own.numWorkers;
    }
    if (v.numWorkers === undefined) {
      // Unreachable: get() requires one of the two shapes.
      throw new Error("BOOTSTRAP_CONFIG has no worker-count source");
    }
    return v.numWorkers;
  }
  // The fleet map and this page's own letter; undefined under an old desktop
  // shell that predates the map. PR 5 routes foreign game ids with these.
  static cluster(): ClusterConfig | undefined {
    return ClientEnv.get().cluster;
  }
  static instanceLetter(): string | undefined {
    return ClientEnv.get().instanceLetter;
  }
  static turnstileSiteKey(): string {
    return ClientEnv.get().turnstileSiteKey;
  }
  static jwtAudience(): string {
    return ClientEnv.get().jwtAudience;
  }
  static instanceId(): string {
    return ClientEnv.get().instanceId;
  }
  static gitCommit(): string {
    return ClientEnv.get().gitCommit;
  }
  static jwtIssuer(): string {
    const audience = ClientEnv.jwtAudience();
    return audience === "localhost"
      ? "http://localhost:8787"
      : `https://api.${audience}`;
  }
  static async jwkPublicKey(): Promise<JWK> {
    if (ClientEnv.publicKey) return ClientEnv.publicKey;
    const jwksUrl = ClientEnv.jwtIssuer() + "/.well-known/jwks.json";
    console.log(`Fetching JWKS from ${jwksUrl}`);
    const response = await fetch(jwksUrl);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`JWKS fetch failed: ${response.status} ${body}`);
    }
    const result = JwksSchema.safeParse(await response.json());
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Error parsing JWKS", error);
      throw new Error("Invalid JWKS");
    }
    ClientEnv.publicKey = result.data.keys[0];
    return ClientEnv.publicKey;
  }
  static turnIntervalMs(): number {
    return 100;
  }
  static gameCreationRate(): number {
    return ClientEnv.env() === GameEnv.Dev ? 5 * 1000 : 2 * 60 * 1000;
  }
  static workerIndex(gameID: GameID): number {
    return simpleHash(gameID) % ClientEnv.numWorkers();
  }
  static workerPath(gameID: GameID): string {
    return `w${ClientEnv.workerIndex(gameID)}`;
  }
  // Which deployment hosts this game (docs/MultiServer.md): a 10-char id's
  // leading letter names its server in the cluster map.
  static resolveGame(gameID: GameID): GameResolution {
    const a = ClientEnv.apiList;
    if (a !== null) {
      return resolveGameHost(gameID, a.list.servers, a.picked ?? undefined);
    }
    const v = ClientEnv.get();
    return resolveGameHost(gameID, v.cluster, v.instanceLetter);
  }
  // True when the id carries a letter this bundle's map doesn't know: the
  // map predates the letter's deployment. Join flows answer by redirecting
  // to the apex, whose shell carries the freshest map.
  static gameLetterUnknown(gameID: GameID): boolean {
    return ClientEnv.resolveGame(gameID).kind === "unknown-letter";
  }
  // Per-game WS/HTTP bases and worker path: same-origin (or the desktop
  // serverHost) for own and legacy games, the owning deployment's host —
  // always TLS, cross-host maps only exist deployed — for foreign letters.
  // An unknown letter resolves like "own" so plain fetches 404 into the
  // existing not-found paths; flows that can redirect check
  // gameLetterUnknown first.
  static gameWsBase(gameID: GameID): string {
    const r = ClientEnv.resolveGame(gameID);
    return r.kind === "cross" ? `wss://${r.host}` : ClientEnv.serverWsBase();
  }
  static gameHttpBase(gameID: GameID): string {
    const r = ClientEnv.resolveGame(gameID);
    return r.kind === "cross"
      ? `https://${r.host}`
      : ClientEnv.serverHttpBase();
  }
  // The worker path on the game's own server: a foreign deployment's worker
  // count comes from its cluster entry, not this server's.
  static gameWorkerPath(gameID: GameID): string {
    const r = ClientEnv.resolveGame(gameID);
    return r.kind === "cross"
      ? `w${simpleHash(gameID) % r.numWorkers}`
      : ClientEnv.workerPath(gameID);
  }
  // Explicit game-server host, injected by the desktop app (absent on web).
  static serverHost(): string | undefined {
    return ClientEnv.get().serverHost;
  }
  // The load-balancer apex this deployment sits behind — the unknown-letter
  // redirect target, whose shell always carries the freshest cluster map.
  // Absent for standalone deployments and desktop: no apex to bounce to.
  static siteHost(): string | undefined {
    return ClientEnv.get().siteHost;
  }
  // Origin (scheme + host, no trailing slash) of the game server that hosts the
  // public-lobby and in-game WebSockets. The lobby-list and game sockets append
  // their own worker path (e.g. `/w0/lobbies`, `/w0`).
  static serverWsBase(): string {
    const picked = ClientEnv.pickedServer();
    if (picked !== null) return `wss://${picked.host}`;
    return deriveServerWsBase(
      ClientEnv.serverHost(),
      window.location.protocol,
      window.location.host,
    );
  }
  // Origin (scheme + host, no trailing slash) of the same game server's HTTP
  // API — the worker routes under `/api` (create_game, game/:id/exists,
  // game/:id/listing). Callers append the path, worker prefix included where
  // the route needs one (e.g. `/w0/api/game/<id>`).
  //
  // NOT the account/shop API: that is a separate service on api.<audience>,
  // reached via getApiBase().
  static serverHttpBase(): string {
    const picked = ClientEnv.pickedServer();
    if (picked !== null) return `https://${picked.host}`;
    return deriveServerHttpBase(
      ClientEnv.serverHost(),
      window.location.protocol,
      window.location.host,
    );
  }
}

/**
 * Resolve which host serves the game, and whether to reach it over TLS.
 *
 * This is the single place that answers "which game server?". Both the
 * WebSocket base and the HTTP base derive from it so they cannot drift apart:
 * a lobby created over HTTP on one host is only playable over the socket on
 * that same host. A future multi-server client (picking a host at load time
 * from /cluster.json) changes this function and both bases follow.
 *
 * When an explicit `serverHost` is configured, target it over TLS. Only the
 * desktop app sets this: it loads the renderer from `app://openfront`, where
 * `window.location.host` is just "openfront" (not a real server), and the
 * game-server host is NOT derivable from the API audience — it is the bare
 * audience host in prod (`openfront.io`) but a branch-variable subdomain on
 * dev/staging (default `main.openfront.dev`, or `<branch>.openfront.dev`). So
 * the host is injected explicitly rather than derived.
 *
 * When no `serverHost` is configured — the normal web build — the game server
 * is same-origin as the document, so we keep the historical behaviour: scheme
 * and host come from `window.location`, which is what the previously relative
 * URLs resolved against anyway.
 */
function resolveServerOrigin(
  serverHost: string | undefined,
  locationProtocol: string,
  locationHost: string,
): { secure: boolean; host: string } {
  if (serverHost) {
    return { secure: true, host: serverHost };
  }
  return { secure: locationProtocol === "https:", host: locationHost };
}

export type GameResolution =
  | { kind: "own" }
  | { kind: "cross"; host: string; numWorkers: number }
  | { kind: "unknown-letter" };

/**
 * Which deployment hosts a game. Pure and exported for tests.
 *
 * - Legacy 8-char ids (and the never-minted 9-char length) carry no letter:
 *   they were minted by whichever server this page already talks to, so they
 *   stay on the own server.
 * - No cluster map means an old desktop shell that predates it: everything
 *   keeps routing to its configured serverHost, as before.
 * - A 10-char id's leading letter is looked up in the map. Own letter (or a
 *   letter the map doesn't know) is not a cross-host target; unknown letters
 *   get their own kind so join flows can redirect to the apex for a fresher
 *   map instead of silently 404ing.
 */
export function resolveGameHost(
  gameID: string,
  cluster: Record<string, { host: string; numWorkers: number }> | undefined,
  instanceLetter: string | undefined,
): GameResolution {
  if (gameID.length < 10) return { kind: "own" };
  if (cluster === undefined) return { kind: "own" };
  const letter = gameID[0];
  const entry = cluster[letter];
  if (entry === undefined) return { kind: "unknown-letter" };
  if (letter === instanceLetter) return { kind: "own" };
  return { kind: "cross", host: entry.host, numWorkers: entry.numWorkers };
}

/** Game-server WebSocket origin: see resolveServerOrigin. */
export function deriveServerWsBase(
  serverHost: string | undefined,
  locationProtocol: string,
  locationHost: string,
): string {
  const { secure, host } = resolveServerOrigin(
    serverHost,
    locationProtocol,
    locationHost,
  );
  return `${secure ? "wss:" : "ws:"}//${host}`;
}

/** Game-server HTTP origin: see resolveServerOrigin. */
export function deriveServerHttpBase(
  serverHost: string | undefined,
  locationProtocol: string,
  locationHost: string,
): string {
  const { secure, host } = resolveServerOrigin(
    serverHost,
    locationProtocol,
    locationHost,
  );
  return `${secure ? "https:" : "http:"}//${host}`;
}
/**
 * Values that flow from server → client via index.html. Set on the server from
 * process.env, then re-hydrated on the client from window.BOOTSTRAP_CONFIG.
 */

export interface ClientEnvValues {
  gameEnv: GameEnv;
  // One of the two worker-count sources is always present: cluster +
  // instanceLetter from a web shell, or the legacy numWorkers scalar from a
  // desktop shell that predates the cluster map.
  cluster?: ClusterConfig;
  instanceLetter?: string;
  numWorkers?: number;
  turnstileSiteKey: string;
  jwtAudience: string;
  instanceId: string;
  gitCommit: string;
  serverHost?: string;
  siteHost?: string;
}
