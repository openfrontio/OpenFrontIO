import { ReactiveController, ReactiveControllerHost } from "lit";

export type KeyboardLayoutMap = Map<string, string>;
declare global {
  interface Navigator {
    keyboard?: {
      getLayoutMap(): Promise<KeyboardLayoutMap>;
      addEventListener(event: string, callback: () => void): void;
    };
  }
}

let globalLayoutMap: KeyboardLayoutMap | null = null;
const listeners = new Set<() => void>();
let initialized = false;
let refreshId = 0;

async function refreshGlobalLayoutMap() {
  if (!navigator.keyboard) return;
  const currentRefreshId = ++refreshId;
  try {
    const newMap = await navigator.keyboard.getLayoutMap();
    if (currentRefreshId === refreshId) {
      globalLayoutMap = newMap;
      for (const listener of listeners) {
        listener();
      }
    }
  } catch (e) {
    // Ignore
  }
}

export class KeyboardLayoutController implements ReactiveController {
  private host: ReactiveControllerHost;

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  get map(): KeyboardLayoutMap | null {
    return globalLayoutMap;
  }

  hostConnected() {
    if (!initialized) {
      initialized = true;
      if (navigator.keyboard) {
        navigator.keyboard.addEventListener(
          "layoutchange",
          refreshGlobalLayoutMap,
        );
        refreshGlobalLayoutMap();
      }
    }
    listeners.add(this.onUpdate);
  }

  hostDisconnected() {
    listeners.delete(this.onUpdate);
  }

  private onUpdate = () => {
    this.host.requestUpdate();
  };
}

export function resetKeyboardLayoutForTests() {
  initialized = false;
  globalLayoutMap = null;
  listeners.clear();
  refreshId = 0;
}
