import { JWK } from "jose";
import { GameEnv, ServerConfig } from "../../src/core/configuration/Config";
import { GameMapType } from "../../src/core/game/Game";
import { GameID } from "../../src/core/Schemas";

export class TestServerConfig implements ServerConfig {
  cloudflareConfigDir(): string {
    throw new Error("Method not implemented.");
  }
  domain(): string {
    throw new Error("Method not implemented.");
  }
  subdomain(): string {
    throw new Error("Method not implemented.");
  }
  cloudflareAccountId(): string {
    throw new Error("Method not implemented.");
  }
  cloudflareApiToken(): string {
    throw new Error("Method not implemented.");
  }
  jwtAudience(): string {
    throw new Error("Method not implemented.");
  }
  jwtIssuer(): string {
    throw new Error("Method not implemented.");
  }
  jwkPublicKey(): Promise<JWK> {
    throw new Error("Method not implemented.");
  }
  otelEnabled(): boolean {
    throw new Error("Method not implemented.");
  }
  otelEndpoint(): string {
    throw new Error("Method not implemented.");
  }
  otelUsername(): string {
    throw new Error("Method not implemented.");
  }
  otelPassword(): string {
    throw new Error("Method not implemented.");
  }
  region(): string {
    return "test";
  }
  turnIntervalMs(): number {
    throw new Error("Method not implemented.");
  }
  gameCreationRate(): number {
    throw new Error("Method not implemented.");
  }
  lobbyMaxPlayers(map: GameMapType): number {
    throw new Error("Method not implemented.");
  }
  numWorkers(): number {
    throw new Error("Method not implemented.");
  }
  workerIndex(gameID: GameID): number {
    throw new Error("Method not implemented.");
  }
  workerPath(gameID: GameID): string {
    throw new Error("Method not implemented.");
  }
  workerPort(gameID: GameID): number {
    throw new Error("Method not implemented.");
  }
  workerPortByIndex(workerID: number): number {
    throw new Error("Method not implemented.");
  }
  env(): GameEnv {
    throw new Error("Method not implemented.");
  }
  adminToken(): string {
    throw new Error("Method not implemented.");
  }
  adminHeader(): string {
    throw new Error("Method not implemented.");
  }
  gitCommit(): string {
    throw new Error("Method not implemented.");
  }
  r2Bucket(): string {
    throw new Error("Method not implemented.");
  }
  r2Endpoint(): string {
    throw new Error("Method not implemented.");
  }
  r2AccessKey(): string {
    throw new Error("Method not implemented.");
  }
  r2SecretKey(): string {
    throw new Error("Method not implemented.");
  }
}
