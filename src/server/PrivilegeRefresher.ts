import { base64url } from "jose";
import { Logger } from "winston";
import { CosmeticsSchema } from "../core/CosmeticSchemas";
import {
  FailOpenPrivilegeChecker,
  PrivilegeChecker,
  PrivilegeCheckerImpl,
} from "./Privilege";

// Refreshes the privilege checker every 5 minutes.
// WARNING: This fails open if cosmetics.json is not available.
export class PrivilegeRefresher {
  private privilegeChecker: PrivilegeChecker | null = null;
  private readonly failOpenPrivilegeChecker: PrivilegeChecker =
    new FailOpenPrivilegeChecker();

  private readonly log: Logger;

  constructor(
    private readonly endpoint: string,
    parentLog: Logger,
    private readonly refreshInterval: number = 1000 * 60 * 3,
  ) {
    this.log = parentLog.child({ comp: "privilege-refresher" });
  }

  public async start() {
    this.log.info(
      `Starting privilege refresher with interval ${this.refreshInterval}`,
    );
    // Add some jitter to the initial load and the interval.
    setTimeout(() => this.loadPrivilegeChecker(), Math.random() * 1000);
    setInterval(
      () => this.loadPrivilegeChecker(),
      this.refreshInterval + Math.random() * 1000,
    );
  }

  public get(): PrivilegeChecker {
    return this.privilegeChecker ?? this.failOpenPrivilegeChecker;
  }

  private async loadPrivilegeChecker(): Promise<void> {
    this.log.info(`Loading privilege checker from ${this.endpoint}`);
    try {
      const response = await fetch(this.endpoint);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const cosmeticsData = await response.json();
      const result = CosmeticsSchema.safeParse(cosmeticsData);

      if (!result.success) {
        throw new Error(`Invalid cosmetics data: ${result.error.message}`);
      }

      this.privilegeChecker = new PrivilegeCheckerImpl(
        result.data,
        base64url.decode,
      );
      this.log.info("Privilege checker loaded successfully");
    } catch (error) {
      this.log.error(`Failed to fetch cosmetics from ${this.endpoint}:`, error);
      throw error;
    }
  }
}
