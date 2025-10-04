import { UnitInfo, UnitType } from "../game/Game";
import { UserSettings } from "../game/UserSettings";
import { GameConfig } from "../Schemas";
import { GameEnv, ServerConfig } from "./Config";
import { DefaultConfig, DefaultServerConfig } from "./DefaultConfig";

export class DevServerConfig extends DefaultServerConfig {
  private apiDomainHost(): string | null {
    const raw = process.env.API_DOMAIN;
    if (!raw || raw.length === 0) {
      return null;
    }
    const trimmed = raw.replace(/^https?:\/\//, "").split("/")[0];
    return trimmed.length > 0 ? trimmed : null;
  }

  private apiBaseDomain(): string | null {
    const host = this.apiDomainHost();
    if (!host) {
      return null;
    }
    const parts = host.split(".");
    if (parts.length >= 2) {
      return parts.slice(-2).join(".");
    }
    return host;
  }

  private apiSubdomain(): string | null {
    const host = this.apiDomainHost();
    if (!host) {
      return null;
    }
    const parts = host.split(".");
    if (parts.length <= 2) {
      return parts.length === 1 ? parts[0] : "";
    }
    return parts.slice(0, parts.length - 2).join(".");
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

  samWarheadHittingChance(): number {
    return 1;
  }

  samHittingChance(): number {
    return 1;
  }

  numWorkers(): number {
    return 2;
  }
  jwtAudience(): string {
    const base = this.apiBaseDomain();
    return base ?? "localhost";
  }
  gitCommit(): string {
    return "DEV";
  }

  domain(): string {
    const base = this.apiBaseDomain();
    return base ?? "localhost";
  }

  subdomain(): string {
    const sub = this.apiSubdomain();
    return sub ?? "";
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

  // numSpawnPhaseTurns(): number {
  //   return this.gameConfig().gameType == GameType.Singleplayer ? 70 : 100;
  //   // return 100
  // }

  unitInfo(type: UnitType): UnitInfo {
    const info = super.unitInfo(type);
    const oldCost = info.cost;
    // info.cost = (p: Player) => oldCost(p) / 1000000000;
    return info;
  }

  // tradeShipSpawnRate(): number {
  //   return 10;
  // }

  // percentageTilesOwnedToWin(): number {
  //     return 1
  // }

  // boatMaxDistance(): number {
  //     return 5000
  // }

  //   numBots(): number {
  //     return 0;
  //   }
  //   spawnNPCs(): boolean {
  //     return false;
  //   }
}
