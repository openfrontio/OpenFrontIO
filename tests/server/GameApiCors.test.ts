import { describe, expect, test, vi } from "vitest";
import {
  DESKTOP_APP_ORIGIN,
  applyGameApiCorsHeaders,
  gameApiCors,
} from "../../src/server/GameApiCors";

// The game server's /api routes are same-origin for the web client, but the
// desktop app loads its renderer from app://openfront and so reaches them
// cross-origin. A POST carrying Authorization + Content-Type is not a simple
// request, so the browser preflights it: without these headers the desktop
// cannot create a lobby, join by id, or poll for a game at all.
function collect() {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader: (name: string, value: string) => {
      headers.set(name, value);
    },
  };
}

describe("applyGameApiCorsHeaders", () => {
  test("allows the desktop app origin", () => {
    const { headers, setHeader } = collect();
    applyGameApiCorsHeaders(DESKTOP_APP_ORIGIN, setHeader);
    expect(headers.get("Access-Control-Allow-Origin")).toBe("app://openfront");
  });

  test("advertises the methods and headers the game API actually uses", () => {
    const { headers, setHeader } = collect();
    applyGameApiCorsHeaders(DESKTOP_APP_ORIGIN, setHeader);
    // GET (game/:id, exists), POST (create_game, listing), OPTIONS (preflight).
    const methods = headers.get("Access-Control-Allow-Methods") ?? "";
    expect(methods).toContain("GET");
    expect(methods).toContain("POST");
    expect(methods).toContain("OPTIONS");
    // Authorization carries the play token; Content-Type is what makes the
    // POSTs non-simple in the first place.
    const allowed = (
      headers.get("Access-Control-Allow-Headers") ?? ""
    ).toLowerCase();
    expect(allowed).toContain("authorization");
    expect(allowed).toContain("content-type");
  });

  test("never allows credentials", () => {
    // The play token travels in the Authorization header, not a cookie.
    // Allowing credentials here would expose session cookies to any origin we
    // ever add to the allowlist, for no benefit.
    const { headers, setHeader } = collect();
    applyGameApiCorsHeaders(DESKTOP_APP_ORIGIN, setHeader);
    expect(headers.has("Access-Control-Allow-Credentials")).toBe(false);
  });

  test("varies on Origin even when the origin is rejected", () => {
    // Otherwise a cache could hand an allowed origin's response, headers and
    // all, to a request from a different origin.
    const { headers, setHeader } = collect();
    applyGameApiCorsHeaders("https://evil.example", setHeader);
    expect(headers.get("Vary")).toBe("Origin");
  });

  test("does not allow an unknown origin", () => {
    const { headers, setHeader } = collect();
    applyGameApiCorsHeaders("https://evil.example", setHeader);
    expect(headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  test("does not allow a lookalike of the desktop origin", () => {
    const { headers, setHeader } = collect();
    applyGameApiCorsHeaders("app://openfront.evil.example", setHeader);
    expect(headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  test("sets nothing for a request with no Origin (the web client)", () => {
    const { headers, setHeader } = collect();
    applyGameApiCorsHeaders(undefined, setHeader);
    expect(headers.has("Access-Control-Allow-Origin")).toBe(false);
  });
});

describe("gameApiCors middleware", () => {
  function run(method: string, origin: string | undefined) {
    const { headers, setHeader } = collect();
    const res: any = {
      setHeader,
      statusCode: 200,
      ended: false,
      sendStatus(code: number) {
        this.statusCode = code;
        this.ended = true;
        return this;
      },
    };
    const next = vi.fn();
    gameApiCors({ method, headers: { origin } } as any, res, next as any);
    return { headers, res, next };
  }

  test("answers a preflight itself instead of falling through to a route", () => {
    const { res, next } = run("OPTIONS", DESKTOP_APP_ORIGIN);
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  test("a preflight carries the allow headers", () => {
    const { headers } = run("OPTIONS", DESKTOP_APP_ORIGIN);
    expect(headers.get("Access-Control-Allow-Origin")).toBe("app://openfront");
  });

  test("passes real requests through to the route", () => {
    const { res, next } = run("POST", DESKTOP_APP_ORIGIN);
    expect(next).toHaveBeenCalled();
    expect(res.ended).toBe(false);
  });

  test("still passes an unknown origin through — CORS is the browser's call", () => {
    // Rejecting server-side would break non-browser callers (the admin bot,
    // curl) that legitimately send no or another Origin. We simply decline to
    // grant permission, and the browser enforces it.
    const { next } = run("POST", "https://evil.example");
    expect(next).toHaveBeenCalled();
  });
});
