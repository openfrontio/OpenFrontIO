// Shared helpers for the matchmaking harnesses (contained + e2e).

export async function waitFor(
  fn,
  { timeoutMs = 10000, intervalMs = 200, label = "condition" } = {},
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${label}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// Any HTTP response (including 404) counts as "up"; only a network error
// (nothing listening) counts as down.
export async function isUp(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

export function makeChecker() {
  const results = [];
  return {
    check(name, cond) {
      results.push({ name, pass: !!cond });
      console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
    },
    finish() {
      const failed = results.filter((r) => !r.pass);
      console.log(
        `\n${results.length - failed.length}/${results.length} checks passed`,
      );
      process.exit(failed.length > 0 ? 1 : 0);
    },
  };
}
