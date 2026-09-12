import { afterEach, describe, expect, it } from "vitest";
import {
  desktopDisplay,
  isDisplaySnapshot,
} from "../src/client/DesktopDisplay";

const info = {
  id: 1,
  label: "Primary",
  primary: true,
  bounds: { x: 0, y: 0, width: 2560, height: 1440 },
  scaleFactor: 1,
};

const snapshot = {
  prefs: { mode: "borderless", displayId: null },
  displays: [info],
  activeDisplayId: 1,
  preferredDisplayPresent: true,
};

describe("desktopDisplay", () => {
  afterEach(() => {
    window.openfrontDesktop = undefined;
  });

  // The web build. Nothing about the display bridge may be reachable there.
  it("is null with no shell at all", () => {
    window.openfrontDesktop = undefined;
    expect(desktopDisplay()).toBeNull();
  });

  // A desktop shell older than the one that introduced display.* (shell.api
  // 3). The client updates at runtime while the shell updates on Steam's
  // schedule, so this combination is ordinary, not an error.
  it("is null on a shell with no display namespace", () => {
    window.openfrontDesktop = { shell: { api: 2 } };
    expect(desktopDisplay()).toBeNull();
  });

  it("is null on an empty display namespace", () => {
    window.openfrontDesktop = { display: {} };
    expect(desktopDisplay()).toBeNull();
  });

  // Feature detection is on BOTH methods the tab calls, so a rename of
  // either hides the feature rather than wiring a control to nothing.
  it("is null when only getPrefs is callable", () => {
    window.openfrontDesktop = { display: { getPrefs: () => undefined } };
    expect(desktopDisplay()).toBeNull();
  });

  it("is null when only setPrefs is callable", () => {
    window.openfrontDesktop = { display: { setPrefs: () => undefined } };
    expect(desktopDisplay()).toBeNull();
  });

  it("returns the bridge when both methods are callable", () => {
    const display = { getPrefs: () => undefined, setPrefs: () => undefined };
    window.openfrontDesktop = { display };
    expect(desktopDisplay()).toBe(display);
  });

  // subscribe is optional on the wire: a shell that can read and write but
  // never pushes is still usable, and the tab falls back to re-reading.
  it("returns the bridge with no subscribe", () => {
    window.openfrontDesktop = {
      display: { getPrefs: () => undefined, setPrefs: () => undefined },
    };
    expect(desktopDisplay()?.subscribe).toBeUndefined();
  });

  // shell.api is bumped for the record; the client must not gate on it, or a
  // shell that ships the namespace without bumping would be refused.
  it("does not read shell.api", () => {
    window.openfrontDesktop = {
      shell: { api: 1 },
      display: { getPrefs: () => undefined, setPrefs: () => undefined },
    };
    expect(desktopDisplay()).not.toBeNull();
  });
});

describe("isDisplaySnapshot", () => {
  it("accepts a well-formed snapshot", () => {
    expect(isDisplaySnapshot(snapshot)).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(isDisplaySnapshot(null)).toBe(false);
    expect(isDisplaySnapshot("borderless")).toBe(false);
  });

  it("rejects a snapshot with no displays array", () => {
    expect(isDisplaySnapshot({ ...snapshot, displays: undefined })).toBe(false);
  });

  it("rejects a display entry missing its label", () => {
    const broken = { ...info, label: undefined };
    expect(isDisplaySnapshot({ ...snapshot, displays: [broken] })).toBe(false);
  });

  it("rejects a display entry with no bounds", () => {
    const broken = { ...info, bounds: { x: 0, y: 0 } };
    expect(isDisplaySnapshot({ ...snapshot, displays: [broken] })).toBe(false);
  });

  // A mode from a shell newer than this client. Rendering it would leave the
  // select with nothing selected, which reads as "no mode" rather than "a
  // mode this build cannot explain"; the tab keeps its last snapshot instead.
  it("rejects a mode this build does not know", () => {
    const prefs = { mode: "exclusive-fullscreen", displayId: null };
    expect(isDisplaySnapshot({ ...snapshot, prefs })).toBe(false);
  });

  it("rejects a non-numeric displayId", () => {
    const prefs = { mode: "windowed", displayId: "2" };
    expect(isDisplaySnapshot({ ...snapshot, prefs })).toBe(false);
  });

  it("accepts a null displayId, which means the OS primary", () => {
    const prefs = { mode: "windowed", displayId: null };
    expect(isDisplaySnapshot({ ...snapshot, prefs })).toBe(true);
  });

  it("rejects a snapshot with no preferredDisplayPresent", () => {
    const rest: Record<string, unknown> = { ...snapshot };
    delete rest.preferredDisplayPresent;
    expect(isDisplaySnapshot(rest)).toBe(false);
  });
});
