import { ClientEnv } from "./ClientEnv";

declare global {
  interface Window {
    turnstile: any;
  }
}

// Cloudflare expires a token 300s after it is issued, and every token is
// single-use. Treat one as spent well before that so a token handed to a join
// still has headroom for the socket handshake and the server's siteverify.
const TOKEN_FRESH_MS = 4 * 60 * 1000;
// Delay before retrying a mint that failed (offline, blocked script, challenge
// error). Long enough not to hammer Cloudflare, short enough that a transient
// failure doesn't leave the session cold until the next join.
const MINT_RETRY_MS = 60 * 1000;

export type TurnstileToken = { token: string; createdAt: number };

/**
 * Mints one Turnstile token: renders a widget, runs the challenge, tears the
 * widget down again. This is the slow part — the script has to be loaded, the
 * widget iframe created and the challenge round trip completed, which is
 * seconds on a bad connection. Nothing that blocks a player should call it
 * directly; go through {@link TurnstileTokenProvider} so the cost is paid in
 * the background instead of at join time.
 */
export async function mintTurnstileToken(): Promise<TurnstileToken> {
  // Wait for Turnstile script to load (handles slow connections)
  let attempts = 0;
  while (typeof window.turnstile === "undefined" && attempts < 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    attempts++;
  }

  if (typeof window.turnstile === "undefined") {
    throw new Error("Failed to load Turnstile script");
  }

  const widgetId = window.turnstile.render("#turnstile-container", {
    sitekey: ClientEnv.turnstileSiteKey(),
    size: "normal",
    appearance: "interaction-only",
    theme: "light",
  });

  return new Promise((resolve, reject) => {
    window.turnstile.execute(widgetId, {
      callback: (token: string) => {
        window.turnstile.remove(widgetId);
        resolve({ token, createdAt: Date.now() });
      },
      "error-callback": (errorCode: string) => {
        window.turnstile.remove(widgetId);
        reject(new Error(`Turnstile failed: ${errorCode}`));
      },
    });
  });
}

/**
 * Keeps an unused, unexpired Turnstile token ready at all times so joining a
 * multiplayer game never blocks on minting one.
 *
 * The provider mints on three triggers: when {@link start} is called (page
 * load), as soon as a token is consumed by {@link take}, and on a timer before
 * the cached token ages out of {@link TOKEN_FRESH_MS}. A token is only ever
 * handed out once — Cloudflare rejects a replayed one.
 *
 * Background minting is suspended while {@link setActive} is false. The widget
 * is `interaction-only`, so a challenge that needs a click would otherwise pop
 * a Turnstile box over a running game.
 */
export class TurnstileTokenProvider {
  private cached: TurnstileToken | null = null;
  private inflight: Promise<TurnstileToken> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private active = true;

  constructor(
    private mint: () => Promise<TurnstileToken> = mintTurnstileToken,
  ) {}

  /** Begins keeping a token warm. Safe to call more than once. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.warm();
  }

  /** Suspends (false) or resumes (true) background minting. */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active) {
      this.warm();
    } else {
      this.clearTimer();
    }
  }

  /**
   * Returns a token to send with a join, or null if one could not be minted.
   * Consumes the cached token and immediately starts minting its replacement,
   * so back-to-back joins are just as fast as the first.
   */
  async take(): Promise<string | null> {
    const cached = this.cached;
    this.cached = null;
    if (cached !== null && isFresh(cached)) {
      this.warm();
      return cached.token;
    }

    let token: string | null = null;
    try {
      token = (await this.mintOnce()).token;
    } catch (e) {
      console.error("Failed to get Turnstile token", e);
      alert(
        `Turnstile error: ${e instanceof Error ? e.message : e}. Please refresh and try again.`,
      );
    }
    // Whatever mintOnce cached is the token we just handed out.
    this.cached = null;
    this.warm();
    return token;
  }

  private warm(): void {
    if (!this.started || !this.active) return;
    if (this.cached !== null && isFresh(this.cached)) {
      this.schedule(this.cached.createdAt + TOKEN_FRESH_MS - Date.now());
      return;
    }
    if (this.inflight !== null) return;
    this.mintOnce().then(
      () => this.schedule(TOKEN_FRESH_MS),
      (e) => {
        console.warn("Turnstile prefetch failed, will retry", e);
        this.schedule(MINT_RETRY_MS);
      },
    );
  }

  private mintOnce(): Promise<TurnstileToken> {
    const inflight = this.inflight;
    if (inflight !== null) return inflight;
    const minted = this.mint().then(
      (token) => {
        if (this.inflight === minted) this.inflight = null;
        this.cached = token;
        return token;
      },
      (e) => {
        if (this.inflight === minted) this.inflight = null;
        throw e;
      },
    );
    this.inflight = minted;
    return minted;
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.warm();
      },
      Math.max(0, delayMs),
    );
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

function isFresh(token: TurnstileToken): boolean {
  return Date.now() - token.createdAt < TOKEN_FRESH_MS;
}

export const turnstileTokens = new TurnstileTokenProvider();
