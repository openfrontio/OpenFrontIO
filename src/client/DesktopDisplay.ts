// The renderer half of the desktop shell's display-preferences bridge
// (OPE-173). Window mode and monitor selection are owned by the Electron
// shell rather than by browser storage: the mode has to be decided by the
// BrowserWindow constructor, which is well before any renderer exists to read
// localStorage.
//
// openfront-desktop's `src/main/displayTypes.ts` is the SOURCE OF TRUTH for
// every shape below. The two repositories cannot import from each other -- the
// client is a submodule built from a public AGPL repo -- so these are mirrored
// by hand, the same arrangement `DesktopUpdateState` in DesktopShell.ts
// already relies on. If you change one, change both.

export type DesktopDisplayMode = "windowed" | "borderless";

export interface DesktopDisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopDisplayInfo {
  // Electron's screen.Display.id. NOT stable across sessions -- the shell
  // derives it from the OS, and macOS in particular renumbers. Never render
  // it: the shell keeps a second-chance label match precisely because the id
  // is not something a player could recognise.
  id: number;
  label: string;
  primary: boolean;
  bounds: DesktopDisplayBounds;
  scaleFactor: number;
}

export interface DesktopDisplayPrefs {
  mode: DesktopDisplayMode;
  // null means "whichever display the OS calls primary", not "unset" -- the
  // shell treats never-chosen and explicitly-chose-primary as the same want.
  displayId: number | null;
}

export type DesktopDisplayPrefsPatch = Partial<DesktopDisplayPrefs>;

export interface DesktopDisplaySnapshot {
  prefs: DesktopDisplayPrefs;
  displays: DesktopDisplayInfo[];
  // Where the window actually is, which is not always where `prefs` asked for.
  // -1 when the shell can see no displays at all.
  activeDisplayId: number;
  // false only when a remembered display was named and nothing matched it.
  // The stored choice is deliberately NOT cleared by the shell, so plugging
  // the monitor back in restores it without the player re-selecting.
  preferredDisplayPresent: boolean;
}

export interface DesktopDisplayBridge {
  getPrefs(): Promise<DesktopDisplaySnapshot>;
  setPrefs(patch: DesktopDisplayPrefsPatch): Promise<DesktopDisplaySnapshot>;
  // Both optional on the wire. A shell that ships getPrefs/setPrefs without
  // the push is still usable -- the Display tab falls back to re-reading --
  // so neither is part of the availability test below.
  listDisplays?(): Promise<DesktopDisplayInfo[]>;
  subscribe?(cb: (snapshot: DesktopDisplaySnapshot) => void): () => void;
}

// Narrowed locally rather than re-declaring the global: a second
// `declare global` with a different type triggers TS2717. See VersionBridge
// in DesktopShell.ts.
type DisplayBridgeHolder = { display?: unknown };

/**
 * The shell's display bridge, or null when it is unavailable -- on the web,
 * and on any desktop shell older than the one that introduced `display.*`
 * (`shell.api` 3).
 *
 * FEATURE DETECTION, NOT VERSION PARSING. The test is that the two methods we
 * actually call are callable, which is the rule desktopLinkGate() already
 * applies to showLinkGate: a rename on the shell side then hides the feature
 * instead of wiring a caller to nothing. `shell.api` is bumped for the record
 * and is deliberately not read here.
 *
 * Returning null rather than throwing is the contract. The shell ships in the
 * Steam depot and updates on Steam's schedule while this client updates at
 * runtime, so a client newer than its shell is ordinary and must degrade
 * rather than break -- and the shell needs nothing from us either way, since
 * F11 toggles the mode in the main process.
 */
export function desktopDisplay(): DesktopDisplayBridge | null {
  if (typeof window === "undefined") return null;
  const desktop = window.openfrontDesktop as DisplayBridgeHolder | undefined;
  const display = desktop?.display as Partial<DesktopDisplayBridge> | undefined;
  if (
    typeof display?.getPrefs !== "function" ||
    typeof display?.setPrefs !== "function"
  ) {
    return null;
  }
  return display as DesktopDisplayBridge;
}

function isBounds(value: unknown): value is DesktopDisplayBounds {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.x === "number" &&
    typeof r.y === "number" &&
    typeof r.width === "number" &&
    typeof r.height === "number"
  );
}

function isDisplayInfo(value: unknown): value is DesktopDisplayInfo {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.id === "number" &&
    typeof d.label === "string" &&
    typeof d.primary === "boolean" &&
    typeof d.scaleFactor === "number" &&
    isBounds(d.bounds)
  );
}

/**
 * Whether a value off the wire is a snapshot we can render.
 *
 * The bridge is an IPC boundary owned by a separately-versioned process, so
 * `DesktopDisplaySnapshot` is a claim about it rather than a guarantee. A
 * malformed payload reaching the render would throw inside a Lit update,
 * which takes the whole settings modal down over a feature whose entire
 * contract is to degrade quietly -- so the tab drops what it cannot read and
 * keeps the last snapshot it could.
 *
 * `prefs.mode` is checked against the two known modes on purpose. A newer
 * shell offering a third would otherwise render a select with nothing
 * selected, which reads as "no mode" rather than "a mode this build does not
 * know about"; dropping the snapshot leaves the tab showing the last state it
 * could actually explain.
 */
export function isDisplaySnapshot(
  value: unknown,
): value is DesktopDisplaySnapshot {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  if (typeof s.activeDisplayId !== "number") return false;
  if (typeof s.preferredDisplayPresent !== "boolean") return false;
  if (!Array.isArray(s.displays) || !s.displays.every(isDisplayInfo)) {
    return false;
  }
  if (typeof s.prefs !== "object" || s.prefs === null) return false;
  const prefs = s.prefs as Record<string, unknown>;
  if (prefs.mode !== "windowed" && prefs.mode !== "borderless") return false;
  return prefs.displayId === null || typeof prefs.displayId === "number";
}
