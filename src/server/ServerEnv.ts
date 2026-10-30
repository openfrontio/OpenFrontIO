
import { GameID } from "@openfront/engine-api/Schemas";
import { simpleHash } from "@openfront/engine-lib/Util";
import {
  ClusterConfig,
  InstanceLetterSchema,
} from "@openfront/shared/ClusterConfig";
import { GameEnv, parseGameEnv } from "@openfront/shared/configuration/Env";
import { generateGameID } from "@openfront/shared/SharedUtil";
import { JWK } from "jose";
import { z } from "zod";

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

  // Worker processes behind this server, from NUM_WORKERS.
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

  // OpenWar standalone authentication configuration.
  static turnstileSecretKey(): string {
    const value = process.env.TURNSTILE_SECRET_KEY;
    if (!value) {
      throw new Error("TURNSTILE_SECRET_KEY not set");
    }
    return value;
  }

  static standaloneMode(): boolean {
    return process.env.OPENWAR_STANDALONE === "true";
  }

  static guestJwtIssuer(): string {
    return "openwar:guest";
  }

  static guestJwtSecret(): Uint8Array {
    let value = process.env.OPENWAR_JWT_SECRET;

    if (!value && ServerEnv.gameEnv === GameEnv.Dev) {
      value = "openwar-development-only-secret-change-before-production";
    }

    if (!value) {
      throw new Error("OPENWAR_JWT_SECRET not set");
    }

    const secret = new TextEncoder().encode(value);

    if (secret.byteLength < 32) {
      throw new Error("OPENWAR_JWT_SECRET must be at least 32 bytes");
    }

    return secret;
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
    return ServerEnv.gameEnv === GameEnv.Dev
      ? 5 * 1000
      : 2 * 60 * 1000;
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

  // Generate a game id that hashes to the requested worker.
  static generateGameIdForWorker(workerId: number): GameID | null {
    const maxAttempts = ServerEnv.numWorkers() * 100;

    for (let i = 0; i < maxAttempts; i++) {
      const id = ServerEnv.generateGameId();
      if (ServerEnv.workerIndex(id) === workerId) return id;
    }

    return null;
  }

  // Server-only environment values.
  static domain(): string {
    return process.env.DOMAIN ?? "";
  }

  static subdomain(): string {
    return process.env.SUBDOMAIN ?? "";
  }

  static gameDomain(): string | undefined {
    const v = process.env.GAME_DOMAIN;
    return v && v.length > 0 ? v : undefined;
  }

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

  static publicHost(): string | undefined {
    const explicit = process.env.GAME_HOST;

    if (explicit && explicit.length > 0) return explicit;

    const subdomain = ServerEnv.subdomain();
    const domain = ServerEnv.gameDomain() ?? ServerEnv.domain();

    if (!subdomain || !domain) return undefined;

    return `${subdomain}.${domain}`;
  }

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

  static cluster(): ClusterConfig {
    return {
      [ServerEnv.instanceLetter()]: {
        host: ServerEnv.publicHost() ?? ServerEnv.domain(),
        numWorkers: ServerEnv.numWorkers(),
      },
    };
  }

  static siteHost(): string | undefined {
    const v = process.env.SITE_HOST;
    return v && v.length > 0 ? v : undefined;
  }

  static lobbyCoordinator(): "api" | "off" {
    return process.env.LOBBY_COORDINATOR === "api" ? "api" : "off";
  }

  private static cachedMachineRaw: string | null = null;
  private static cachedMachine: string | undefined = undefined;

  static machine(): string | undefined {
    const raw = process.env.MACHINE ?? "";

    if (raw === ServerEnv.cachedMachineRaw) {
      return ServerEnv.cachedMachine;
    }

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
