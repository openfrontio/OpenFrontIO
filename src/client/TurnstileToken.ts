/**
 * The Cloudflare Turnstile token flow, kept out of Main.ts so it can be
 * exercised against a fake `turnstile` object.
 *
 * The shape of this flow is dictated by one Turnstile rule: a widget runs one
 * challenge at a time. `render()` defaults to `execution: "render"`, which
 * starts a challenge the moment the widget appears; calling `execute()` on top
 * of that is a second challenge, and Turnstile refuses it with
 *
 *   [Cloudflare Turnstile] Call to execute() on a widget that is already
 *   executing (cf-chl-widget-...)
 *
 * The callbacks passed to the refused `execute()` are then attached to
 * nothing, so nothing ever resolves the token promise and Turnstile's own
 * watchdog eventually reports the widget as hung (error 300030). So: render
 * with `execution: "execute"` (nothing runs until we say so) and attach the
 * callbacks at render time, where they belong to the widget rather than to one
 * call; then execute once.
 */

export interface TurnstileRenderOptions {
  sitekey: string;
  size?: string;
  appearance?: string;
  theme?: string;
  /**
   * "render" (Turnstile's default) starts the challenge as soon as the widget
   * renders. "execute" holds it until execute() is called, which is the only
   * way to be sure exactly one challenge is ever in flight.
   */
  execution?: "render" | "execute";
  callback?: (token: string) => void;
  "error-callback"?: (errorCode: string) => void;
}

export interface TurnstileApi {
  render(
    container: string | HTMLElement,
    options: TurnstileRenderOptions,
  ): string;
  execute(widgetId: string): void;
  remove(widgetId: string): void;
}

export interface TurnstileToken {
  token: string;
  createdAt: number;
}

/**
 * How long a prefetched token stays usable. Turnstile tokens are good for five
 * minutes server-side; three leaves room for the join round trip.
 */
export const TURNSTILE_TOKEN_TTL_MS = 3 * 60 * 1000;

/**
 * How long to wait for a challenge before giving up on the widget. Turnstile's
 * own watchdog fires at ~30s and reports 300030; failing first keeps the wait
 * bounded and lets the join path spend its one retry on a fresh widget while
 * the player is still waiting.
 */
export const TURNSTILE_TOKEN_TIMEOUT_MS = 15_000;

/** The code reported when the widget never answers within the timeout. */
export const TURNSTILE_TIMEOUT_CODE = "timeout";

/** The code reported when the Turnstile script itself never loaded. */
export const TURNSTILE_LOAD_FAILED_CODE = "load-failed";

/**
 * A Turnstile failure with the code the error modal shows. Turnstile's own
 * codes are numeric strings (e.g. "300030"); the two synthetic ones above
 * cover the failures that happen before or instead of a Turnstile callback.
 */
export class TurnstileError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? `Turnstile failed: ${code}`);
    this.name = "TurnstileError";
  }
}

/** The code to show for any failure, Turnstile's own or otherwise. */
export function turnstileErrorCode(error: unknown): string {
  return error instanceof TurnstileError ? error.code : "unknown";
}

/**
 * Run one challenge on a freshly rendered widget and resolve with its token.
 *
 * Exactly one of resolve/reject happens, and the widget is always removed
 * afterwards: a widget that outlived its challenge would be the same widget
 * the next call renders over, which is how two challenges end up in flight.
 */
export function requestTurnstileToken(
  turnstile: TurnstileApi,
  options: {
    sitekey: string;
    container: string | HTMLElement;
    timeoutMs?: number;
    now?: () => number;
  },
): Promise<TurnstileToken> {
  const timeoutMs = options.timeoutMs ?? TURNSTILE_TOKEN_TIMEOUT_MS;
  const now = options.now ?? Date.now;

  return new Promise<TurnstileToken>((resolve, reject) => {
    let widgetId: string | undefined;
    let removed = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    // Turnstile can still call back after we are done with the widget (a late
    // error after a timeout, say). Removing once and settling once means such
    // a call cannot double-resolve, and cannot throw by removing a widget id
    // Turnstile no longer knows about.
    const removeWidget = () => {
      if (removed || widgetId === undefined) return;
      removed = true;
      try {
        turnstile.remove(widgetId);
      } catch (error) {
        console.error("Turnstile: failed to remove widget", error);
      }
    };

    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      removeWidget();
      finish();
    };

    const succeed = (token: string) =>
      settle(() => resolve({ token, createdAt: now() }));
    const fail = (error: unknown) => settle(() => reject(error));

    try {
      widgetId = turnstile.render(options.container, {
        sitekey: options.sitekey,
        size: "normal",
        appearance: "interaction-only",
        theme: "light",
        execution: "execute",
        callback: (token: string) => succeed(token),
        "error-callback": (errorCode: string) =>
          fail(new TurnstileError(errorCode ?? "unknown")),
      });
    } catch (error) {
      fail(error);
      return;
    }

    // A callback that fired during render() left nothing to execute, but the
    // widget it rendered still has to go.
    if (settled) {
      removeWidget();
      return;
    }

    timer = setTimeout(
      () =>
        fail(
          new TurnstileError(
            TURNSTILE_TIMEOUT_CODE,
            `Turnstile timed out after ${timeoutMs}ms`,
          ),
        ),
      timeoutMs,
    );

    try {
      turnstile.execute(widgetId);
    } catch (error) {
      fail(error);
    }
  });
}

/**
 * Decide which token a join uses: the one prefetched at boot, or a fresh one.
 *
 * A prefetch that rejected is treated exactly like one that went stale -- it is
 * dropped and a fresh fetch takes its place, because the boot-time failure is
 * not the join's failure and the player has had minutes of page life since.
 * Only the fresh fetch's failure reaches `onError`, so a join shows at most one
 * error modal and only for the attempt that actually decided it.
 */
export async function resolveTurnstileToken(deps: {
  /** The boot-time prefetch, or null when there is none to reuse. */
  prefetch: Promise<TurnstileToken> | null;
  requestFresh: () => Promise<TurnstileToken>;
  /** CrazyGames always wants a token minted for this join. */
  forceFresh?: boolean;
  /** Shows the error modal. Called at most once, for the final failure. */
  onError: (code: string) => void;
  now?: () => number;
}): Promise<string | null> {
  const now = deps.now ?? Date.now;

  const fresh = async (): Promise<string | null> => {
    try {
      return (await deps.requestFresh())?.token ?? null;
    } catch (error) {
      console.warn("Turnstile: token request failed", error);
      deps.onError(turnstileErrorCode(error));
      throw error;
    }
  };

  if (deps.prefetch === null || deps.forceFresh === true) {
    console.log("No prefetched turnstile token, getting new token");
    return fresh();
  }

  let prefetched: TurnstileToken | null;
  try {
    prefetched = await deps.prefetch;
  } catch (error) {
    // Boot-time failure: worth a line, not a modal. The join gets its own try.
    console.warn("Prefetched turnstile token failed, getting new token", error);
    return fresh();
  }

  if (!prefetched) {
    console.log("No turnstile token");
    return null;
  }

  if (now() < prefetched.createdAt + TURNSTILE_TOKEN_TTL_MS) {
    console.log("Prefetched turnstile token is valid");
    return prefetched.token;
  }

  console.log("Turnstile token expired, getting new token");
  return fresh();
}
