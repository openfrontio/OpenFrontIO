import { GameEnv, ServerConfig } from "../core/configuration/Config";
import { GameType } from "../core/game/Game";
import { GameStartInfo } from "../core/Schemas";

type TurnstileToken = { token: string; createdAt: number };

const TURNSTILE_TOKEN_TTL_MS = 3 * 60 * 1000;
const TURNSTILE_REFRESH_LEEWAY_MS = 30 * 1000;
const TURNSTILE_CHECK_INTERVAL_MS = 100;

export class TurnstileManager {
  private token: TurnstileToken | null = null;
  private tokenPromise: Promise<TurnstileToken | null> | null = null;
  private checkInterval: number | null = null;
  private warmupPromise: Promise<void> | null = null;

  constructor(private readonly getServerConfig: () => Promise<ServerConfig>) {}

  async warmup(): Promise<void> {
    if (this.warmupPromise) {
      return this.warmupPromise;
    }
    this.warmupPromise = this.init();
    try {
      await this.warmupPromise;
    } catch (error) {
      console.warn("Turnstile warmup failed", error);
    } finally {
      this.warmupPromise = null;
    }
  }

  clearTokenAndRefresh(): void {
    this.token = null;
    // Interval will pick this up on the next tick.
  }

  async init(): Promise<void> {
    if (this.checkInterval !== null) return;
    await this.checkAndRefresh();
    this.checkInterval = window.setInterval(
      () => this.checkAndRefresh(),
      TURNSTILE_CHECK_INTERVAL_MS,
    );
  }

  async getToken(): Promise<string | null> {
    await this.init();

    if (
      this.token &&
      this.isTokenValid(this.token.createdAt + TURNSTILE_TOKEN_TTL_MS)
    ) {
      return this.token.token;
    }

    if (this.tokenPromise) {
      const existing = await this.tokenPromise;
      return existing &&
        this.isTokenValid(existing.createdAt + TURNSTILE_TOKEN_TTL_MS)
        ? existing.token
        : null;
    }

    const fetched = await this.fetchAndStoreToken();
    return fetched &&
      this.isTokenValid(fetched.createdAt + TURNSTILE_TOKEN_TTL_MS)
      ? fetched.token
      : null;
  }

  async getTokenForJoin(gameStartInfo?: GameStartInfo): Promise<string | null> {
    const config = await this.getServerConfig();
    if (
      config.env() === GameEnv.Dev ||
      gameStartInfo?.config.gameType === GameType.Singleplayer
    ) {
      return null;
    }
    const token = await this.getToken();
    if (token) {
      this.token = null;
    }
    return token;
  }

  private async checkAndRefresh() {
    const config = await this.getServerConfig();
    if (config.env() === GameEnv.Dev) return;

    const tokenIsFresh =
      this.token &&
      this.isTokenValid(this.token.createdAt + TURNSTILE_TOKEN_TTL_MS) &&
      this.timeUntilExpiry(this.token.createdAt + TURNSTILE_TOKEN_TTL_MS) >
        TURNSTILE_REFRESH_LEEWAY_MS;

    if (tokenIsFresh) return;
    if (this.tokenPromise) return;

    await this.fetchAndStoreToken();
  }

  private async fetchAndStoreToken(): Promise<TurnstileToken | null> {
    const fetchPromise = this.fetchToken();
    this.tokenPromise = fetchPromise;
    try {
      const token = await fetchPromise;
      if (
        token &&
        this.isTokenValid(token.createdAt + TURNSTILE_TOKEN_TTL_MS)
      ) {
        this.token = token;
      }
      return this.token;
    } catch (error) {
      console.warn("Turnstile token fetch failed", error);
      return null;
    } finally {
      this.tokenPromise = null;
    }
  }

  private isTokenValid(expiresAt: number) {
    return Date.now() < expiresAt;
  }

  private timeUntilExpiry(expiresAt: number) {
    return expiresAt - Date.now();
  }

  private async fetchToken(): Promise<TurnstileToken | null> {
    let attempts = 0;
    while (typeof window.turnstile === "undefined" && attempts < 100) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      attempts++;
    }

    if (typeof window.turnstile === "undefined") {
      throw new Error("Failed to load Turnstile script");
    }

    const config = await this.getServerConfig();
    const container = document.querySelector("#turnstile-container");
    if (!container) {
      console.warn("Turnstile container element not found");
      return null;
    }

    const widgetId = window.turnstile.render(container, {
      sitekey: config.turnstileSiteKey(),
      size: "normal",
      appearance: "interaction-only",
      theme: "light",
    });

    return new Promise((resolve, reject) => {
      window.turnstile.execute(widgetId, {
        callback: (token: string) => {
          window.turnstile.remove(widgetId);
          console.log(`Turnstile token received: ${token}`);
          resolve({ token, createdAt: Date.now() });
        },
        "error-callback": (errorCode: string) => {
          window.turnstile.remove(widgetId);
          console.error(`Turnstile error: ${errorCode}`);
          alert(`Turnstile error: ${errorCode}. Please refresh and try again.`);
          reject(new Error(`Turnstile failed: ${errorCode}`));
        },
      });
    });
  }
}
