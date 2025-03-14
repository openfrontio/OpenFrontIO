import { GameEnv } from "./Config";
import { DefaultConfig, DefaultServerConfig } from "./DefaultConfig";

export const preprodConfig = new (class extends DefaultServerConfig {
  r2Bucket(): string {
    return "openfront-staging";
  }
  env(): GameEnv {
    return GameEnv.Preprod;
  }
  discordRedirectURI(): string {
    return "https://openfront.dev/auth/callback";
  }
  numWorkers(): number {
    return 3;
  }
})();
