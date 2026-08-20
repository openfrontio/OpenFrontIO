import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopUpdate, multiplayerAllowed } from "../src/client/DesktopShell";

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
  it("gates only the states the player can act on", () => {
    expect(multiplayerAllowed("current")).toBe(true);
    expect(multiplayerAllowed("checking")).toBe(true);
    expect(multiplayerAllowed("blocked")).toBe(true);
    expect(multiplayerAllowed("downloading")).toBe(false);
    expect(multiplayerAllowed("staged")).toBe(false);
    expect(multiplayerAllowed("failed")).toBe(false);
  });
});
