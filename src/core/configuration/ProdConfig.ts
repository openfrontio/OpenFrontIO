import { GameMapType, GameMode } from "../game/Game";
import { GameEnv } from "./Config";
import { DefaultServerConfig } from "./DefaultConfig";

export const prodConfig = new (class extends DefaultServerConfig {
  numWorkers(): number {
    return 6;
  }
  env(): GameEnv {
    return GameEnv.Prod;
  }
  lobbyMultiTabbing(map: GameMapType, mode: GameMode): boolean {
    return false;
  }
  discordRedirectURI(): string {
    return "https://openfront.io/auth/callback";
  }
})();
