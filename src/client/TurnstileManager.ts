import { GameEnv, ServerConfig } from "../core/configuration/Config";
import { GameType } from "../core/game/Game";
import type { GameStartInfo } from "../core/Schemas";

type TurnstileToken = { token: string; createdAt: number };

const TURNSTILE_TOKEN_TTL_MS = 3 * 60 * 1000;
const TURNSTILE_REFRESH_LEEWAY_MS = 30 * 1000;

export class TurnstileManager {
  private token: TurnstileToken | null = null;
  private tokenPromise: Promise<TurnstileToken | null> | null = null;
  private refreshTimeout: number | null = null;
  private warmupPromise: Promise<void> | null = null;

  constructor(private readonly getServerConfig: () => Promise<ServerConfig>) {}

  async warmup(): Promise<void> {
    if (this.warmupPromise) {
      return this.warmupPromise;
    }
    const warmupPromise = this.runWarmup();
    this.warmupPromise = warmupPromise;
    try {
      await warmupPromise;
    } finally {
      if (this.warmupPromise === warmupPromise) {
        this.warmupPromise = null;
      }
    }
  }

  private async runWarmup(): Promise<void> {
    try {
      const config = await this.getServerConfig();
      if (config.env() === GameEnv.Dev) {
        return;
      }
      if (
        this.token &&
        this.isTokenValid(this.token) &&
        this.timeUntilExpiry(this.token) > TURNSTILE_REFRESH_LEEWAY_MS
      ) {
        this.scheduleRefresh(this.token);
        return;
      }
      if (!this.tokenPromise) {
        await this.fetchAndStoreToken();
      }
    } catch (error) {
      console.warn("Turnstile warmup failed", error);
    }
  }

  async getTokenForJoin(gameStartInfo?: GameStartInfo): Promise<string | null> {
    const config = await this.getServerConfig();
    if (
      config.env() === GameEnv.Dev ||
      gameStartInfo?.config.gameType === GameType.Singleplayer
    ) {
      return null;
    }

    const token = await this.ensureToken();
    return token?.token ?? null;
  }

  private async ensureToken(): Promise<TurnstileToken | null> {
    if (this.token && this.isTokenValid(this.token)) {
      this.scheduleRefresh(this.token);
      return this.token;
    }

    if (this.tokenPromise) {
      try {
        await this.tokenPromise;
      } catch (error) {
        console.warn("Turnstile token fetch failed", error);
      }
      if (this.token && this.isTokenValid(this.token)) {
        this.scheduleRefresh(this.token);
        return this.token;
      }
      return null;
    }

    await this.fetchAndStoreToken();
    return this.token && this.isTokenValid(this.token) ? this.token : null;
  }

  private async fetchAndStoreToken() {
    const tokenPromise = this.fetchToken();
    this.tokenPromise = tokenPromise;
    try {
      const token = await tokenPromise;
      if (token && this.isTokenValid(token)) {
        this.token = token;
        this.scheduleRefresh(token);
      }
    } catch (error) {
      console.warn("Turnstile token fetch failed", error);
    } finally {
      if (this.tokenPromise === tokenPromise) {
        this.tokenPromise = null;
      }
    }
  }

  private scheduleRefresh(token: TurnstileToken) {
    if (this.refreshTimeout !== null) {
      clearTimeout(this.refreshTimeout);
    }
    const refreshInMs = Math.max(
      0,
      this.timeUntilExpiry(token) - TURNSTILE_REFRESH_LEEWAY_MS,
    );
    this.refreshTimeout = window.setTimeout(() => {
      this.refreshTimeout = null;
      this.warmup();
    }, refreshInMs);
  }

  private isTokenValid(token: TurnstileToken) {
    return Date.now() < token.createdAt + TURNSTILE_TOKEN_TTL_MS;
  }

  private timeUntilExpiry(token: TurnstileToken) {
    return token.createdAt + TURNSTILE_TOKEN_TTL_MS - Date.now();
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
    const widgetId = window.turnstile.render("#turnstile-container", {
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
