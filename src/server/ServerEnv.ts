import { JWK } from "jose";
import { z } from "zod";
import { GameEnv, parseGameEnv } from "../core/configuration/Config";
import { Env } from "../core/configuration/Env";
import { GameID } from "../core/Schemas";
import { simpleHash } from "../core/Util";

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
  static numWorkers(): number {
    const raw = process.env.NUM_WORKERS;
    if (!raw) {
      throw new Error("NUM_WORKERS not set");
    }
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`Invalid NUM_WORKERS: ${raw}`);
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
  static jwtAudience(): string {
    const v = process.env.JWT_AUDIENCE;
    if (!v) {
      throw new Error("JWT_AUDIENCE not set");
    }
    return v;
  }
  static instanceId(): string {
    return process.env.INSTANCE_ID ?? "";
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

  // Server-only env values
  static domain(): string {
    return Env.DOMAIN ?? "";
  }
  static subdomain(): string {
    return Env.SUBDOMAIN ?? "";
  }
  static otelEnabled(): boolean {
    return (
      ServerEnv.gameEnv !== GameEnv.Dev &&
      Boolean(ServerEnv.otelEndpoint()) &&
      Boolean(ServerEnv.otelAuthHeader())
    );
  }
  static otelEndpoint(): string {
    return Env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "";
  }
  static otelAuthHeader(): string {
    return Env.OTEL_AUTH_HEADER ?? "";
  }
  static gitCommit(): string {
    return Env.GIT_COMMIT ?? "";
  }
  static apiKey(): string {
    return Env.API_KEY ?? "";
  }
  static adminHeader(): string {
    return "x-admin-key";
  }
  static adminToken(): string {
    const token = Env.ADMIN_TOKEN;
    if (!token) {
      throw new Error("ADMIN_TOKEN not set");
    }
    return token;
  }
  static allowedFlares(): string[] | undefined {
    const raw = Env.ALLOWED_FLARES;
    if (!raw) return undefined;
    return raw
      .split(",")
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);
  }
}
