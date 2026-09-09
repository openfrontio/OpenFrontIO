import { JWK } from "jose";
import { z } from "zod";
import {
  ClusterColour,
  ClusterConfig,
  ClusterConfigSchema,
  ClusterEntry,
} from "../core/ClusterConfig";
import { GameEnv, parseGameEnv } from "../core/configuration/Config";
import { GameID } from "../core/Schemas";
import { generateGameID, simpleHash } from "../core/Util";

const JwksSchema = z.object({
  keys: z
    .object({
      alg: z.literal("EdDSA"),
      crv: z.literal("Ed25519"),
      kty: z.literal("OKP"),
      x: z.string(),
    })
    .array()
    .min(1),
});

export class ServerEnv {
  private static readonly gameEnv: GameEnv = parseGameEnv(process.env.GAME_ENV);
  private static publicKey: JWK | null = null;

  // Values that also flow to the client via index.html, but on the server
  // are read from process.env directly. Server code never reaches into
  // ClientEnv — that's reserved for the browser/worker hydrated path.
  //
  // TODO: the following methods are duplicated on ClientEnv. The two classes
  // read from different sources (process.env vs window.BOOTSTRAP_CONFIG) but
  // the derived logic is identical. Consolidate into a shared helper that
  // takes a source so we don't have to keep them in sync by hand.
  static env(): GameEnv {
    return ServerEnv.gameEnv;
  }
  static gameEnvName(): string {
    switch (ServerEnv.gameEnv) {
      case GameEnv.Dev:
        return "dev";
      case GameEnv.Preprod:
        return "staging";
      case GameEnv.Prod:
        return "prod";
    }
  }
  static numWorkers(): number {
    return ServerEnv.clusterSelf().entry.numWorkers;
  }
  static turnstileSiteKey(): string {
    const v = process.env.TURNSTILE_SITE_KEY;
    if (!v) {
      throw new Error("TURNSTILE_SITE_KEY not set");
    }
    return v;
  }
  static jwtAudience(): string {
    const v = process.env.DOMAIN;
    if (!v) {
      throw new Error("DOMAIN not set");
    }
    return v;
  }
  static instanceId(): string {
    return process.env.INSTANCE_ID ?? "";
  }
  static workerId(): number | undefined {
    const raw = process.env.WORKER_ID;
    if (raw === undefined) return undefined;
    return parseInt(raw, 10);
  }
  static hostname(): string {
    return process.env.HOSTNAME ?? "";
  }
  static host(): string {
    return process.env.HOST ?? "";
  }
  static cdnBase(): string {
    return process.env.CDN_BASE ?? "";
  }
  static jwtIssuer(): string {
    const audience = ServerEnv.jwtAudience();
    return audience === "localhost"
      ? "http://localhost:8787"
      : `https://api.${audience}`;
  }
  static async jwkPublicKey(): Promise<JWK> {
    if (ServerEnv.publicKey) return ServerEnv.publicKey;
    const jwksUrl = ServerEnv.jwtIssuer() + "/.well-known/jwks.json";
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
    ServerEnv.publicKey = result.data.keys[0];
    return ServerEnv.publicKey;
  }
  static turnIntervalMs(): number {
    return 100;
  }
  static gameCreationRate(): number {
    return ServerEnv.gameEnv === GameEnv.Dev ? 5 * 1000 : 2 * 60 * 1000;
  }
  static workerIndex(gameID: GameID): number {
    return simpleHash(gameID) % ServerEnv.numWorkers();
  }
  static workerPath(gameID: GameID): string {
    return `w${ServerEnv.workerIndex(gameID)}`;
  }
  static workerPort(gameID: GameID): number {
    return ServerEnv.workerPortByIndex(ServerEnv.workerIndex(gameID));
  }
  static workerPortByIndex(index: number): number {
    return 3001 + index;
  }
  // Mint a game id under this deployment's instance letter.
  static generateGameId(): GameID {
    return generateGameID(ServerEnv.clusterSelf().letter);
  }

  // Generate a game id that hashes to `workerId`, so requests for the game route
  // back to this worker. Rejection sampling: each id lands on a uniformly-random
  // worker, so the expected number of tries is numWorkers; the cap scales with
  // the worker count to keep the failure chance negligible (~e^-100). Returns
  // null if none was found (effectively never).
  static generateGameIdForWorker(workerId: number): GameID | null {
    const maxAttempts = ServerEnv.numWorkers() * 100;
    for (let i = 0; i < maxAttempts; i++) {
      const id = ServerEnv.generateGameId();
      if (ServerEnv.workerIndex(id) === workerId) return id;
    }
    return null;
  }

  // Server-only env values
  static domain(): string {
    return process.env.DOMAIN ?? "";
  }
  static subdomain(): string {
    return process.env.SUBDOMAIN ?? "";
  }
  // Host this deployment is reachable on directly (`blue.openfront.io`),
  // bypassing the load balancer. Injected into index.html as `serverHost` so
  // a tab keeps talking to the deployment that served it — including
  // reconnects mid-game — after the load balancer flips to the other
  // deployment. Undefined in dev (no SUBDOMAIN): the client falls back to
  // same-origin.
  static publicHost(): string | undefined {
    const subdomain = ServerEnv.subdomain();
    const domain = ServerEnv.domain();
    if (!subdomain || !domain) return undefined;
    return `${subdomain}.${domain}`;
  }
  // Cluster topology (docs/MultiServer.md): parsed from the CLUSTER_JSON env,
  // which replaced NUM_WORKERS. Absent or malformed refuses boot — a server
  // that doesn't know the fleet map can't mint ids or route games. Dev is the
  // exception: it defaults to a single-entry localhost map (kept in sync with
  // vite.config.ts's dev fallback) rather than making every dev script carry
  // JSON through cross-platform shell quoting. Cached by the raw string so
  // repeated reads don't re-parse but tests that stub the env still see
  // their value.
  static readonly DEV_DEFAULT_CLUSTER_JSON =
    '{"a":{"host":"localhost","colour":"blue","numWorkers":2}}';
  private static cachedClusterRaw: string | null = null;
  private static cachedCluster: ClusterConfig | null = null;
  static cluster(): ClusterConfig {
    const fromEnv = process.env.CLUSTER_JSON;
    const raw =
      fromEnv !== undefined && fromEnv.length > 0
        ? fromEnv
        : ServerEnv.gameEnv === GameEnv.Dev
          ? ServerEnv.DEV_DEFAULT_CLUSTER_JSON
          : undefined;
    if (raw === undefined) {
      throw new Error("CLUSTER_JSON not set");
    }
    if (raw === ServerEnv.cachedClusterRaw && ServerEnv.cachedCluster) {
      return ServerEnv.cachedCluster;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // Manual cause assignment: target ES2020's Error constructor predates
      // the options bag (same pattern as zbin/bytes.ts).
      const error = new Error(
        `CLUSTER_JSON is not valid JSON: ${e instanceof Error ? e.message : e}`,
      );
      (error as { cause?: unknown }).cause = e;
      throw error;
    }
    const result = ClusterConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Invalid CLUSTER_JSON: ${z.prettifyError(result.error)}`);
    }
    ServerEnv.cachedClusterRaw = raw;
    ServerEnv.cachedCluster = result.data;
    return result.data;
  }

  // This deployment's own cluster entry, found by host: SUBDOMAIN.DOMAIN, or
  // bare DOMAIN when SUBDOMAIN is empty (dev, standalone boxes). A server
  // whose host is not in the map refuses boot — it has no letter to mint
  // under.
  static clusterSelf(): { letter: string; entry: ClusterEntry } {
    const selfHost = ServerEnv.publicHost() ?? ServerEnv.domain();
    if (!selfHost) {
      throw new Error("DOMAIN not set, cannot resolve own cluster entry");
    }
    const cluster = ServerEnv.cluster();
    for (const [letter, entry] of Object.entries(cluster)) {
      if (entry.host === selfHost) return { letter, entry };
    }
    throw new Error(
      `Host ${selfHost} has no entry in CLUSTER_JSON (letters: ${Object.keys(cluster).join(", ")})`,
    );
  }

  // The first character of every game id this deployment mints.
  static instanceLetter(): string {
    return ServerEnv.clusterSelf().letter;
  }

  // Which blue/green pool this deployment belongs to (drain checks, PR 6).
  static colour(): ClusterColour {
    return ServerEnv.clusterSelf().entry.colour;
  }

  // Host players load the page from when it is a load balancer in front of
  // several deployments (`openfront.io` for blue/green). Unset for standalone
  // deployments (beta, staging branches), where the page host is publicHost.
  static siteHost(): string | undefined {
    const v = process.env.SITE_HOST;
    return v && v.length > 0 ? v : undefined;
  }
  static otelEnabled(): boolean {
    return (
      ServerEnv.gameEnv !== GameEnv.Dev &&
      Boolean(ServerEnv.otelEndpoint()) &&
      Boolean(ServerEnv.otelAuthHeader())
    );
  }
  static otelEndpoint(): string {
    return process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "";
  }
  static otelAuthHeader(): string {
    return process.env.OTEL_AUTH_HEADER ?? "";
  }
  static gitCommit(): string {
    const v = process.env.GIT_COMMIT;
    if (!v) {
      throw new Error("GIT_COMMIT not set");
    }
    return v;
  }
  static apiKey(): string {
    return process.env.API_KEY ?? "";
  }
  // Long-lived shared secret for the trusted admin bot HTTP API.
  // Undefined when unset, which disables the admin bot API entirely.
  static adminBotKey(): string | undefined {
    const v = process.env.ADMIN_BOT_API_KEY;
    return v && v.length > 0 ? v : undefined;
  }
  static adminBotHeader(): string {
    return "x-admin-bot-key";
  }
  static allowedFlares(): string[] | undefined {
    const raw = process.env.ALLOWED_FLARES;
    if (!raw) return undefined;
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
}
