import { UserSettings } from "../game/UserSettings";
import { GameConfig } from "../Schemas";
import { Config, ServerConfig } from "./Config";
import { DefaultConfig } from "./DefaultConfig";
import { DevConfig, DevServerConfig } from "./DevConfig";
import { Env } from "./Env";
import { preprodConfig } from "./PreprodConfig";
import { prodConfig } from "./ProdConfig";

export enum GameLogicEnv {
  Dev = "dev",
  Default = "default",
}

export let cachedRuntimeClientServerConfig: ServerConfig | null = null;

declare global {
  interface Window {
    BOOTSTRAP_CONFIG?: {
      gameEnv?: string;
    };
  }
}

export async function getGameLogicConfig(
  gameConfig: GameConfig,
  userSettings: UserSettings | null,
  isReplay: boolean = false,
): Promise<Config> {
  const gameLogicEnv = getBuildTimeGameLogicEnv();
  const serverConfig = getServerConfigForGameLogicEnv(gameLogicEnv);

  switch (gameLogicEnv) {
    case GameLogicEnv.Dev:
      return new DevConfig(serverConfig, gameConfig, userSettings, isReplay);
    case GameLogicEnv.Default:
      return new DefaultConfig(
        serverConfig,
        gameConfig,
        userSettings,
        isReplay,
      );
    default:
      throw Error(`unsupported game logic environment: ${gameLogicEnv}`);
  }
}

export function getBuildTimeGameLogicEnv(): GameLogicEnv {
  const bundledGameEnv = process.env.GAME_ENV;

  switch (bundledGameEnv) {
    case "dev":
      return GameLogicEnv.Dev;
    case "staging":
    case "prod":
      return GameLogicEnv.Default;
    case undefined:
      throw new Error("Missing bundled game logic env");
    default:
      throw Error(`unsupported bundled game logic env: ${bundledGameEnv}`);
  }
}

export function getServerConfigForGameLogicEnv(
  gameLogicEnv: GameLogicEnv,
): ServerConfig {
  switch (gameLogicEnv) {
    case GameLogicEnv.Dev:
      return new DevServerConfig();
    case GameLogicEnv.Default:
      console.log("using default game logic config");
      return prodConfig;
    default:
      throw Error(`unsupported game logic environment: ${gameLogicEnv}`);
  }
}

export async function getRuntimeClientServerConfig(): Promise<ServerConfig> {
  if (cachedRuntimeClientServerConfig) {
    return cachedRuntimeClientServerConfig;
  }

  if (typeof window === "undefined") {
    throw new Error(
      "Runtime client server config is only available on the browser main thread",
    );
  }

  const runtimeClientEnv = window.BOOTSTRAP_CONFIG?.gameEnv;
  if (!runtimeClientEnv) {
    throw new Error("Missing runtime client server config");
  }

  cachedRuntimeClientServerConfig = getServerConfig(runtimeClientEnv);
  return cachedRuntimeClientServerConfig;
}
export function getServerConfigFromServer(): ServerConfig {
  const gameEnv = Env.GAME_ENV;
  return getServerConfig(gameEnv);
}
export function getServerConfig(gameEnv: string) {
  switch (gameEnv) {
    case "dev":
      console.log("using dev server config");
      return new DevServerConfig();
    case "staging":
      console.log("using preprod server config");
      return preprodConfig;
    case "prod":
      console.log("using prod server config");
      return prodConfig;
    default:
      throw Error(`unsupported server configuration: ${gameEnv}`);
  }
}

export function clearCachedRuntimeClientServerConfig(): void {
  cachedRuntimeClientServerConfig = null;
}
