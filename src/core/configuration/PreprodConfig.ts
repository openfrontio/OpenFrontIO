import { GameMapType, GameMode } from "../game/Game";
import { GameEnv } from "./Config";
import { DefaultServerConfig } from "./DefaultConfig";

export const preprodConfig = new (class extends DefaultServerConfig {
  env(): GameEnv {
    return GameEnv.Preprod;
  }
  discordRedirectURI(): string {
    return "https://openfront.dev/auth/callback";
  }
  lobbyMultiTabbing(map: GameMapType, mode: GameMode): boolean {
    return false;
  }
  numWorkers(): number {
    return 3;
  }
})();
