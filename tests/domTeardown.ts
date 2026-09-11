import { afterEach, beforeEach, vi } from "vitest";

/**
 * Per-test DOM teardown for the jsdom environment. Imported for its side
 * effects by tests/setup.ts, so it applies to every test file.
 *
 * WHY THIS EXISTS
 *
 * Nothing removes an element from document.body when a test ends, so a
 * component a test mounted is still connected for every test after it -- and
 * still holds whatever it armed on connect: a timer, a subscription, a pending
 * Lit update. The next test starts with someone else's DOM, and that timer
 * fires into it.
 *
 * The same missing disconnectedCallback is behind the CI failures on 11 Sept
 * (#5357, #5360), where a Lit update landed after the file's environment was
 * gone and threw "ReferenceError: document is not defined" / "window is not
 * defined" from translateText and Platform. Those were fixed by guarding the
 * two call sites; both PRs said the pattern itself was still there. This is
 * that fix.
 *
 * Removing the element while the document still exists runs
 * disconnectedCallback, which is where components clear their timers and
 * unsubscribe. Doing it here means no test file has to remember.
 *
 * Scope note, measured rather than assumed: on Vitest 4.1.5 the post-teardown
 * escape is narrow. The jsdom teardown calls `dom.window.close()`, which stops
 * every timer jsdom owns, and the default forks pool gives each file its own
 * child process that exits at the end of the file. Reverting #5357's guard and
 * running the whole suite with this hook disabled produced no unhandled
 * rejection. The within-file leak is the part that reproduces on demand, and
 * it is the part worth being strict about.
 *
 * WHAT IT REMOVES
 *
 * Only elements added to document.body DURING the test. Anything already there
 * when the test started -- a fixture mounted in beforeAll, page scaffolding a
 * file sets up once -- is left alone, so files that mount once and reuse the
 * element across tests keep working.
 *
 * HOOK ORDER (verified empirically, see below)
 *
 * Vitest runs afterEach hooks LIFO within a file. Setup-file hooks are
 * registered before any hook a test file registers, so this afterEach runs
 * LAST: a test file's own afterEach still sees everything it mounted, can
 * assert on it, and can do its own cleanup first. beforeEach is the mirror
 * image -- FIFO, so the snapshot below is taken before a file's own beforeEach
 * mounts anything, which is why elements mounted in a file's beforeEach count
 * as "added during the test".
 *
 * tests/client/_teardown/GlobalDomTeardown.test.ts pins that ordering: it
 * records, from a file-level afterEach, whether the element it mounted is
 * still in the document, and fails if this hook ever runs first.
 */

/** An element that may be mid-update, e.g. any LitElement. */
type MaybeUpdating = Element & { updateComplete?: unknown };

let preexisting = new Set<Element>();

function hasDom(): boolean {
  return typeof document !== "undefined" && document.body !== null;
}

/**
 * Let any update already scheduled on the removed elements run while the
 * document still exists. disconnectedCallback itself can schedule one.
 */
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

  for (const element of added) element.remove();
  await settle(added);

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
