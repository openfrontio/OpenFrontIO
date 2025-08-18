import { DefaultServerConfig } from "./DefaultConfig";
import { GameEnv } from "./Config";

export const prodConfig = new (class extends DefaultServerConfig {
  numWorkers(): number {
    return 20;
  }
  env(): GameEnv {
    return GameEnv.Prod;
  }
  jwtAudience(): string {
    return "openfront.io";
  }
})();
