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
  "before-interactive-callback"?: () => void;
  "after-interactive-callback"?: () => void;
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

export interface GamePortal {
  isOnGamePortal(): boolean;
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

/**
 * How long a visible (managed) challenge may wait for the player. Separate from
 * the silent timeout: it is armed by before-interactive-callback and the silent
 * timeout is re-armed by after-interactive-callback.
 */
export const TURNSTILE_INTERACTIVE_TIMEOUT_MS = 60_000;

/** Reported when a visible challenge sat unanswered; never auto-retried. */
export const TURNSTILE_INTERACTIVE_TIMEOUT_CODE = "interactive-timeout";

/** Reported when the player dismissed the visible challenge. */
export const TURNSTILE_CANCELLED_CODE = "cancelled";

/** Reported when a boot prefetch is dropped because it turned interactive. */
export const TURNSTILE_PREFETCH_INTERACTIVE_CODE = "prefetch-interactive";

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
function turnstileErrorCode(error: unknown): string {
  if (error instanceof TurnstileError) {
    return error.code;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "unknown";
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "AbortError"
  ) {
    return true;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  return false;
}

function createAbortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }
  if (typeof signal?.reason === "string") {
    const error = new Error(signal.reason);
    error.name = "AbortError";
    return error;
  }
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted", "AbortError");
  }
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

/**
 * Run one challenge on a freshly rendered widget and resolve with its token.
 *
 * Exactly one of resolve/reject happens, and the widget is always removed
 * afterwards: a widget that outlived its challenge would be the same widget
 * the next call renders over, which is how two challenges end up in flight.
 *
 * Each widget gets its own host element inside `container`. Turnstile rejects
 * a render into an element that already holds a widget ("Turnstile has already
 * been rendered in this container"), and the execute() that follows lands on
 * the old widget, so the new callbacks never fire and the join times out. That
 * happened whenever two requests overlapped (on portals every join requests a
 * fresh token while the boot prefetch may still be running), and for good once
 * Turnstile stopped recognising a widget's id ("Nothing to remove found").
 */
export function requestTurnstileToken(
  turnstile: TurnstileApi,
  options: {
    sitekey: string;
    container: HTMLElement;
    timeoutMs?: number;
    interactiveTimeoutMs?: number;
    /** Boot prefetch: never show a challenge, drop the request instead. */
    abortOnInteractive?: boolean;
    /** Fired when the player dismisses a visible challenge. */
    onCancel?: () => void;
    /** Visible Cancel button text; the keyboard route out of the iframe. */
    cancelLabel?: string;
    /** Accessible name announced for the challenge overlay. */
    dialogLabel?: string;
    now?: () => number;
    signal?: AbortSignal;
  },
): Promise<TurnstileToken> {
  const timeoutMs = options.timeoutMs ?? TURNSTILE_TOKEN_TIMEOUT_MS;
  const interactiveTimeoutMs =
    options.interactiveTimeoutMs ?? TURNSTILE_INTERACTIVE_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const signal = options.signal;

  return new Promise<TurnstileToken>((resolve, reject) => {
    let widgetId: string | undefined;
    let widgetRemoved = false;
    let hostRemoved = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const host = document.createElement("div");
    options.container.appendChild(host);

    // The backdrop is the container itself: inert until a challenge turns
    // interactive, and always reset on removal so no path strands it.
    const onBackdropClick = (event: Event) => {
      if (event.target === options.container) cancel();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Capture phase: keep BaseModal's own Escape handler from also firing.
      event.stopPropagation();
      event.preventDefault();
      cancel();
    };
    // Only a request that raised the backdrop may lower it: the container is
    // shared, so a prefetch settling must not strip a join's live backdrop. The
    // body fallback (no #turnstile-container) never gets one, since styling it
    // would block the whole page.
    let backdropShown = false;
    let cancelButton: HTMLButtonElement | undefined;
    let previousFocus: HTMLElement | null = null;
    const onFocusIn = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !options.container.contains(event.target)
      ) {
        cancelButton?.focus();
      }
    };
    const showBackdrop = () => {
      if (backdropShown || options.container === document.body) return;
      backdropShown = true;
      previousFocus =
        document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body &&
        !options.container.contains(document.activeElement)
          ? document.activeElement
          : null;
      options.container.dataset.interactive = "true";
      options.container.style.pointerEvents = "auto";
      options.container.setAttribute("role", "dialog");
      options.container.setAttribute("aria-modal", "true");
      if (options.dialogLabel) {
        options.container.setAttribute("aria-label", options.dialogLabel);
      }
      // The iframe is cross-origin, so Escape pressed inside it never reaches
      // us. Tab leaves the frame, and this button is the next stop.
      cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.textContent = options.cancelLabel ?? "Cancel";
      cancelButton.className =
        "ml-4 px-4 py-2 rounded bg-white text-black font-semibold shadow";
      cancelButton.addEventListener("click", cancel);
      options.container.appendChild(cancelButton);
      cancelButton.focus();
      options.container.addEventListener("click", onBackdropClick);
      document.addEventListener("keydown", onEscape, true);
      document.addEventListener("focusin", onFocusIn, true);
    };
    const hideBackdrop = () => {
      if (!backdropShown) return;
      backdropShown = false;
      delete options.container.dataset.interactive;
      options.container.style.pointerEvents = "none";
      options.container.removeAttribute("role");
      options.container.removeAttribute("aria-modal");
      options.container.removeAttribute("aria-label");
      document.removeEventListener("focusin", onFocusIn, true);
      cancelButton?.remove();
      cancelButton = undefined;
      options.container.removeEventListener("click", onBackdropClick);
      document.removeEventListener("keydown", onEscape, true);
      const toRestore = previousFocus;
      previousFocus = null;
      if (toRestore?.isConnected) {
        try {
          toRestore.focus();
        } catch {
          // Ignore focus errors on detached/disabled targets
        }
      }
    };

    // Turnstile can still call back after we are done with the widget (a late
    // error after a timeout, say). Removing once and settling once means such
    // a call cannot double-resolve, and cannot throw by removing a widget id
    // Turnstile no longer knows about.
    const removeWidget = () => {
      hideBackdrop();
      if (!widgetRemoved && widgetId !== undefined) {
        widgetRemoved = true;
        try {
          turnstile.remove(widgetId);
        } catch (error) {
          console.error("Turnstile: failed to remove widget", error);
        }
      }
      if (!hostRemoved) {
        hostRemoved = true;
        // Takes the widget's iframe with it even when Turnstile has lost track
        // of the id.
        host.remove();
      }
    };

    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (signal !== undefined) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      removeWidget();
      finish();
    };

    const onAbort = () => {
      settle(() => reject(createAbortError(signal)));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort);

    const succeed = (token: string) =>
      settle(() => resolve({ token, createdAt: now() }));
    const fail = (error: unknown) => settle(() => reject(error));
    function cancel() {
      if (settled) return;
      settle(() =>
        reject(
          new TurnstileError(TURNSTILE_CANCELLED_CODE, "Turnstile cancelled"),
        ),
      );
      options.onCancel?.();
    }

    const armTimer = (ms: number, code: string) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(
        () =>
          fail(new TurnstileError(code, `Turnstile timed out after ${ms}ms`)),
        ms,
      );
    };

    try {
      widgetId = turnstile.render(host, {
        sitekey: options.sitekey,
        size: "normal",
        appearance: "interaction-only",
        theme: "light",
        execution: "execute",
        callback: (token: string) => succeed(token),
        "error-callback": (errorCode: string) =>
          fail(new TurnstileError(errorCode ?? "unknown")),
        "before-interactive-callback": () => {
          if (settled) return;
          if (options.abortOnInteractive) {
            fail(new TurnstileError(TURNSTILE_PREFETCH_INTERACTIVE_CODE));
            return;
          }
          showBackdrop();
          armTimer(interactiveTimeoutMs, TURNSTILE_INTERACTIVE_TIMEOUT_CODE);
        },
        "after-interactive-callback": () => {
          if (settled) return;
          hideBackdrop();
          // Short wait again, but the player has already been shown a
          // challenge: report it as interactive so it is never auto-retried.
          armTimer(timeoutMs, TURNSTILE_INTERACTIVE_TIMEOUT_CODE);
        },
      });
    } catch (error) {
      host.remove();
      fail(error);
      return;
    }

    // A callback that fired during render() left nothing to execute, but the
    // widget it rendered still has to go.
    if (settled) {
      removeWidget();
      return;
    }

    armTimer(timeoutMs, TURNSTILE_TIMEOUT_CODE);

    try {
      turnstile.execute(widgetId);
    } catch (error) {
      fail(error);
    }
  });
}

export interface ResolveTurnstileTokenDeps {
  /** The boot-time prefetch, or null when there is none to reuse. */
  prefetch?: Promise<TurnstileToken> | null;
  requestFresh?: (signal?: AbortSignal) => Promise<TurnstileToken>;
  /** Web game portal instance to detect if on portal. */
  gamePortal?: GamePortal;
  /** Signal to abort token request. */
  signal?: AbortSignal;
  /** Portals always want a token minted for this join. */
  forceFresh?: boolean;
  /** Shows the error modal. Called at most once, for the final failure. */
  onError?: (code?: string) => void;
  now?: () => number;
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
export async function resolveTurnstileToken(
  deps: ResolveTurnstileTokenDeps,
): Promise<string | null> {
  const now = deps.now ?? Date.now;

  if (deps.signal?.aborted) {
    return null;
  }

  const retryFresh = async (): Promise<string | null> => {
    if (deps.signal?.aborted || !deps.requestFresh) return null;
    console.warn("Turnstile timed out, retrying once on fresh widget");
    try {
      const retryRes = await deps.requestFresh(deps.signal);
      if (deps.signal?.aborted) return null;
      return retryRes?.token ?? null;
    } catch (retryError) {
      if (isAbortError(retryError, deps.signal)) return null;
      if (turnstileErrorCode(retryError) === TURNSTILE_CANCELLED_CODE) {
        throw retryError instanceof TurnstileError
          ? retryError
          : new TurnstileError(TURNSTILE_CANCELLED_CODE);
      }
      console.warn("Turnstile retry failed", retryError);
      deps.onError?.(turnstileErrorCode(retryError));
      throw retryError instanceof TurnstileError
        ? retryError
        : new TurnstileError(
            turnstileErrorCode(retryError),
            retryError instanceof Error ? retryError.message : undefined,
          );
    }
  };

  const fetchFreshWithRetry = async (): Promise<string | null> => {
    if (deps.signal?.aborted) return null;
    if (!deps.requestFresh) return null;
    try {
      const res = await deps.requestFresh(deps.signal);
      if (deps.signal?.aborted) return null;
      return res?.token ?? null;
    } catch (error) {
      if (isAbortError(error, deps.signal)) return null;
      // The player dismissed the challenge: leave quietly, no modal, no retry.
      if (turnstileErrorCode(error) === TURNSTILE_CANCELLED_CODE) {
        throw error instanceof TurnstileError
          ? error
          : new TurnstileError(TURNSTILE_CANCELLED_CODE);
      }
      if (turnstileErrorCode(error) === TURNSTILE_TIMEOUT_CODE) {
        return retryFresh();
      }
      console.warn("Turnstile: token request failed", error);
      deps.onError?.(turnstileErrorCode(error));
      throw error instanceof TurnstileError
        ? error
        : new TurnstileError(
            turnstileErrorCode(error),
            error instanceof Error ? error.message : undefined,
          );
    }
  };

  const forceFresh =
    deps.forceFresh ?? deps.gamePortal?.isOnGamePortal() ?? false;

  if (!deps.prefetch || forceFresh) {
    console.log("No prefetched turnstile token, getting new token");
    return fetchFreshWithRetry();
  }

  let prefetched: TurnstileToken | null = null;
  try {
    prefetched = await deps.prefetch;
  } catch (error) {
    // Boot-time failure: worth a line, not a modal. The join gets its own try.
    console.warn("Prefetched turnstile token failed, getting new token", error);
    return fetchFreshWithRetry();
  }

  if (deps.signal?.aborted) {
    return null;
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
  return fetchFreshWithRetry();
}
