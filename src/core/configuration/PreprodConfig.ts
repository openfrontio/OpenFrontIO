import { GameEnv } from "./Config";
import { DefaultServerConfig } from "./DefaultConfig";

export const preprodConfig = new (class extends DefaultServerConfig {
  env(): GameEnv {
    return GameEnv.Preprod;
  }
  numWorkers(): number {
    if (process.env.SUBDOMAIN !== "main") {
      return 2;
    }
    return 3;
  }
  jwtAudience(): string {
    return "openfront.dev";
  }
})();
