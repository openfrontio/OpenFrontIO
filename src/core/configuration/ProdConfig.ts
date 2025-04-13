import { GameEnv } from "./Config";
import { DefaultServerConfig } from "./DefaultConfig";

export const prodConfig = new (class extends DefaultServerConfig {
  r2Bucket(): string {
    return "openfront-staging";
  }
  adminToken(): string {
    return "WARNING_DEV_ADMIN_KEY_DO_NOT_USE_IN_PRODUCTION";
  }
  numWorkers(): number {
    return 6;
  }
  env(): GameEnv {
    return GameEnv.Prod;
  }
  discordRedirectURI(): string {
    return "https://openfront.io/auth/callback";
  }
})();
