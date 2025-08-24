import { GameEnv } from "./Config";
import { DefaultServerConfig } from "./DefaultConfig";

export const preprodConfig = new (class extends DefaultServerConfig {
  env(): GameEnv {
    return GameEnv.Preprod;
  }
  numWorkers(): number {
    return 2;
  }
  jwtAudience(): string {
    return "openfront.dev";
  }
  allowedFlares(): string[] | undefined {
    return [
      // "access:openfront.dev"
    ];
  }
})();
