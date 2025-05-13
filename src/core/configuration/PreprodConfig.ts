import { GameMapType, GameMode } from "../game/Game";
import { GameEnv } from "./Config";
import { DefaultServerConfig } from "./DefaultConfig";

export const preprodConfig = new (class extends DefaultServerConfig {
  env(): GameEnv {
    return GameEnv.Preprod;
  }
  lobbyMultiTabbing(map: GameMapType, mode: GameMode): boolean {
    return false;
  }
  numWorkers(): number {
    return 3;
  }
  jwtAudience(): string {
    return "openfront.dev";
  }
})();
