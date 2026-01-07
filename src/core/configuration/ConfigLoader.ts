import { UserSettings } from "../game/UserSettings";
import { GameConfig } from "../Schemas";
import { Config, GameEnv, ServerConfig } from "./Config";
import { DefaultConfig } from "./DefaultConfig";
import { DevConfig, DevServerConfig } from "./DevConfig";
import { Env } from "./Env";
import { preprodConfig } from "./PreprodConfig";
import { prodConfig } from "./ProdConfig";
// Import to ensure global type declaration is available
import "../../client/ServerConfig";

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
      throw Error(`unsupported server configuration: ${Env.GAME_ENV}`);
  }
}
export async function getServerConfigFromClient(): Promise<ServerConfig> {
  if (cachedSC) {
    return cachedSC;
  }

  // Get config from window.SERVER_CONFIG (injected at build time)
  if (!window.SERVER_CONFIG) {
    throw new Error(
      "SERVER_CONFIG not found on window. Ensure the HTML template is configured correctly.",
    );
  }

  const { gameEnv } = window.SERVER_CONFIG;
  console.log("Server config loaded:", { gameEnv });

  cachedSC = getServerConfig(gameEnv);
  return cachedSC;
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
