import { afterEach, describe, expect, it, vi } from "vitest";
import {
  desktopUpdate,
  multiplayerAllowed,
  type DesktopUpdateErrorKind,
  type DesktopUpdateErrorKindWire,
  type DesktopUpdateState,
  type DesktopUpdateStatus,
} from "../src/client/DesktopShell";

afterEach(() => {
  delete (window as { openfrontDesktop?: unknown }).openfrontDesktop;
});

describe("desktopUpdate", () => {
  it("is null on the web, where there is no shell at all", () => {
    expect(desktopUpdate()).toBeNull();
  });

  it("is null on an older shell that predates the update bridge", () => {
    (window as { openfrontDesktop?: unknown }).openfrontDesktop = {
      ping: () => Promise.resolve("pong"),
    };

    expect(desktopUpdate()).toBeNull();
  });

  it("returns the bridge when the shell provides one", () => {
    const update = { subscribe: vi.fn(), apply: vi.fn(), retry: vi.fn() };
    (window as { openfrontDesktop?: unknown }).openfrontDesktop = { update };

    expect(desktopUpdate()).toBe(update);
  });
});

describe("multiplayerAllowed", () => {
  const st = (
    status: DesktopUpdateStatus,
    error?: { kind: string; message: string },
  ): DesktopUpdateState => ({ status, bytes: 0, total: 0, error });

  it("gates only the states the player can act on", () => {
    expect(multiplayerAllowed(st("current"))).toBe(true);
    expect(multiplayerAllowed(st("checking"))).toBe(true);
    expect(multiplayerAllowed(st("blocked"))).toBe(true);
    expect(multiplayerAllowed(st("downloading"))).toBe(false);
    expect(multiplayerAllowed(st("staged"))).toBe(false);
  });

  // All four kinds asserted explicitly. A test covering only one gating kind
  // and one non-gating kind would not catch a future edit that collapsed the
  // distinction between them.
  it("gates a failed check when Retry is a real remedy", () => {
    // Transient; retrying may genuinely work.
    expect(
      multiplayerAllowed(st("failed", { kind: "network", message: "offline" })),
    ).toBe(false);
    // The CDN's bytes did not match the descriptor. Retry is a remedy, and we
    // KNOW a newer version exists because the descriptor naming it parsed --
    // a known-stale client with a working remedy is the strongest gating case.
    expect(
      multiplayerAllowed(st("failed", { kind: "verify", message: "bad sha" })),
    ).toBe(false);
  });

  // error is optional on DesktopUpdateState. When it is absent, `kind` reads
  // `undefined`, which matches neither "network" nor "verify" and so returns
  // true -- deliberately: an unclassified failure should not lock a player
  // out. Pinned explicitly so a later edit can't flip that default silently.
  it("does not gate a failed state with no error object", () => {
    expect(multiplayerAllowed(st("failed"))).toBe(true);
  });

  it("does not gate failures no player-side action can change", () => {
    // Our own WAF answering 403, and our own descriptor we could not read.
    // Both deterministic and server-side: Retry re-runs the identical failure,
    // so gating is punishment without recourse -- exactly like `blocked`.
    expect(
      multiplayerAllowed(st("failed", { kind: "refused", message: "403" })),
    ).toBe(true);
    expect(
      multiplayerAllowed(st("failed", { kind: "parse", message: "bad json" })),
    ).toBe(true);
  });
});

// OPE-194. The shell ships in the Steam depot and updates on Steam's
// schedule; this client updates at runtime. A shell NEWER than the client is
// therefore ordinary, and it can classify a failure into a kind this client
// has never heard of.
//
// The old rule was a deny-list -- `kind !== "network" && kind !== "verify"` --
// so any unrecognised kind fell through to ungated. That is the wrong default
// for a safety property: it means the client's answer to "I don't know what
// went wrong" was "then play on". A one-character typo on either side of that
// comparison had the same effect, with no compile error to catch it.
describe("multiplayerAllowed with an unrecognised error kind", () => {
  const failedWith = (kind: string): DesktopUpdateState => ({
    status: "failed",
    bytes: 0,
    total: 0,
    error: { kind, message: "from a newer shell" },
  });

  // Compile-time guard on the type itself, not just the behaviour. If someone
  // narrows DesktopUpdateErrorKindWire to the closed DesktopUpdateErrorKind,
  // this assignment stops compiling -- and the default branch it protects
  // would become `never` and be silently dropped.
  it("types the wire kind permissively enough to carry an unknown value", () => {
    const fromANewerShell: DesktopUpdateErrorKindWire = "quota-exceeded";
    const known: DesktopUpdateErrorKind = "network";

    expect(multiplayerAllowed(failedWith(fromANewerShell))).toBe(false);
    expect(multiplayerAllowed(failedWith(known))).toBe(false);
  });

  it("gates a kind this client does not know about", () => {
    // A future shell classifying something we cannot reason about. We know
    // it decided the failure was worth naming; we just cannot read the name.
    expect(multiplayerAllowed(failedWith("quota-exceeded"))).toBe(false);
  });

  it("gates regardless of what the unknown kind is called", () => {
    for (const kind of ["", "disk-full", "NETWORK", "verify ", "refused2"]) {
      expect(multiplayerAllowed(failedWith(kind))).toBe(false);
    }
  });

  // The four known kinds keep their existing behaviour -- the allow-list must
  // not have quietly changed any of them while flipping the default.
  it("leaves the four known kinds exactly as they were", () => {
    expect(multiplayerAllowed(failedWith("network"))).toBe(false);
    expect(multiplayerAllowed(failedWith("verify"))).toBe(false);
    expect(multiplayerAllowed(failedWith("refused"))).toBe(true);
    expect(multiplayerAllowed(failedWith("parse"))).toBe(true);
  });
});
