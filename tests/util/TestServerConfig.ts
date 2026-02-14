import { JWK } from "jose";
import { GameEnv, ServerConfig } from "../../src/core/configuration/Config";
import { PublicGameModifiers } from "../../src/core/game/Game";
import { GameID } from "../../src/core/Schemas";

const TEST_JWK: JWK = {
  alg: "EdDSA",
  crv: "Ed25519",
  kty: "OKP",
  x: "test-public-key",
};

export class TestServerConfig implements ServerConfig {
  turnstileSiteKey(): string {
    return "test-turnstile-site-key";
  }

  turnstileSecretKey(): string {
    return "test-turnstile-secret-key";
  }

  apiKey(): string {
    return "test-api-key";
  }

  allowedFlares(): string[] | undefined {
    return undefined;
  }

  stripePublishableKey(): string {
    return "pk_test";
  }

  domain(): string {
    return "localhost";
  }

  subdomain(): string {
    return "";
  }

  jwtAudience(): string {
    return "localhost";
  }

  jwtIssuer(): string {
    return "http://localhost:8787";
  }

  jwkPublicKey(): Promise<JWK> {
    return Promise.resolve(TEST_JWK);
  }

  otelEnabled(): boolean {
    return false;
  }

  otelEndpoint(): string {
    return "";
  }

  otelAuthHeader(): string {
    return "";
  }

  turnIntervalMs(): number {
    return 100;
  }

  gameCreationRate(): number {
    return 60_000;
  }

  async lobbyMaxPlayers(): Promise<number> {
    return 64;
  }

  numWorkers(): number {
    return 1;
  }

  workerIndex(gameID: GameID): number {
    void gameID;
    return 0;
  }

  workerPath(gameID: GameID): string {
    return `w${this.workerIndex(gameID)}`;
  }

  workerPort(gameID: GameID): number {
    return this.workerPortByIndex(this.workerIndex(gameID));
  }

  workerPortByIndex(workerID: number): number {
    return 3001 + workerID;
  }

  env(): GameEnv {
    return GameEnv.Dev;
  }

  adminToken(): string {
    return "test-admin-token";
  }

  adminHeader(): string {
    return "x-admin-key";
  }

  gitCommit(): string {
    return "test-git-commit";
  }

  getRandomPublicGameModifiers(): PublicGameModifiers {
    return { isCompact: false, isRandomSpawn: false };
  }

  async supportsCompactMapForTeams(): Promise<boolean> {
    return true;
  }
}
