import { GameEnv, ServerConfig } from "../../src/core/configuration/Config";
import { GameMapType } from "../../src/core/game/Game";
import { GameID } from "../../src/core/Schemas";

export class TestServerConfig implements ServerConfig {
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
  discordRedirectURI(): string {
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
