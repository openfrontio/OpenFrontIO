import { UserSettings } from "../game/UserSettings";
import { GameConfig } from "../Schemas";
import { GameEnv, ServerConfig } from "./Config";
import { DefaultConfig, DefaultServerConfig } from "./DefaultConfig";

export class DevServerConfig extends DefaultServerConfig {
  turnstileSiteKey(): string {
    return "1x00000000000000000000AA";
  }

  turnstileSecretKey(): string {
    return "1x0000000000000000000000000000000AA";
  }

  adminToken(): string {
    return "WARNING_DEV_ADMIN_KEY_DO_NOT_USE_IN_PRODUCTION";
  }

  apiKey(): string {
    return "WARNING_DEV_API_KEY_DO_NOT_USE_IN_PRODUCTION";
  }

  env(): GameEnv {
    return GameEnv.Dev;
  }

  gameCreationRate(): number {
    return 5 * 1000;
  }

  numWorkers(): number {
    return 2;
  }
  jwtAudience(): string {
    return "localhost";
  }
  gitCommit(): string {
    return "DEV";
  }

  domain(): string {
    return "localhost";
  }

  subdomain(): string {
    return "";
  }
}

export class DevConfig extends DefaultConfig {
  constructor(
    sc: ServerConfig,
    gc: GameConfig,
    us: UserSettings | null,
    isReplay: boolean,
  ) {
    super(sc, gc, us, isReplay);
  }
}
