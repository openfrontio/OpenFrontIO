import {
  dispatchUiAction,
  initDioxusRuntime,
} from "../UiRuntimeBridge";
import {
  parseUiRuntimePayload,
  parseUiRuntimeString,
} from "./UiRuntimeParsing";
import {
  subscribeUiRuntimeEvents,
  waitForUiRuntimeEvent,
} from "./UiRuntimeEventRouter";
import { UI_RUNTIME_ACTIONS, UI_RUNTIME_EVENTS } from "./UiRuntimeProtocol";

export const UI_SESSION_RUNTIME_EVENTS = {
  modalClose: "ui-session-runtime:modal-close",
  storageChanged: "ui-session-runtime:storage-changed",
  keyboardChanged: "ui-session-runtime:keyboard-changed",
  beforeUnload: "ui-session-runtime:before-unload",
  navigationPopstate: "ui-session-runtime:navigation-popstate",
  navigationHashchange: "ui-session-runtime:navigation-hashchange",
} as const;

export interface UiSessionModalCloseDetail {
  modal: string;
  reason: string;
  atMs?: number;
}

export interface UiSessionStorageChangedDetail {
  storageKey: string;
  value: string | null;
  atMs?: number;
}

export interface UiSessionKeyboardChangedDetail {
  key: string;
  code: string;
  isDown: boolean;
  atMs?: number;
}

export interface UiSessionNavigationDetail {
  href: string;
  atMs?: number;
}

let hasStarted = false;
let startPromise: Promise<void> | null = null;
let runtimeUnsubscribe: (() => void) | null = null;
let keydownListenerAttached = false;
let keyupListenerAttached = false;
let beforeUnloadListenerAttached = false;
let popstateListenerAttached = false;
let hashchangeListenerAttached = false;
const storageCache = new Map<string, string | null>();

const STORAGE_TARGET = "runtime.session.storage";

function emitHostEvent(detail: UiSessionModalCloseDetail): void {
  window.dispatchEvent(
    new CustomEvent(UI_SESSION_RUNTIME_EVENTS.modalClose, {
      detail,
      bubbles: false,
      composed: false,
    }),
  );
}

function emitStorageHostEvent(detail: UiSessionStorageChangedDetail): void {
  window.dispatchEvent(
    new CustomEvent(UI_SESSION_RUNTIME_EVENTS.storageChanged, {
      detail,
      bubbles: false,
      composed: false,
    }),
  );
}

function emitKeyboardHostEvent(detail: UiSessionKeyboardChangedDetail): void {
  window.dispatchEvent(
    new CustomEvent(UI_SESSION_RUNTIME_EVENTS.keyboardChanged, {
      detail,
      bubbles: false,
      composed: false,
    }),
  );
}

function emitBeforeUnloadHostEvent(detail: UiSessionNavigationDetail): void {
  window.dispatchEvent(
    new CustomEvent(UI_SESSION_RUNTIME_EVENTS.beforeUnload, {
      detail,
      bubbles: false,
      composed: false,
    }),
  );
}

function emitNavigationPopstateHostEvent(detail: UiSessionNavigationDetail): void {
  window.dispatchEvent(
    new CustomEvent(UI_SESSION_RUNTIME_EVENTS.navigationPopstate, {
      detail,
      bubbles: false,
      composed: false,
    }),
  );
}

function emitNavigationHashchangeHostEvent(
  detail: UiSessionNavigationDetail,
): void {
  window.dispatchEvent(
    new CustomEvent(UI_SESSION_RUNTIME_EVENTS.navigationHashchange, {
      detail,
      bubbles: false,
      composed: false,
    }),
  );
}

function dispatchKeyboardStateAction(event: KeyboardEvent, isDown: boolean): void {
  dispatchUiAction({
    type: UI_RUNTIME_ACTIONS.sessionKeyboardState,
    target: "runtime.session.keyboard",
    payload: {
      key: event.key,
      code: event.code,
      isDown,
    },
  });
}

function onGlobalKeyDown(event: KeyboardEvent): void {
  dispatchKeyboardStateAction(event, true);

  if (event.key !== "Escape") {
    return;
  }

  dispatchUiAction({
    type: UI_RUNTIME_ACTIONS.sessionKeyboardEscape,
    payload: {
      reason: "escape",
    },
  });
}

function onGlobalKeyUp(event: KeyboardEvent): void {
  dispatchKeyboardStateAction(event, false);
}

function dispatchSessionHrefAction(actionType: string): void {
  dispatchUiAction({
    type: actionType,
    target: "runtime.session.navigation",
    payload: {
      href: window.location.href,
    },
  });
}

function onGlobalBeforeUnload(): void {
  dispatchSessionHrefAction(UI_RUNTIME_ACTIONS.sessionLifecycleBeforeUnload);
  emitBeforeUnloadHostEvent({
    href: window.location.href,
    atMs: Date.now(),
  });
}

function onGlobalPopstate(): void {
  dispatchSessionHrefAction(UI_RUNTIME_ACTIONS.sessionNavigationPopstate);
  emitNavigationPopstateHostEvent({
    href: window.location.href,
    atMs: Date.now(),
  });
}

function onGlobalHashchange(): void {
  dispatchSessionHrefAction(UI_RUNTIME_ACTIONS.sessionNavigationHashchange);
  emitNavigationHashchangeHostEvent({
    href: window.location.href,
    atMs: Date.now(),
  });
}

function parseStoragePayload(
  payload: unknown,
): { storageKey: string; value: string | null } | null {
  const parsed = parseUiRuntimePayload(payload);
  const storageKey = parseUiRuntimeString(parsed.storageKey).trim();
  if (!storageKey) {
    return null;
  }

  const value = parsed.value;
  if (value === null) {
    return { storageKey, value: null };
  }
  if (typeof value !== "string") {
    return null;
  }

  return { storageKey, value };
}

function parseKeyboardPayload(
  payload: unknown,
): { key: string; code: string; isDown: boolean } | null {
  const parsed = parseUiRuntimePayload(payload);
  const key = parseUiRuntimeString(parsed.key);
  const code = parseUiRuntimeString(parsed.code).trim();
  const isDown = parsed.isDown;

  if (key.length === 0 || !code || typeof isDown !== "boolean") {
    return null;
  }

  return {
    key,
    code,
    isDown,
  };
}

function readBrowserStorageValue(storageKey: string): string | null | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return undefined;
  }
}

function writeBrowserStorageValue(storageKey: string, value: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.setItem(storageKey, value);
    return true;
  } catch {
    return false;
  }
}

function removeBrowserStorageValue(storageKey: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

async function dispatchSessionStorageAction(
  actionType: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    await initDioxusRuntime();
    return dispatchUiAction({
      type: actionType,
      target: STORAGE_TARGET,
      payload,
    });
  } catch (error) {
    console.warn(
      "[UiSessionRuntime] Failed to initialize storage runtime action:",
      error,
    );
    return false;
  }
}

export async function ensureUiSessionRuntimeStarted(): Promise<void> {
  if (hasStarted) {
    return;
  }

  if (startPromise) {
    return startPromise;
  }

  startPromise = (async () => {
    await initDioxusRuntime();

    runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
      [
        UI_RUNTIME_EVENTS.sessionModalClose,
        UI_RUNTIME_EVENTS.sessionStorageChanged,
        UI_RUNTIME_EVENTS.sessionKeyboardChanged,
      ],
      async (event) => {
        if (event.type === UI_RUNTIME_EVENTS.sessionModalClose) {
          const payload = parseUiRuntimePayload(event.payload);
          const modal = parseUiRuntimeString(payload.modal);
          if (!modal) {
            return;
          }

          emitHostEvent({
            modal,
            reason: parseUiRuntimeString(payload.reason, "request"),
            atMs: event.atMs,
          });
          return;
        }

        if (event.type === UI_RUNTIME_EVENTS.sessionStorageChanged) {
          const detail = parseStoragePayload(event.payload);
          if (!detail) {
            return;
          }

          storageCache.set(detail.storageKey, detail.value);
          emitStorageHostEvent({
            storageKey: detail.storageKey,
            value: detail.value,
            atMs: event.atMs,
          });
          return;
        }

        if (event.type === UI_RUNTIME_EVENTS.sessionKeyboardChanged) {
          const detail = parseKeyboardPayload(event.payload);
          if (!detail) {
            return;
          }

          emitKeyboardHostEvent({
            key: detail.key,
            code: detail.code,
            isDown: detail.isDown,
            atMs: event.atMs,
          });
        }
      },
    );

    if (!keydownListenerAttached) {
      window.addEventListener("keydown", onGlobalKeyDown);
      keydownListenerAttached = true;
    }
    if (!keyupListenerAttached) {
      window.addEventListener("keyup", onGlobalKeyUp);
      keyupListenerAttached = true;
    }
    if (!beforeUnloadListenerAttached) {
      window.addEventListener("beforeunload", onGlobalBeforeUnload);
      beforeUnloadListenerAttached = true;
    }
    if (!popstateListenerAttached) {
      window.addEventListener("popstate", onGlobalPopstate);
      popstateListenerAttached = true;
    }
    if (!hashchangeListenerAttached) {
      window.addEventListener("hashchange", onGlobalHashchange);
      hashchangeListenerAttached = true;
    }

    hasStarted = true;
  })();

  try {
    await startPromise;
  } finally {
    startPromise = null;
  }
}

export function reportUiModalState(modal: string, isOpen: boolean): boolean {
  return dispatchUiAction({
    type: UI_RUNTIME_ACTIONS.sessionModalState,
    payload: {
      modal,
      isOpen,
    },
  });
}

export function requestUiModalClose(modal: string, reason: string): boolean {
  return dispatchUiAction({
    type: UI_RUNTIME_ACTIONS.sessionModalCloseRequest,
    payload: {
      modal,
      reason,
    },
  });
}

export function getUiSessionStorageCachedValue(
  storageKey: string,
): string | null | undefined {
  const normalizedStorageKey = storageKey.trim();
  if (!normalizedStorageKey) {
    return undefined;
  }

  const browserValue = readBrowserStorageValue(normalizedStorageKey);
  if (browserValue !== undefined) {
    storageCache.set(normalizedStorageKey, browserValue);
    return browserValue;
  }

  return storageCache.get(normalizedStorageKey);
}

export async function readUiSessionStorage(
  storageKey: string,
  options?: { timeoutMs?: number },
): Promise<string | null | undefined> {
  const normalizedStorageKey = storageKey.trim();
  if (!normalizedStorageKey) {
    return undefined;
  }

  await ensureUiSessionRuntimeStarted();

  const dispatched = await dispatchSessionStorageAction(
    UI_RUNTIME_ACTIONS.sessionStorageRead,
    {
      storageKey: normalizedStorageKey,
    },
  );
  if (!dispatched) {
    const browserValue = readBrowserStorageValue(normalizedStorageKey);
    if (browserValue !== undefined) {
      storageCache.set(normalizedStorageKey, browserValue);
      return browserValue;
    }
    return undefined;
  }

  const event = await waitForUiRuntimeEvent(
    UI_RUNTIME_EVENTS.sessionStorageReadResult,
    {
      timeoutMs: options?.timeoutMs ?? 500,
      predicate: (runtimeEvent) => {
        const detail = parseStoragePayload(runtimeEvent.payload);
        return detail?.storageKey === normalizedStorageKey;
      },
    },
  );
  if (!event) {
    const browserValue = readBrowserStorageValue(normalizedStorageKey);
    if (browserValue !== undefined) {
      storageCache.set(normalizedStorageKey, browserValue);
      return browserValue;
    }
    return undefined;
  }

  const detail = parseStoragePayload(event.payload);
  if (!detail) {
    const browserValue = readBrowserStorageValue(normalizedStorageKey);
    if (browserValue !== undefined) {
      storageCache.set(normalizedStorageKey, browserValue);
      return browserValue;
    }
    return undefined;
  }

  storageCache.set(detail.storageKey, detail.value);
  return detail.value;
}

export async function writeUiSessionStorage(
  storageKey: string,
  value: string,
  options?: { timeoutMs?: number },
): Promise<boolean> {
  const normalizedStorageKey = storageKey.trim();
  if (!normalizedStorageKey) {
    return false;
  }

  await ensureUiSessionRuntimeStarted();

  const dispatched = await dispatchSessionStorageAction(
    UI_RUNTIME_ACTIONS.sessionStorageWrite,
    {
      storageKey: normalizedStorageKey,
      value,
    },
  );
  if (!dispatched) {
    const didWrite = writeBrowserStorageValue(normalizedStorageKey, value);
    if (didWrite) {
      storageCache.set(normalizedStorageKey, value);
      emitStorageHostEvent({
        storageKey: normalizedStorageKey,
        value,
      });
    }
    return didWrite;
  }

  const event = await waitForUiRuntimeEvent(
    UI_RUNTIME_EVENTS.sessionStorageChanged,
    {
      timeoutMs: options?.timeoutMs ?? 500,
      predicate: (runtimeEvent) => {
        const detail = parseStoragePayload(runtimeEvent.payload);
        return (
          detail?.storageKey === normalizedStorageKey && detail.value === value
        );
      },
    },
  );
  if (!event) {
    const didWrite = writeBrowserStorageValue(normalizedStorageKey, value);
    if (didWrite) {
      storageCache.set(normalizedStorageKey, value);
      emitStorageHostEvent({
        storageKey: normalizedStorageKey,
        value,
      });
    }
    return didWrite;
  }

  const detail = parseStoragePayload(event.payload);
  if (detail) {
    storageCache.set(detail.storageKey, detail.value);
  }
  return true;
}

export async function removeUiSessionStorage(
  storageKey: string,
  options?: { timeoutMs?: number },
): Promise<boolean> {
  const normalizedStorageKey = storageKey.trim();
  if (!normalizedStorageKey) {
    return false;
  }

  await ensureUiSessionRuntimeStarted();

  const dispatched = await dispatchSessionStorageAction(
    UI_RUNTIME_ACTIONS.sessionStorageRemove,
    {
      storageKey: normalizedStorageKey,
    },
  );
  if (!dispatched) {
    const didRemove = removeBrowserStorageValue(normalizedStorageKey);
    if (didRemove) {
      storageCache.set(normalizedStorageKey, null);
      emitStorageHostEvent({
        storageKey: normalizedStorageKey,
        value: null,
      });
    }
    return didRemove;
  }

  const event = await waitForUiRuntimeEvent(
    UI_RUNTIME_EVENTS.sessionStorageChanged,
    {
      timeoutMs: options?.timeoutMs ?? 500,
      predicate: (runtimeEvent) => {
        const detail = parseStoragePayload(runtimeEvent.payload);
        return detail?.storageKey === normalizedStorageKey && detail.value === null;
      },
    },
  );

  if (!event) {
    const didRemove = removeBrowserStorageValue(normalizedStorageKey);
    if (didRemove) {
      storageCache.set(normalizedStorageKey, null);
      emitStorageHostEvent({
        storageKey: normalizedStorageKey,
        value: null,
      });
    }
    return didRemove;
  }

  const detail = parseStoragePayload(event.payload);
  if (detail) {
    storageCache.set(detail.storageKey, detail.value);
  }
  return true;
}

export function primeUiSessionStorage(storageKey: string): void {
  const normalizedStorageKey = storageKey.trim();
  if (!normalizedStorageKey || storageCache.has(normalizedStorageKey)) {
    return;
  }

  void readUiSessionStorage(normalizedStorageKey);
}
