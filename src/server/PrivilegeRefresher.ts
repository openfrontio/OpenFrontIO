import { base64url } from "jose";
import { Logger } from "winston";
import { CosmeticsSchema } from "../core/CosmeticSchemas";
import { startPolling } from "./PollingLoop";
import {
  FailOpenPrivilegeChecker,
  PrivilegeChecker,
  PrivilegeCheckerImpl,
} from "./Privilege";

// Refreshes the privilege checker every 3 minutes.
// WARNING: This fails open if cosmetics.json is not available.
export class PrivilegeRefresher {
  private privilegeChecker: PrivilegeChecker | null = null;
  private failOpenPrivilegeChecker: PrivilegeChecker =
    new FailOpenPrivilegeChecker();

  private log: Logger;

  constructor(
    private cosmeticsEndpoint: string,
    private profaneWordsEndpoint: string,
    private apiKey: string,
    parentLog: Logger,
    private refreshInterval: number = 1000 * 60 * 3,
  ) {
    this.log = parentLog.child({ comp: "privilege-refresher" });
  }

  public async start() {
    this.log.info(
      `Starting privilege refresher with interval ${this.refreshInterval}`,
    );
    startPolling(() => this.loadPrivilegeChecker(), this.refreshInterval);
  }

  public get(): PrivilegeChecker {
    return this.privilegeChecker ?? this.failOpenPrivilegeChecker;
  }

  private async loadPrivilegeChecker(): Promise<void> {
    this.log.info(`Loading privilege checker`);
    try {
      const fetchWithTimeout = async (url: string) => {
        try {
          return await fetch(url, {
            signal: AbortSignal.timeout(5000),
            headers: { "x-api-key": this.apiKey },
          });
        } catch (error) {
          this.log.warn(`Failed to fetch ${url}: ${error}`);
          return null;
        }
      };

      const [cosmeticsResponse, profaneWordsResponse] = await Promise.all([
        fetchWithTimeout(this.cosmeticsEndpoint),
        fetchWithTimeout(this.profaneWordsEndpoint),
      ]);

      if (!cosmeticsResponse || !cosmeticsResponse.ok) {
        throw new Error(
          `Cosmetics HTTP error! status: ${cosmeticsResponse?.status ?? "network error"}`,
        );
      }

      const cosmeticsData = await cosmeticsResponse.json();
      const result = CosmeticsSchema.safeParse(cosmeticsData);

      if (!result.success) {
        throw new Error(`Invalid cosmetics data: ${result.error.message}`);
      }

      let bannedWords: string[] = [];
      if (profaneWordsResponse && profaneWordsResponse.ok) {
        try {
          bannedWords = await profaneWordsResponse.json();
          this.log.info(
            `Loaded ${bannedWords.length} profane words from ${this.profaneWordsEndpoint}`,
          );
        } catch (error) {
          this.log.warn(`Failed to parse profane words JSON, using empty list`);
        }
      } else {
        this.log.warn(
          `Failed to fetch profane words (status ${profaneWordsResponse?.status ?? "network error"}), using empty list`,
        );
      }

      this.privilegeChecker = new PrivilegeCheckerImpl(
        result.data,
        base64url.decode,
        bannedWords,
      );
      this.log.info(`Privilege checker loaded successfully`);
    } catch (error) {
      this.log.error(`Failed to load privilege checker:`, error);
      throw error;
    }
  }
}
