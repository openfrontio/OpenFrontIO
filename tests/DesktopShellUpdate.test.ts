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

  it("gates a failed check only when retrying could work", () => {
    expect(
      multiplayerAllowed(st("failed", { kind: "network", message: "offline" })),
    ).toBe(false);
  });

  it("does not gate failures Retry provably cannot fix", () => {
    expect(
      multiplayerAllowed(st("failed", { kind: "refused", message: "403" })),
    ).toBe(true);
    expect(
      multiplayerAllowed(st("failed", { kind: "parse", message: "bad json" })),
    ).toBe(true);
    expect(
      multiplayerAllowed(st("failed", { kind: "verify", message: "bad sha" })),
    ).toBe(true);
  });
});
