import { UserSettings } from "../game/UserSettings";
import { GameConfig } from "../Schemas";
import { Config, GameEnv, ServerConfig } from "./Config";
import { DefaultConfig } from "./DefaultConfig";
import { DevConfig, DevServerConfig } from "./DevConfig";
import { Env } from "./Env";
import { preprodConfig } from "./PreprodConfig";
import { prodConfig } from "./ProdConfig";

export function getConfig(
  gameConfig: GameConfig,
  gameEnv: GameEnv,
  userSettings: UserSettings | null,
  isReplay: boolean = false,
): Config {
  switch (gameEnv) {
    case GameEnv.Dev:
      return new DevConfig(gameConfig, gameEnv, userSettings, isReplay);
    case GameEnv.Staging:
    case GameEnv.Prod:
      console.log("using prod config");
      return new DefaultConfig(gameConfig, gameEnv, userSettings, isReplay);
    default:
      throw Error(`unsupported server configuration: ${Env.GAME_ENV}`);
  }
}

export function getServerConfig(): ServerConfig {
  const gameEnv = Env.GAME_ENV;
  switch (gameEnv) {
    case GameEnv.Dev:
      console.log("using dev server config");
      return new DevServerConfig();
    case GameEnv.Staging:
      console.log("using preprod server config");
      return preprodConfig;
    case GameEnv.Prod:
      console.log("using prod server config");
      return prodConfig;
    default:
      throw Error(`unsupported server configuration: ${gameEnv}`);
  }
}
