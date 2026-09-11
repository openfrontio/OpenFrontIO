import { afterAll, afterEach, beforeEach, vi } from "vitest";

/**
 * Per-test DOM teardown for the jsdom environment. Imported for its side
 * effects by tests/setup.ts, so it applies to every test file.
 *
 * WHY THIS EXISTS
 *
 * Nothing removes an element from document.body when a test ends, so a
 * component a test mounted stays connected for every test after it, and keeps
 * whatever it armed on connect: a timer, a subscription, a pending Lit update.
 * disconnectedCallback -- where components clear exactly those things -- never
 * runs. Removing the element while the document still exists is what runs it.
 *
 * The expensive version of that is the CI failure on 11 Sept (#5357, #5360): a
 * leaked timer fires, writes @state, Lit schedules an update, and the update
 * lands after the file's environment is gone --
 *
 *   ReferenceError: document is not defined
 *    at getCachedLangSelector src/client/Utils.ts
 *    at UserSettingModal.willUpdate / performUpdate  (lit reactive-element)
 *    at processTicksAndRejections
 *
 * -- which fails the run on an unhandled rejection with every test passing.
 * Both PRs guarded their call site and said the pattern itself was still there.
 * This is the pattern.
 *
 * HOW THE UPDATE GETS PAST THE ENVIRONMENT TEARDOWN
 *
 * Worth spelling out, because two plausible-sounding reasons it "cannot happen"
 * are both wrong, and were checked against the installed Vitest (4.1.5) rather
 * than assumed.
 *
 * 1. The leaked timer is a NODE timer, not a jsdom one, so `dom.window.close()`
 *    does not cancel it. Vitest's `populateGlobal` only copies a window
 *    property onto the global if the name is absent from Node's global or
 *    appears in its own KEYS list (`getWindowKeys` in
 *    node_modules/vitest/dist/chunks/index.DC7d2Pf8.js). `setTimeout` is on
 *    Node's global and is not in KEYS, so `globalThis.setTimeout` stays Node's.
 *    Measured: `globalThis.setTimeout === require("timers").setTimeout` is
 *    true inside a jsdom test.
 * 2. The worker does not die with the file. After the last test the environment
 *    teardown deletes `document` and the other window keys from the global, and
 *    the process then stays alive and keeps servicing Node timers until the
 *    main process kills it (`cli-api.Cjt90eJu.js`). Measured with a 1 ms
 *    interval logging `typeof document` under `--coverage`: `object` up to
 *    +37 ms, then `undefined` at +41 ms and +47 ms, still running. That
 *    document-less window is ~10 ms on this machine and longer on a loaded CI
 *    runner with coverage on, which is why the failure reads as intermittent
 *    and CI-only.
 *
 * So the settle ceiling at src/client/UserSettingModal.ts:781 -- 2 s, armed on
 * every display write -- genuinely can land in that window. Disconnecting the
 * element clears it before it ever gets there.
 *
 * #5357's guard in src/client/Utils.ts stays. This closes the door; that guard
 * is defence in depth for anything that finds another way through.
 *
 * WHAT IT REMOVES
 *
 * After each test: every element added to document.body DURING that test.
 * Anything already there when the test started -- a beforeAll fixture, page
 * scaffolding a file sets up once -- is left alone, so files that mount once
 * and reuse the element across tests keep working.
 *
 * After the file: everything still in document.body, which is how those
 * beforeAll fixtures get their disconnectedCallback (ten client files mount
 * that way, e.g. tests/client/GameStatsModal.test.ts).
 *
 * HOOK ORDER (verified empirically)
 *
 * Vitest runs afterEach and afterAll LIFO within a file. Setup-file hooks are
 * registered before any hook a test file registers, so these run LAST: a test
 * file's own hooks still see everything they mounted, can assert on it, and can
 * clean up first. beforeEach is the mirror image -- FIFO, so the snapshot below
 * is taken before a file's own beforeEach mounts anything, which is why
 * elements mounted in a file's beforeEach count as "added during the test".
 *
 * tests/client/_teardown/GlobalDomTeardown.test.ts pins the afterEach half of
 * that ordering. The afterAll half is deliberately NOT asserted from a test
 * file: being last is the whole point, so nothing inside the file runs after it
 * to observe it. `removeAndSettle` is exported and tested directly instead.
 *
 * KNOWN LIMITS
 *
 * - Only direct children of document.body are tracked. An element appended
 *   into a container that already existed, or into document.head, is not
 *   removed by the afterEach -- though the afterAll sweep does take the
 *   container itself, and with it everything inside.
 * - Files running under the node environment (`@vitest-environment node`) have
 *   no document, so they skip all of this, including the fake-timer drain.
 * - Nothing here unsubscribes a component that only cleans up on an explicit
 *   close()/dispose() rather than on disconnect. Those still need their own
 *   afterEach.
 */

/** An element that may be mid-update, e.g. any LitElement. */
type MaybeUpdating = Element & { updateComplete?: unknown };

let preexisting = new Set<Element>();

function hasDom(): boolean {
  return typeof document !== "undefined" && document.body !== null;
}

/**
 * Remove each element and let any update already scheduled on it run while the
 * document still exists -- disconnectedCallback itself can schedule one.
 *
 * Exported so the behaviour can be asserted directly; see the hook-order note
 * above for why the afterAll sweep cannot be observed from inside a test file.
 */
export async function removeAndSettle(
  elements: readonly Element[],
): Promise<void> {
  for (const element of elements) element.remove();
  await settle(elements);
}

async function settle(elements: readonly Element[]): Promise<void> {
  for (const element of elements) {
    const pending = (element as MaybeUpdating).updateComplete;
    if (pending instanceof Promise) await pending;
  }
}

beforeEach(() => {
  if (!hasDom()) return;
  preexisting = new Set(document.body.children);
});

afterEach(async () => {
  if (!hasDom()) return;

  const added = [...document.body.children].filter(
    (element) => !preexisting.has(element),
  );
  preexisting = new Set();

  await removeAndSettle(added);

  // Fake timers are only touched when they are STILL installed -- a test that
  // already called vi.useRealTimers() is left exactly as it left things.
  //
  // Draining first matters: vi.useRealTimers() discards the fake clock, so a
  // timer the test armed and never ran would vanish without ever running. The
  // elements are already disconnected at this point, so anything they armed
  // has been cleared and what is left belongs to the test itself. Running it
  // here keeps that work inside the test's own document.
  if (vi.isFakeTimers()) {
    try {
      vi.runOnlyPendingTimers();
    } catch {
      // A pending callback that throws belongs to the test that armed it.
      // Rethrowing from a global afterEach would pin it on whichever test
      // happened to run last -- the exact misattribution this file exists to
      // remove. Draining is the goal here, not asserting.
    }
    vi.useRealTimers();
    // The drain can have scheduled one more update on a disconnected element.
    await settle(added);
  }
});

// The afterEach deliberately spares anything mounted before the test started,
// so a beforeAll fixture survives to here. This is its disconnectedCallback --
// the last moment at which there is still a document to run it against.
afterAll(async () => {
  if (!hasDom()) return;
  await removeAndSettle([...document.body.children]);
});
