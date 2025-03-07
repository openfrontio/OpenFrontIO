import { GameEnv } from "./Config";
import { DefaultConfig, DefaultServerConfig } from "./DefaultConfig";

export const prodConfig = new (class extends DefaultServerConfig {
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
