import { GameEnv } from "./Config";
import { DefaultServerConfig } from "./DefaultConfig";

export const prodConfig = new (class extends DefaultServerConfig {
  env(): GameEnv {
    return GameEnv.Prod;
  }
  jwtAudience(): string {
    return "openfront.io";
  }
  turnstileSiteKey(): string {
    return "0x4AAAAAACFLkaecN39lS8sk";
  }
})();
