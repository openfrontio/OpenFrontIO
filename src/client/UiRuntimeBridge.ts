/**
 * Dioxus UI Integration Module
 *
 * This module provides the bridge between the browser host UI and Dioxus WASM components.
 * It handles:
 * - WASM module loading and initialization
 * - Component mounting/unmounting
 * - Event bridging between Lit and Dioxus
 */
import {
  UI_RUNTIME_PROTOCOL_VERSION as SHARED_UI_RUNTIME_PROTOCOL_VERSION,
  validateUiRuntimeActionPayload,
  validateUiRuntimeSnapshotPayload,
} from "./runtime/UiRuntimeProtocol";

export const UI_RUNTIME_PROTOCOL_VERSION = SHARED_UI_RUNTIME_PROTOCOL_VERSION;

// Type definitions for the Dioxus WASM module.
// This interface tracks the TS-side compatibility surface still consumed by host bridges.
export interface DioxusWasmModule {
  default: () => Promise<void>;
  init: () => void;
  is_ready: () => boolean;
  dispatch_ui_action: (actionJson: string) => boolean;
  dispatch_ui_snapshot: (snapshotJson: string) => boolean;
  take_ui_events: () => string;
  clear_ui_runtime: () => void;
  ui_runtime_stats: () => string;
  ui_runtime_protocol_version: () => number;
  ui_runtime_protocol_manifest: () => string;
}

let wasmModule: DioxusWasmModule | null = null;
let initPromise: Promise<DioxusWasmModule> | null = null;
let isInitialized = false;

/**
 * Initialize the Dioxus WASM module
 * Safe to call multiple times - will only initialize once
 */
async function initDioxusModule(): Promise<DioxusWasmModule> {
  if (wasmModule && isInitialized) {
    return wasmModule;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      // Dynamic import of the WASM module
      const wasm = await import("dioxus-ui/dioxus_ui.js");
      await wasm.default();

      // Initialize Dioxus
      wasm.init();

      wasmModule = wasm as unknown as DioxusWasmModule;
      isInitialized = true;
      return wasmModule;
    } catch (error) {
      console.error("[DioxusUI] Failed to initialize WASM module:", error);
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
}

export type DioxusUiRuntimeModule = Pick<
  DioxusWasmModule,
  | "dispatch_ui_action"
  | "dispatch_ui_snapshot"
  | "take_ui_events"
  | "ui_runtime_stats"
  | "ui_runtime_protocol_version"
  | "ui_runtime_protocol_manifest"
>;

/**
 * Initialize and return the runtime-first WASM API surface.
 */
export async function initDioxusRuntime(): Promise<DioxusUiRuntimeModule> {
  return initDioxusModule();
}

export const DIOXUS_UI_RUNTIME_ERROR_CODES = [
  "INVALID_ACTION_JSON",
  "INVALID_SNAPSHOT_JSON",
  "UNSUPPORTED_PROTOCOL_VERSION",
  "INVALID_ACTION_TYPE",
  "INVALID_ACTION_PAYLOAD",
  "INVALID_SNAPSHOT_TYPE",
  "STORAGE_UNAVAILABLE",
  "STORAGE_OPERATION_FAILED",
  "EVENT_SERIALIZATION_FAILED",
] as const;

export type DioxusUiRuntimeErrorCode =
  (typeof DIOXUS_UI_RUNTIME_ERROR_CODES)[number];

export interface DioxusUiAction {
  protocolVersion: number;
  type: string;
  target?: string;
  payload?: unknown;
  atMs?: number;
}

export type DioxusUiActionInput = Omit<DioxusUiAction, "protocolVersion"> & {
  protocolVersion?: number;
};

export interface DioxusUiSnapshot {
  protocolVersion: number;
  type: string;
  scope?: string;
  tick?: number;
  payload?: unknown;
  atMs?: number;
}

export type DioxusUiSnapshotInput = Omit<
  DioxusUiSnapshot,
  "protocolVersion"
> & {
  protocolVersion?: number;
};

export interface DioxusUiEvent {
  protocolVersion: number;
  type: string;
  source?: string;
  payload?: unknown;
  atMs?: number;
}

export interface DioxusUiRuntimeStats {
  protocolVersion: number;
  pendingActions: number;
  pendingSnapshots: number;
  pendingEvents: number;
  acceptedActions: number;
  acceptedSnapshots: number;
  rejectedActions: number;
  rejectedSnapshots: number;
  emittedEvents: number;
  drainedActions: number;
  drainedSnapshots: number;
  drainedEvents: number;
  openModals: string[];
  lastError: string | null;
  lastErrorCode: DioxusUiRuntimeErrorCode | null;
}

function normalizeProtocolVersion(inputVersion?: number): number {
  const version = inputVersion ?? UI_RUNTIME_PROTOCOL_VERSION;
  if (version !== UI_RUNTIME_PROTOCOL_VERSION) {
    throw new Error(
      `Unsupported protocolVersion: expected ${UI_RUNTIME_PROTOCOL_VERSION}, got ${version}`,
    );
  }
  return version;
}

export function normalizeUiAction(action: DioxusUiActionInput): DioxusUiAction {
  if (typeof action.type !== "string" || action.type.trim().length === 0) {
    throw new Error("UiAction.type must be a non-empty string");
  }
  const actionType = action.type.trim();
  const validation = validateUiRuntimeActionPayload(actionType, action.payload);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  return {
    ...action,
    type: actionType,
    protocolVersion: normalizeProtocolVersion(action.protocolVersion),
  };
}

export function normalizeUiSnapshot(
  snapshot: DioxusUiSnapshotInput,
): DioxusUiSnapshot {
  if (typeof snapshot.type !== "string" || snapshot.type.trim().length === 0) {
    throw new Error("UiSnapshot.type must be a non-empty string");
  }
  const snapshotType = snapshot.type.trim();
  const validation = validateUiRuntimeSnapshotPayload(
    snapshotType,
    snapshot.payload,
  );
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  return {
    ...snapshot,
    type: snapshotType,
    protocolVersion: normalizeProtocolVersion(snapshot.protocolVersion),
  };
}

export function parseUiEventsPayload(raw: string): DioxusUiEvent[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("UI runtime events payload must be an array");
  }

  return parsed.map((event) => {
    if (typeof event !== "object" || event === null || Array.isArray(event)) {
      throw new Error("UI runtime event must be an object");
    }

    const candidate = event as Record<string, unknown>;
    const protocolVersion = normalizeProtocolVersion(
      typeof candidate.protocolVersion === "number"
        ? candidate.protocolVersion
        : undefined,
    );

    if (
      typeof candidate.type !== "string" ||
      candidate.type.trim().length === 0
    ) {
      throw new Error("UI runtime event type must be a non-empty string");
    }

    return {
      protocolVersion,
      type: candidate.type.trim(),
      source:
        typeof candidate.source === "string" ? candidate.source : undefined,
      payload: candidate.payload,
      atMs: typeof candidate.atMs === "number" ? candidate.atMs : undefined,
    };
  });
}

export function parseUiRuntimeStatsPayload(raw: string): DioxusUiRuntimeStats {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("UI runtime stats payload must be an object");
  }

  const stats = parsed as Record<string, unknown>;
  const protocolVersion = normalizeProtocolVersion(
    typeof stats.protocolVersion === "number"
      ? stats.protocolVersion
      : undefined,
  );

  const toCount = (key: string): number => {
    const value = stats[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : 0;
  };

  const code =
    typeof stats.lastErrorCode === "string" &&
    (DIOXUS_UI_RUNTIME_ERROR_CODES as readonly string[]).includes(
      stats.lastErrorCode,
    )
      ? (stats.lastErrorCode as DioxusUiRuntimeErrorCode)
      : null;

  return {
    protocolVersion,
    pendingActions: toCount("pendingActions"),
    pendingSnapshots: toCount("pendingSnapshots"),
    pendingEvents: toCount("pendingEvents"),
    acceptedActions: toCount("acceptedActions"),
    acceptedSnapshots: toCount("acceptedSnapshots"),
    rejectedActions: toCount("rejectedActions"),
    rejectedSnapshots: toCount("rejectedSnapshots"),
    emittedEvents: toCount("emittedEvents"),
    drainedActions: toCount("drainedActions"),
    drainedSnapshots: toCount("drainedSnapshots"),
    drainedEvents: toCount("drainedEvents"),
    openModals: Array.isArray(stats.openModals)
      ? stats.openModals.filter((entry): entry is string => typeof entry === "string")
      : [],
    lastError: typeof stats.lastError === "string" ? stats.lastError : null,
    lastErrorCode: code,
  };
}

/**
 * Dispatch a generic UI action to the Rust runtime.
 */
export function dispatchUiAction(action: DioxusUiActionInput): boolean {
  if (!wasmModule) {
    console.error("[DioxusUI] Module not initialized");
    return false;
  }
  try {
    const normalized = normalizeUiAction(action);
    return wasmModule.dispatch_ui_action(JSON.stringify(normalized));
  } catch (error) {
    console.warn("[DioxusUI] Invalid runtime action payload:", error);
    return false;
  }
}

/**
 * Dispatch a snapshot payload to the Rust runtime.
 */
export function dispatchUiSnapshot(snapshot: DioxusUiSnapshotInput): boolean {
  if (!wasmModule) {
    console.error("[DioxusUI] Module not initialized");
    return false;
  }
  try {
    const normalized = normalizeUiSnapshot(snapshot);
    return wasmModule.dispatch_ui_snapshot(JSON.stringify(normalized));
  } catch (error) {
    console.warn("[DioxusUI] Invalid runtime snapshot payload:", error);
    return false;
  }
}

/**
 * Take pending runtime events emitted from Rust.
 */
export function takeUiEvents(): DioxusUiEvent[] {
  if (!wasmModule) {
    console.error("[DioxusUI] Module not initialized");
    return [];
  }
  try {
    return parseUiEventsPayload(wasmModule.take_ui_events());
  } catch (error) {
    console.warn("[DioxusUI] Failed to parse runtime events:", error);
    return [];
  }
}

/**
 * Return runtime queue/status counters for diagnostics.
 */
export function getUiRuntimeStats(): DioxusUiRuntimeStats {
  if (!wasmModule) {
    return {
      protocolVersion: UI_RUNTIME_PROTOCOL_VERSION,
      pendingActions: 0,
      pendingSnapshots: 0,
      pendingEvents: 0,
      acceptedActions: 0,
      acceptedSnapshots: 0,
      rejectedActions: 0,
      rejectedSnapshots: 0,
      emittedEvents: 0,
      drainedActions: 0,
      drainedSnapshots: 0,
      drainedEvents: 0,
      openModals: [],
      lastError: "module-not-initialized",
      lastErrorCode: null,
    };
  }
  try {
    return parseUiRuntimeStatsPayload(wasmModule.ui_runtime_stats());
  } catch (error) {
    console.warn("[DioxusUI] Failed to parse runtime stats:", error);
    return {
      protocolVersion: UI_RUNTIME_PROTOCOL_VERSION,
      pendingActions: 0,
      pendingSnapshots: 0,
      pendingEvents: 0,
      acceptedActions: 0,
      acceptedSnapshots: 0,
      rejectedActions: 0,
      rejectedSnapshots: 0,
      emittedEvents: 0,
      drainedActions: 0,
      drainedSnapshots: 0,
      drainedEvents: 0,
      openModals: [],
      lastError: "stats-parse-failed",
      lastErrorCode: null,
    };
  }
}
