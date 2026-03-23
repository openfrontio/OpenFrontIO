import { UserSettings } from "../game/UserSettings";
import { GameConfig } from "../Schemas";
import { Config, GameEnv, ServerConfig } from "./Config";
import { DefaultConfig } from "./DefaultConfig";
import { DevConfig, DevServerConfig } from "./DevConfig";
import { Env } from "./Env";
import { preprodConfig } from "./PreprodConfig";
import { prodConfig } from "./ProdConfig";

export let cachedSC: ServerConfig | null = null;

declare global {
  interface Window {
    BOOTSTRAP_CONFIG?: {
      gameEnv?: string;
    };
  }
}

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

  const bootstrapGameEnv = window.BOOTSTRAP_CONFIG?.gameEnv;
  if (!bootstrapGameEnv) {
    throw new Error("Missing bootstrap server config");
  }

  cachedSC = getServerConfig(bootstrapGameEnv);
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

export function clearCachedServerConfig(): void {
  cachedSC = null;
}
