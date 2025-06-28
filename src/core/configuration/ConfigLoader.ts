import { CapacitorHttp } from "@capacitor/core";
import { UserSettings } from "../game/UserSettings";
import { GameConfig } from "../Schemas";
import { Config, GameEnv, ServerConfig } from "./Config";
import { DefaultConfig } from "./DefaultConfig";
import { DevConfig, DevServerConfig } from "./DevConfig";
import { preprodConfig } from "./PreprodConfig";
import { prodConfig } from "./ProdConfig";

export let cachedSC: ServerConfig | null = null;

export async function getConfig(
  gameConfig: GameConfig,
  userSettings: UserSettings | null,
  isReplay: boolean = false,
): Promise<Config> {
  const sc = await getServerConfigFromClient();
  switch (sc.env()) {
    case GameEnv.Dev:
      return new DevConfig(sc, gameConfig, userSettings, isReplay);
    case GameEnv.Preprod:
    case GameEnv.Prod:
      console.log("using prod config");
      return new DefaultConfig(sc, gameConfig, userSettings, isReplay);
    default:
      throw Error(`unsupported server configuration: ${process.env.GAME_ENV}`);
  }
}
export async function getServerConfigFromClient(): Promise<ServerConfig> {
  if (cachedSC) {
    return cachedSC;
  }

  try {
    const response = await CapacitorHttp.get({
      url: `${process.env.APP_BASE_URL || ""}/api/env`,
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.data) {
      throw new Error(`Failed to fetch server config: ${response.status}`);
    }

    // Check if response is HTML (error case)
    const dataStr =
      typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data);
    if (dataStr.includes("<!doctype html>") || dataStr.includes("<html")) {
      console.warn(
        "Server returned HTML instead of JSON, falling back to environment variable",
      );
      return getServerConfigFromServer();
    }

    const config = response.data;

    // Validate that we got the expected structure
    if (!config || typeof config.game_env !== "string") {
      console.warn(
        "Invalid config structure received, falling back to environment variable",
      );
      return getServerConfigFromServer();
    }

    console.log("Server config loaded:", config);

    cachedSC = getServerConfig(config.game_env);
    return cachedSC;
  } catch (error) {
    console.warn(
      "Error fetching server config from API, falling back to environment variable:",
      error,
    );
    return getServerConfigFromServer();
  }
}
export function getServerConfigFromServer(): ServerConfig {
  const gameEnv = process.env.GAME_ENV ?? "dev";
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
