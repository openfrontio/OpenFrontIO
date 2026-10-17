import { ReactiveController, ReactiveControllerHost } from "lit";

export type KeyboardLayoutMap = Map<string, string>;

type KeyboardApi = {
  getLayoutMap(): Promise<KeyboardLayoutMap>;
  addEventListener(event: string, callback: () => void): void;
  removeEventListener?(event: string, callback: () => void): void;
};

function getKeyboardApi(): KeyboardApi | undefined {
  // Keep the compatibility type local rather than augmenting Navigator, whose
  // keyboard property is already declared by current TypeScript DOM libraries.
  return (navigator as unknown as { keyboard?: KeyboardApi }).keyboard;
}

let globalLayoutMap: KeyboardLayoutMap | null = null;
let listeningKeyboard: KeyboardApi | null = null;
const listeners = new Set<() => void>();
let initialized = false;
let refreshId = 0;

async function refreshGlobalLayoutMap() {
  const keyboard = getKeyboardApi();
  if (!keyboard) return;
  const currentRefreshId = ++refreshId;
  try {
    const newMap = await keyboard.getLayoutMap();
    if (currentRefreshId === refreshId) {
      globalLayoutMap = newMap;
      for (const listener of listeners) {
        listener();
      }
    }
  } catch {
    // The API is not available in every browser; static key labels remain usable.
  }
}

export class KeyboardLayoutController implements ReactiveController {
  constructor(private readonly host: ReactiveControllerHost) {
    host.addController(this);
  }

  get map(): KeyboardLayoutMap | null {
    return globalLayoutMap;
  }

  hostConnected() {
    if (!initialized) {
      initialized = true;
      const keyboard = getKeyboardApi();
      if (keyboard) {
        listeningKeyboard = keyboard;
        keyboard.addEventListener("layoutchange", refreshGlobalLayoutMap);
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
  listeningKeyboard?.removeEventListener?.(
    "layoutchange",
    refreshGlobalLayoutMap,
  );
  listeningKeyboard = null;
  initialized = false;
  globalLayoutMap = null;
  listeners.clear();
  refreshId = 0;
}
