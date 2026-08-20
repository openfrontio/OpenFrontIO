import { afterEach, describe, expect, it, vi } from "vitest";
import {
  desktopUpdate,
  multiplayerAllowed,
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
