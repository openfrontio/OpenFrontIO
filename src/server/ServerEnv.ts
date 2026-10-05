import { JWK } from "jose";
import { z } from "zod";
import { ClusterConfig, InstanceLetterSchema } from "../core/ClusterConfig";
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
  // Worker processes behind this server, from NUM_WORKERS (update.sh, from
  // the API registry). Frozen for the lifetime of every game id minted here:
  // ids route to workers by hash % numWorkers, so it may only change on a
  // deploy after this letter has fully drained. Dev defaults to 2, matching
  // vite.config.ts's proxy; a deployed server without it refuses boot.
  static numWorkers(): number {
    const raw = process.env.NUM_WORKERS;
    if (raw === undefined || raw.length === 0) {
      if (ServerEnv.gameEnv === GameEnv.Dev) return 2;
      throw new Error("NUM_WORKERS not set");
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`Invalid NUM_WORKERS: ${JSON.stringify(raw)}`);
    }
    return n;
  }
  static turnstileSiteKey(): string {
    const v = process.env.TURNSTILE_SITE_KEY;
    if (!v) {
      throw new Error("TURNSTILE_SITE_KEY not set");
    }
    return v;
  }
  // Optional, unlike turnstileSiteKey: a deployment without a key just keeps
  // the inline Stripe flow off (the store falls back to redirect checkout).
  static stripePublishableKey(): string | undefined {
    const v = process.env.STRIPE_PUBLISHABLE_KEY;
    if (!v) return undefined;
    return v;
  }
  // Optional: the Grafana Faro collector the browser client reports to.
  // Absent keeps client telemetry off. A public ingest URL, not a secret,
  // so it travels through BOOTSTRAP_CONFIG like the Stripe key.
  static faroCollectorUrl(): string | undefined {
    const v = process.env.FARO_COLLECTOR_URL;
    if (!v) return undefined;
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
    return generateGameID(ServerEnv.instanceLetter());
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
  // Domain the GAME hostnames live under, when it differs from the page
  // domain (docs/MultiServer.md, "Two hostnames per deployment"). Set on dev
  // so the static Worker can own `<subdomain>.<DOMAIN>` while sockets and
  // /api go straight to `<subdomain>.<GAME_DOMAIN>`. Unset — prod, local dev
  // — means the two collapse onto DOMAIN, which is today's behaviour.
  static gameDomain(): string | undefined {
    const v = process.env.GAME_DOMAIN;
    return v && v.length > 0 ? v : undefined;
  }
  // The PAGE host that pairs with a game host under GAME_DOMAIN:
  // `blue.server.openfront.dev` -> `blue.openfront.dev`. Undefined when
  // GAME_DOMAIN is unset (page and game host are one name) or the host is
  // not under it. A player who loads a colour's page directly, bypassing the
  // apex, arrives from exactly this origin, so CORS must know it.
  static pageHostFor(gameHost: string): string | undefined {
    const gameDomain = ServerEnv.gameDomain();
    const domain = ServerEnv.domain();
    if (gameDomain === undefined || !domain) return undefined;
    const suffix = `.${gameDomain}`;
    if (!gameHost.endsWith(suffix)) return undefined;
    const label = gameHost.slice(0, -suffix.length);
    if (!label || label.includes(".")) return undefined;
    return `${label}.${domain}`;
  }
  // The GAME host: the name this deployment is reachable on directly
  // (`blue.openfront.io`, or `main.server.openfront.dev` with GAME_DOMAIN),
  // bypassing the load balancer and the static Worker. Injected into
  // index.html as `serverHost` so a tab keeps talking to the deployment that
  // served it — including reconnects mid-game — after the load balancer flips
  // to the other deployment. This is NOT the host the page came from: that is
  // siteHost(), and with GAME_DOMAIN set the two are always different names.
  // Undefined in dev (no SUBDOMAIN): the client falls back to same-origin.
  //
  // GAME_HOST, when deploy.sh wrote one, is authoritative: it is the name the
  // cluster map actually carries for this deployment, and for a
  // machine-scoped entry (`blue.staging2.server.openfront.dev`, the machine
  // in the hostname so one colour can span boxes) it is not derivable from
  // SUBDOMAIN and GAME_DOMAIN alone. The derivation below is the standalone
  // shape and stays for env files written by hand.
  static publicHost(): string | undefined {
    const explicit = process.env.GAME_HOST;
    if (explicit && explicit.length > 0) return explicit;
    const subdomain = ServerEnv.subdomain();
    const domain = ServerEnv.gameDomain() ?? ServerEnv.domain();
    if (!subdomain || !domain) return undefined;
    return `${subdomain}.${domain}`;
  }
  // This server's instance letter, from INSTANCE_LETTER (update.sh, from the
  // API registry): the first character of every game id it mints, which is
  // how a game id names its server for the rest of its life (docs/
  // MultiServer.md). Letters are append-only per site and the API registry
  // binds each to its host permanently, so a hand-set letter that belongs to
  // another host is refused at check-in, not here — but a malformed one
  // refuses boot, since ids minted under it would validate nowhere. Dev
  // defaults to "a".
  static instanceLetter(): string {
    const raw = process.env.INSTANCE_LETTER;
    if (raw === undefined || raw.length === 0) {
      if (ServerEnv.gameEnv === GameEnv.Dev) return "a";
      throw new Error("INSTANCE_LETTER not set");
    }
    const result = InstanceLetterSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(
        `Invalid INSTANCE_LETTER: ${JSON.stringify(raw)} (one lowercase letter)`,
      );
    }
    return result.data;
  }

  // The one-entry map naming this server, in the shape the page reads
  // (ClusterConfig.ts): its letter, its game host (bare
  // DOMAIN under local dev, where there is no public host) and its worker
  // count. This used to be the whole fleet, read from CLUSTER_JSON; the
  // fleet is the API registry's list now and this is only the page's own
  // server for when that list is unavailable.
  static cluster(): ClusterConfig {
    return {
      [ServerEnv.instanceLetter()]: {
        host: ServerEnv.publicHost() ?? ServerEnv.domain(),
        numWorkers: ServerEnv.numWorkers(),
      },
    };
  }

  // The page host: SITE_HOST. Behind a load balancer that is the apex
  // (`openfront.io` for blue/green); with GAME_DOMAIN it is
  // `<subdomain>.<DOMAIN>`, the name the static Worker serves the page on.
  // Unset only for old-style standalone deploys (beta, staging branches) and
  // local dev, where the page host and the game host coincide and publicHost
  // is both.
  static siteHost(): string | undefined {
    const v = process.env.SITE_HOST;
    return v && v.length > 0 ? v : undefined;
  }
  // Whether the master joins its site's shared public-lobby roster
  // (LobbyCoordinatorClient.ts, infra docs/lobby-coordinator.md). "api"
  // connects to the API's coordinator and lets it schedule this site's public
  // lobbies; "off", anything else, or none keeps single-server scheduling,
  // so a deploy that doesn't set it is unchanged on the wire. "off" exists
  // so a GitHub environment can override a repo-level "api" explicitly.
  static lobbyCoordinator(): "api" | "off" {
    return process.env.LOBBY_COORDINATOR === "api" ? "api" : "off";
  }
  // The machine this container runs on — `falk2`, `nbg2`, `staging`: the
  // second argument to deploy.sh, which writes it into the container's env as
  // MACHINE. Reported at check-in (ClusterCheckin.ts) so the registry can hold
  // a site to at most one OPEN server per machine (OPE-455): blue and green
  // often share a box, and a colour flip that lands on the same machine buys
  // no redundancy. Nothing in this repo reads it back.
  //
  // Held to the shape deploy.sh already demands of a machine argument —
  // letters, digits and hyphens, at most a hostname label's 63 octets — and
  // anything else is dropped with one warning rather than sent. The check-in
  // body has to stay something the registry will accept, so a fat-fingered
  // MACHINE must cost a stray field, never the registration. Cached by the
  // raw value so the 10s check-in doesn't re-warn on every beat, while a test
  // that stubs the env still sees its own value.
  private static cachedMachineRaw: string | null = null;
  private static cachedMachine: string | undefined = undefined;
  static machine(): string | undefined {
    const raw = process.env.MACHINE ?? "";
    if (raw === ServerEnv.cachedMachineRaw) return ServerEnv.cachedMachine;
    ServerEnv.cachedMachineRaw = raw;
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      ServerEnv.cachedMachine = undefined;
    } else if (/^[a-zA-Z0-9-]{1,63}$/.test(trimmed)) {
      ServerEnv.cachedMachine = trimmed;
    } else {
      console.warn(`Ignoring malformed MACHINE: ${JSON.stringify(trimmed)}`);
      ServerEnv.cachedMachine = undefined;
    }
    return ServerEnv.cachedMachine;
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
