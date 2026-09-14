import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeCreatorCodePath,
  parseCreatorCodePath,
  PENDING_CREATOR_CODE_KEY,
  resumePendingCreatorCode,
  stashPendingCreatorCode,
} from "../../src/client/CreatorCode";

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
});

describe("parseCreatorCodePath", () => {
  it("extracts the raw segment from a /c/<code> path", () => {
    expect(parseCreatorCodePath("/c/lewis")).toBe("lewis");
  });

  it("returns null for a path that isn't a /c/ link", () => {
    expect(parseCreatorCodePath("/")).toBeNull();
    expect(parseCreatorCodePath("/game/abc123")).toBeNull();
  });

  it("returns null for a /c/ path with an extra segment", () => {
    expect(parseCreatorCodePath("/c/lewis/extra")).toBeNull();
  });

  it("decodes a percent-encoded segment", () => {
    expect(parseCreatorCodePath("/c/le%77is")).toBe("lewis");
  });

  it("falls back to the raw pathname on a malformed escape instead of throwing", () => {
    expect(() => parseCreatorCodePath("/c/100%")).not.toThrow();
    // "100%" can't be decodeURIComponent'd (bare `%`), so this degrades to
    // matching against the raw, still-encoded pathname.
    expect(parseCreatorCodePath("/c/100%")).toBe("100%");
  });
});

describe("consumeCreatorCodePath", () => {
  it("stashes a valid code and strips the path", () => {
    history.replaceState(null, "", "/c/lewis");

    consumeCreatorCodePath();

    expect(localStorage.getItem(PENDING_CREATOR_CODE_KEY)).not.toBeNull();
    const stashed = JSON.parse(localStorage.getItem(PENDING_CREATOR_CODE_KEY)!);
    expect(stashed.code).toBe("LEWIS");
    expect(window.location.pathname).toBe("/");
  });

  it("strips the path but stashes nothing for an invalid code", () => {
    history.replaceState(null, "", "/c/ab!");

    consumeCreatorCodePath();

    expect(localStorage.getItem(PENDING_CREATOR_CODE_KEY)).toBeNull();
    expect(window.location.pathname).toBe("/");
  });

  it("does not crash on a malformed escape, and stashes nothing", () => {
    history.replaceState(null, "", "/c/100%");

    expect(() => consumeCreatorCodePath()).not.toThrow();

    expect(localStorage.getItem(PENDING_CREATOR_CODE_KEY)).toBeNull();
    expect(window.location.pathname).toBe("/");
  });

  it("leaves a non-/c/ path untouched", () => {
    history.replaceState(null, "", "/game/abc123?foo=bar");

    consumeCreatorCodePath();

    expect(localStorage.getItem(PENDING_CREATOR_CODE_KEY)).toBeNull();
    expect(window.location.pathname).toBe("/game/abc123");
    expect(window.location.search).toBe("?foo=bar");
  });

  it("preserves the search string when stripping the path", () => {
    history.replaceState(null, "", "/c/lewis?ref=banner");

    consumeCreatorCodePath();

    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("?ref=banner");
  });

  it("preserves an existing hash when stripping the path", () => {
    history.replaceState(null, "", "/c/lewis#modal=account");

    consumeCreatorCodePath();

    expect(window.location.pathname).toBe("/");
    expect(window.location.hash).toBe("#modal=account");
  });
});

// The exact shape Main.ts's onUserMe wires up: resumePendingCreatorCode's
// callback opens the account modal with the code as a router arg. This
// exercises the full round trip a real deep link visit takes -- a /c/CODE
// path becomes a stash (consumeCreatorCodePath, boot time), and the stash
// becomes a #modal=account&creatorCode=... hash once the player is signed in
// (resumePendingCreatorCode, onUserMe) -- without needing to instantiate
// Main.ts's App class. The individual stash/resume primitives (TTL,
// consume-on-read, etc.) are already covered by CreatorCode.test.ts; this is
// scoped to the deep-link-specific wiring.
describe("deep link round trip: path -> stash -> resume", () => {
  const openAccountModal = (code: string) => {
    window.location.hash = `modal=account&creatorCode=${encodeURIComponent(code)}`;
  };

  it("a stashed code resumes into the account-modal hash, consumed once", () => {
    history.replaceState(null, "", "/c/lewis");
    consumeCreatorCodePath();

    const resumed = resumePendingCreatorCode(openAccountModal);

    expect(resumed).toBe(true);
    expect(window.location.hash).toBe("#modal=account&creatorCode=LEWIS");
    expect(localStorage.getItem(PENDING_CREATOR_CODE_KEY)).toBeNull();
  });

  it("returns false and leaves the hash alone when nothing is stashed", () => {
    const open = vi.fn();

    const resumed = resumePendingCreatorCode(open);

    expect(resumed).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });

  it("a code needing encoding round-trips through the hash intact", () => {
    stashPendingCreatorCode("A_B-9");

    resumePendingCreatorCode(openAccountModal);

    const params = new URLSearchParams(window.location.hash.slice(1));
    expect(params.get("creatorCode")).toBe("A_B-9");
  });
});
