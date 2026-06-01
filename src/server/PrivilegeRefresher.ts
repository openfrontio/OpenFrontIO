import { base64url } from "jose";
import { Logger } from "winston";
import { ReservedClanTagsResponseSchema } from "../core/ClanApiSchemas";
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
  private cosmeticFlagUrls: Set<string> = new Set();

  private log: Logger;

  constructor(
    private cosmeticsEndpoint: string,
    private profaneWordsEndpoint: string,
    private apiKey: string,
    private reservedClanTagsEndpoint: string,
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

  public getCosmeticFlagUrls(): Set<string> {
    return this.cosmeticFlagUrls;
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

      const [
        cosmeticsResponse,
        profaneWordsResponse,
        reservedClanTagsResponse,
      ] = await Promise.all([
        fetchWithTimeout(this.cosmeticsEndpoint),
        fetchWithTimeout(this.profaneWordsEndpoint),
        fetchWithTimeout(this.reservedClanTagsEndpoint),
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

      // Reserved clan tags are critical: a missing or malformed list would
      // make every non-member tag look fictional and let impersonation
      // through. Throw so the previous (good) checker is retained instead.
      if (!reservedClanTagsResponse || !reservedClanTagsResponse.ok) {
        throw new Error(
          `Reserved clan tags HTTP error! status: ${reservedClanTagsResponse?.status ?? "network error"}`,
        );
      }
      const reservedClanTagsData = await reservedClanTagsResponse.json();
      const reservedClanTagsResult =
        ReservedClanTagsResponseSchema.safeParse(reservedClanTagsData);
      if (!reservedClanTagsResult.success) {
        throw new Error(
          `Invalid reserved clan tags data: ${reservedClanTagsResult.error.message}`,
        );
      }
      const reservedClanTags = new Set(
        reservedClanTagsResult.data.map((tag) => tag.toUpperCase()),
      );

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
        reservedClanTags,
      );
      this.cosmeticFlagUrls = new Set(
        Object.values(result.data.flags).map((f) => f.url),
      );
      this.log.info(
        `Privilege checker loaded successfully (${reservedClanTags.size} reserved clan tags)`,
      );
    } catch (error) {
      this.log.error(`Failed to load privilege checker:`, error);
      throw error;
    }
  }
}
