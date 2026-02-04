import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";

declare global {
  interface Window {
    turnstile: {
      render: (
        container: string,
        options: {
          sitekey: string;
          size: string;
          appearance: string;
          theme: string;
        },
      ) => string;
      execute: (
        widgetId: string,
        callbacks: {
          callback: (token: string) => void;
          "error-callback": (errorCode: string) => void;
        },
      ) => void;
      remove: (widgetId: string) => void;
    };
  }
}

interface TokenData {
  token: string;
  createdAt: number;
}

type ManagerState = "idle" | "fetching" | "ready";

const TOKEN_TTL_MS = 3 * 60 * 1000;
const POLL_INTERVAL_MS = 30 * 1000;
const TOKEN_REFRESH_BUFFER_MS = 30 * 1000; // Refresh 30 seconds before expiry

class TurnstileManager {
  private state: ManagerState = "idle";
  private currentToken: TokenData | null = null;
  private pendingPromise: Promise<TokenData | null> | null = null;
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  initialise(): void {
    console.log("Turnstile initialising");
    this.ensureTokenAvailable();
    this.startPolling();
  }

  destroy(): void {
    this.stopPolling();
  }

  /**
   * Get a token for use. This will:
   * - Return the cached token if valid
   * - Wait for a pending request if one is in progress
   * - Start a new request if needed
   */
  async getToken(): Promise<string | null> {
    const tokenData = await this.acquireToken();
    if (!tokenData) {
      return null;
    }

    // Check if token is still valid
    if (!this.isTokenValid(tokenData)) {
      console.log("TurnstileManager acquired token is expired, fetching new");
      // Token expired during wait, need to fetch fresh
      this.currentToken = null;
      this.state = "idle";
      const freshToken = await this.acquireToken();
      if (freshToken) {
        this.scheduleRefresh();
        return freshToken.token;
      }
      return null;
    }

    // Mark token as consumed and trigger background refresh
    this.scheduleRefresh();

    return tokenData.token;
  }

  hasValidToken(): boolean {
    return this.currentToken !== null && this.isTokenValid(this.currentToken);
  }

  isFetching(): boolean {
    return this.state === "fetching";
  }

  private async acquireToken(): Promise<TokenData | null> {
    // If we have a valid cached token, consume it immediately
    // (clear from cache so it can never be reused - tokens are single-use)
    if (this.currentToken && this.isTokenValid(this.currentToken)) {
      const token = this.currentToken;
      this.currentToken = null; // Immediately clear to prevent reuse
      console.log(`TurnstileManager consuming cached token: ${token.token}`);
      return token;
    }

    // If a fetch is already in progress, wait for it
    if (this.state === "fetching" && this.pendingPromise) {
      console.log("TurnstileManager waiting for pending token request");
      const token = await this.pendingPromise;
      // Clear if this is the current token (another waiter might have already cleared it)
      if (token && this.currentToken === token) {
        this.currentToken = null;
      }
      return token;
    }

    // Need to fetch a new token
    return this.fetchNewToken();
  }

  private async fetchNewToken(): Promise<TokenData | null> {
    console.log("TurnstileManager starting new token fetch");
    this.state = "fetching";

    this.pendingPromise = this.doFetchToken();

    try {
      const tokenData = await this.pendingPromise;
      this.currentToken = tokenData;
      this.state = tokenData ? "ready" : "idle";
      console.log(
        `TurnstileManager token fetch complete, state: ${this.state}`,
      );
      return tokenData;
    } catch (error) {
      console.error("TurnstileManager token fetch failed:", error);
      this.state = "idle";
      this.currentToken = null;
      return null;
    } finally {
      this.pendingPromise = null;
    }
  }

  private async doFetchToken(): Promise<TokenData | null> {
    try {
      // Wait for Turnstile script to load
      let attempts = 0;
      while (typeof window.turnstile === "undefined" && attempts < 100) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }

      if (typeof window.turnstile === "undefined") {
        console.error("TurnstileManager Turnstile script failed to load");
        return null;
      }

      const config = await getServerConfigFromClient();
      const widgetId = window.turnstile.render("#turnstile-container", {
        sitekey: config.turnstileSiteKey(),
        size: "normal",
        appearance: "interaction-only",
        theme: "light",
      });

      return new Promise((resolve) => {
        window.turnstile.execute(widgetId, {
          callback: (token: string) => {
            window.turnstile.remove(widgetId);
            console.log(`TurnstileManager token received: ${token}`);
            resolve({ token, createdAt: Date.now() });
          },
          "error-callback": (errorCode: string) => {
            window.turnstile.remove(widgetId);
            console.error(`TurnstileManager Turnstile error: ${errorCode}`);
            resolve(null);
          },
        });
      });
    } catch (error) {
      console.error("TurnstileManager Error in doFetchToken:", error);
      return null;
    }
  }

  private isTokenValid(tokenData: TokenData): boolean {
    return Date.now() < tokenData.createdAt + TOKEN_TTL_MS;
  }

  private isTokenNearExpiry(tokenData: TokenData): boolean {
    return (
      Date.now() > tokenData.createdAt + TOKEN_TTL_MS - TOKEN_REFRESH_BUFFER_MS
    );
  }

  private scheduleRefresh(): void {
    // Clear current token since it was just used
    this.currentToken = null;
    this.state = "idle";

    // Start fetching a new one in the background (don't await)
    console.log("TurnstileManager scheduling background token refresh");
    this.ensureTokenAvailable();
  }

  /**
   * Ensure we have a token available (or are fetching one)
   */
  private ensureTokenAvailable(): void {
    if (this.state === "fetching") {
      // Already fetching, nothing to do
      return;
    }

    if (this.currentToken && this.isTokenValid(this.currentToken)) {
      // Check if token is near expiry and refetch
      if (this.isTokenNearExpiry(this.currentToken)) {
        console.log("TurnstileManager token near expiry, refetching");
        this.fetchNewToken();
      }
      return;
    }

    // No valid token, start fetching
    this.fetchNewToken();
  }

  private startPolling(): void {
    if (this.pollIntervalId) {
      return;
    }

    this.pollIntervalId = setInterval(() => {
      this.ensureTokenAvailable();
    }, POLL_INTERVAL_MS);

    console.log("TurnstileManager polling started");
  }

  private stopPolling(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
      console.log("TurnstileManager polling stopped");
    }
  }
}

export const turnstileManager = new TurnstileManager();
