import { GameMapType, GameMode } from "../game/Game";
import { GameEnv } from "./Config";
import { DefaultServerConfig } from "./DefaultConfig";

export const preprodConfig = new (class extends DefaultServerConfig {
  env(): GameEnv {
    return GameEnv.Preprod;
  }
  lobbyMultiTabbing(map: GameMapType, mode: GameMode): boolean {
    return true;
  }
  numWorkers(): number {
    return 2;
  }
  jwtAudience(): string {
    return "openfront.dev";
  }
})();
