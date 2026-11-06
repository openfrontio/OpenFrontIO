// Poki counts a session from the SDK's init() to the page unloading, and
// leaving any game reloads our frame. So the SDK lives in the wrapper page we
// upload to Poki (which never reloads) and our frame calls it over
// postMessage. The wrapper (PokiWrapper.html) marks the frame's URL
// with BRIDGE_PARAM.

type PokiApi = NonNullable<Window["PokiSDK"]>;

const BRIDGE_PARAM = "pokiBridge";
const BRIDGE_SESSION_KEY = "pokiBridge";

type Reply = { ofPoki: true; id: string; result?: unknown; error?: string };
type AdStarted = { ofPoki: true; id: string; event: "commercialBreakStart" };

// Same storage caveat as PokiSDK's readSession: a sandboxed frame can throw.
function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // See readSession.
  }
}

// The marker is only on the URL the wrapper first loads us with; our routing
// drops it, so it's kept for the frame's session like the Poki detection.
// Run after keepPokiParams: a URL with Poki's params is then a wrapper's load
// (or a copy of it), whose marker decides, so a frame later loaded by a
// wrapper without the bridge stops waiting for one.
export function isPokiBridged(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.has(BRIDGE_PARAM)) {
    writeSession(BRIDGE_SESSION_KEY, "true");
    return true;
  }
  if (params.has("site_id")) {
    writeSession(BRIDGE_SESSION_KEY, "false");
    return false;
  }
  return readSession(BRIDGE_SESSION_KEY) === "true";
}

// Ids are unique across reloads: a reply to the page before one (a token
// fetch cut short, say) must not settle this page's call of the same number.
const pageId = Math.random().toString(36).slice(2);
let nextId = 0;
const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    onAdStart?: () => void;
  }
>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const data = event.data as Reply | AdStarted | null;
    if (data?.ofPoki !== true) return;
    const call = pending.get(data.id);
    if (call === undefined) return;
    if ("event" in data) {
      call.onAdStart?.();
      return;
    }
    pending.delete(data.id);
    if (data.error !== undefined) {
      call.reject(new Error(data.error));
    } else {
      call.resolve(data.result);
    }
  });
}

// Requests carry nothing secret, and the wrapper's origin (a Poki CDN host)
// isn't known up front, hence "*". Replies are only taken from our parent.
function call<T>(
  method: string,
  args: unknown[] = [],
  onAdStart?: () => void,
): Promise<T> {
  listen();
  const id = `${pageId}:${++nextId}`;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      onAdStart,
    });
    window.parent.postMessage({ ofPoki: true, id, method, args }, "*");
  });
}

function send(method: string, args: unknown[] = []): void {
  window.parent.postMessage({ ofPoki: true, method, args }, "*");
}

// The SDK reads gd-prefixed params (shareableURL's) from the game's URL. Ours
// is the wrapper's query, which keepPokiParams keeps minus the gd* invite
// params, so a reload doesn't rejoin the invite's lobby.
function getURLParam(name: string): string {
  const params = new URLSearchParams(window.location.search);
  const gd = params.get(`gd${name}`);
  if (gd !== null && gd !== "") return gd;
  return params.get(name) ?? "";
}

// Resolves to the wrapper's SDK, or null when its script didn't load (e.g. an
// adblocker), like PokiSDK's own script load.
export async function connectPokiBridge(): Promise<PokiApi | null> {
  if (!(await call<boolean>("hello"))) return null;
  return {
    init: () => call("init"),
    gameLoadingFinished: () => send("gameLoadingFinished"),
    gameplayStart: () => send("gameplayStart"),
    gameplayStop: () => send("gameplayStop"),
    commercialBreak: (onStart) => call("commercialBreak", [], onStart),
    shareableURL: (params) => call("shareableURL", [params]),
    getURLParam,
    openExternalLink: (url) => send("openExternalLink", [url]),
    login: () => call("login"),
    getUser: () => call("getUser"),
    getToken: () => call("getToken"),
  };
}
