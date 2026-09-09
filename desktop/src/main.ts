// Offline desktop shell for OpenFront solo mode.
//
// Serves the production client bundle (../static) over a custom app://openfront
// protocol — the same shape the game's ClientEnv already anticipates for a
// desktop shell (see src/client/ClientEnv.ts resolveServerOrigin). The client's
// solo mode runs entirely in the renderer (LocalServer + inlined core worker),
// so no game server is needed. Optional web services (accounts, cosmetics,
// archiving) fail silently offline, which the client already tolerates.

import { app, BrowserWindow, protocol, session, shell } from "electron";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

const APP_ORIGIN = "app://openfront";
const WIN_WIDTH = 1280;
const WIN_HEIGHT = 800;

// Total in-memory asset-cache budget (compressed size of static/ is ~500 MB,
// but the hot set — JS/CSS/atlas/maps/sprites for one match — is ~25 MB).
const ASSET_CACHE_MAX_BYTES = 256 * 1024 * 1024;

// Windows GUI-subprocess stdout is unreliable when spawned from scripts, so
// the shell logs to a file next to the executable when OPENFRONT_DESKTOP_LOG
// is set. The smoke test reads this file to see what happened.
const logFile = process.env.OPENFRONT_DESKTOP_LOG
  ? path.resolve(process.env.OPENFRONT_DESKTOP_LOG)
  : null;
// Per-request serving logs are written only when diagnostics are requested:
// log() is a synchronous append (fs.appendFileSync) on the MAIN PROCESS, so
// logging every asset request both blocks serving and adds ~60ms of disk I/O
// to game startup.
const verbose = process.env.OPENFRONT_DESKTOP_VERBOSE === "1";
let logCount = 0;
const LOG_MAX = 2000;
function log(message: string): void {
  if (!logFile) return;
  if (logCount >= LOG_MAX) return;
  logCount++;
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(logFile, line);
  } catch {
    /* best effort */
  }
}

// Smoke-test mode: --renderer-script-file=<path> points at a JS file that is
// evaluated in the page after load; its return value (or thrown error) is
// printed as SMOKE_OK/SMOKE_FAIL and the app exits. A file (not an inline
// arg) because the script is far larger than Windows' command-line limit.
// Used by offlineSmoke.ts to drive the real UI end-to-end.
const rendererScriptFileArg = process.argv.find((a) =>
  a.startsWith("--renderer-script-file="),
);
const smokeTestMode = rendererScriptFileArg !== undefined;
const rendererScript = rendererScriptFileArg
  ? fs.readFileSync(
      rendererScriptFileArg.slice("--renderer-script-file=".length),
      "utf-8",
    )
  : null;

// static/ at the repo root: index.html plus Vite's assets/ and the hashed
// _assets/ copied by the production build. In the packaged app this folder
// ships inside the app resources.
const STATIC_DIR = (() => {
  // Packaged: <resources>/app.asar/desktop/... or resources/static
  const packaged = path.join(process.resourcesPath ?? "", "static");
  if (fs.existsSync(packaged)) return packaged;
  // Dev: <repo>/desktop/dist/main.js -> <repo>/static
  return path.resolve(__dirname, "..", "..", "static");
})();

const ASSET_MANIFEST_PATH = path.join(STATIC_DIR, "asset-manifest.json");

const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".xml": "text/xml",
  ".mp3": "audio/mpeg",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

// Vite's assets/ and the build's hashed _assets/ are content-addressed:
// the hash in the filename IS the version, so byte-for-byte immutable.
// Immutable responses let Chromium's HTTP cache serve them instantly on
// every restart, instead of re-fetching ~30 MB through the protocol handler.
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

// In-memory byte cache for served files, LRU by insertion order. A map of
// Path -> Buffer; entries larger than the budget pass through uncached.
const assetCache = new Map<string, Buffer>();
let assetCacheBytes = 0;
function cachePut(filePath: string, data: Buffer): void {
  if (data.byteLength > ASSET_CACHE_MAX_BYTES) return;
  // Recency: re-insert to move to the tail.
  assetCache.delete(filePath);
  assetCache.set(filePath, data);
  assetCacheBytes += data.byteLength;
  while (assetCacheBytes > ASSET_CACHE_MAX_BYTES && assetCache.size > 1) {
    const oldestKey = assetCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = assetCache.get(oldestKey);
    assetCache.delete(oldestKey);
    assetCacheBytes -= oldest?.byteLength ?? 0;
  }
}

// Resolve a public asset name (e.g. "images/background.webp") through the
// built asset-manifest.json to its hashed /_assets/... URL, the same way the
// web server's RenderHtml.ts does. Falls back to the unhashed path (the
// dev server serves resources/ directly).
function assetHref(name: string): string {
  try {
    if (fs.existsSync(ASSET_MANIFEST_PATH)) {
      const manifest = JSON.parse(
        fs.readFileSync(ASSET_MANIFEST_PATH, "utf-8"),
      ) as Record<string, string>;
      const mapped = manifest[name];
      if (mapped) return mapped;
    }
  } catch {
    /* fall through to unhashed */
  }
  return `/${name}`;
}

// The built index.html is an EJS template (see src/server/RenderHtml.ts for
// the web equivalent). Render it once at startup with offline values:
// empty cdnBase (same-origin app:// URLs), desktop instanceId (disables ads
// and Turnstile client-side), and offlineShell (strips third-party scripts).
function renderIndexHtml(): string {
  // Lazy require so Electron's bundled Node has it after desktop/node_modules
  // is present. Loaded from the desktop package's own node_modules.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ejs = require("ejs") as typeof import("ejs");
  const template = fs.readFileSync(
    path.join(STATIC_DIR, "index.html"),
    "utf-8",
  );
  const assetManifest = fs.existsSync(ASSET_MANIFEST_PATH)
    ? fs.readFileSync(ASSET_MANIFEST_PATH, "utf-8")
    : "{}";
  return ejs.render(template, {
    gitCommit: JSON.stringify("desktop-offline"),
    assetManifest,
    // The core simulation worker is an INLINE BLOB worker (Vite
    // ?worker&inline). Blob workers have no origin of their own, so a
    // root-relative URL like /_assets/maps/... cannot resolve inside them —
    // fetch() throws "Failed to parse URL" and the match never starts. The
    // production web build never hits this because its cdnBase is always an
    // absolute CDN origin, making every assetUrl() absolute. Mirror that:
    // cdnBase = the app:// origin, so main thread AND worker resolve
    // app://openfront/... absolute URLs that the protocol handler serves.
    cdnBase: JSON.stringify(APP_ORIGIN),
    // Raw (unquoted) prefix for <script src="<%- cdnBaseRaw %>/assets/...">:
    // empty, same-origin.
    cdnBaseRaw: "",
    gameEnv: JSON.stringify("dev"),
    numWorkers: JSON.stringify(1),
    turnstileSiteKey: JSON.stringify(""),
    jwtAudience: JSON.stringify("localhost"),
    instanceId: JSON.stringify("desktop"),
    offlineShell: true,
    // Asset URLs resolved through the manifest, mirroring RenderHtml.ts.
    manifestHref: assetHref("manifest.json"),
    faviconHref: assetHref("images/Favicon.svg"),
    gameplayScreenshotUrl: assetHref("images/GameplayScreenshot.png"),
    backgroundImageUrl: assetHref("images/background.webp"),
    desktopLogoImageUrl: assetHref("images/OpenFront.png"),
    mobileLogoImageUrl: assetHref("images/OF.png"),
  });
}

// Register app:// as a privileged scheme before app ready so fetch/XHR from
// the renderer get proper support (cors, stream, code support) and the
// origin behaves like a real one for localStorage etc.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      // Cache compiled bytecode for scripts served over app:// (the ~3 MB
      // game bundle + 627 KB worker are the largest boot cost; with the
      // code cache, later launches skip full V8 re-parse).
      codeCache: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
    minWidth: 800,
    minHeight: 600,
    title: "OpenFront (Offline)",
    backgroundColor: "#262626",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Solo mode needs WebGL, workers and the audio API; all standard.
      webgl: true,
      // The sim ticks on wall-clock time (LocalServer's 5ms interval): timer
      // throttling in an unfocused/occluded window would pause turns.
      backgroundThrottling: false,
      // No text is ever typed into the game; skip spellcheck worker setup.
      spellcheck: false,
      // V8 code cache for the renderer: the multi-MB game bundle parses
      // once, then starts from cached bytecode on every later launch.
      v8CacheOptions: "bypassHeatCheck",
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Block all non-app:// network traffic. The game is fully playable offline;
  // remaining calls (accounts/cosmetics/archive) would only slow startup.
  // Scoped to http/https/ws schemes only: app:// and devtools:// traffic
  // never pays the listener round-trip.
  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (details, callback) => {
      log(`MAIN: blocked request ${details.url}`);
      callback({ cancel: true });
    },
  );

  // Open real external links (none expected offline) in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // Verify GPU acceleration is actually on. A software WebGL context is the
  // single biggest performance cliff for this game; surface it immediately
  // in diagnostics rather than letting it look like general slowness.
  app.getGPUInfo("complete").then(
    (info) => {
      const gl = (info as { graphics?: { status?: string } }).graphics;
      log(`MAIN: GPU status ${gl?.status ?? "unknown"}`);
    },
    (err: unknown) => log(`MAIN: GPU info failed: ${String(err)}`),
  );

  let indexHtmlCache: string | null = null;
  protocol.handle("app", (request) => {
    // The handler returns promises; protocol.handle awaits them, so no
    // try/catch here — a rejection is reported by Electron as a network
    // error to the renderer, which is the correct shape.
    return handleAppRequest(request);
  });

  async function handleAppRequest(request: Parameters<
    Parameters<typeof protocol.handle>[1]
  >[0]): Promise<Response> {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === "/" || pathname === "/index.html") {
      indexHtmlCache ??= renderIndexHtml();
      return new Response(indexHtmlCache, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    // Strip leading slash to resolve inside staticDir.
    const relative = pathname.replace(/^\/+/, "");
    if (relative.includes("..")) {
      return new Response("Forbidden", { status: 403 });
    }
    const filePath = path.join(STATIC_DIR, relative);
    if (!filePath.startsWith(STATIC_DIR)) {
      return new Response("Forbidden", { status: 403 });
    }
    const cached = assetCache.get(filePath);
    if (cached !== undefined) {
      if (verbose) log(`MAIN: serving (cached) ${pathname}`);
      return responseFor(filePath, cached);
    }
    let data: Buffer;
    try {
      data = await fsp.readFile(filePath);
    } catch {
      log(`MAIN: 404 ${pathname}`);
      return new Response("Not found", { status: 404 });
    }
    cachePut(filePath, data);
    if (verbose) log(`MAIN: serving ${pathname}`);
    return responseFor(filePath, data);
  }

  function responseFor(filePath: string, data: Buffer): Response {
    const ext = path.extname(filePath).toLowerCase();
    const headers: Record<string, string> = {
      "Content-Type": MIME_BY_EXT[ext] ?? "application/octet-stream",
    };
    // Content-addressed files are immutable — let Chromium's disk cache
    // serve them on later launches without a single protocol round-trip.
    if (relativeImmutable(filePath)) {
      headers["Cache-Control"] = IMMUTABLE_CACHE_CONTROL;
    }
    return new Response(data, { headers });
  }

  const IMMUTABLE_PREFIXES = [
    path.join(STATIC_DIR, "assets") + path.sep,
    path.join(STATIC_DIR, "_assets") + path.sep,
  ];
  function relativeImmutable(filePath: string): boolean {
    return IMMUTABLE_PREFIXES.some((p) => filePath.startsWith(p));
  }

  mainWindow
    .loadURL(`${APP_ORIGIN}/index.html`)
    .then(() => log("MAIN: loadURL resolved"))
    .catch((err: unknown) => log(`MAIN: loadURL rejected: ${String(err)}`));

  // Diagnostics also used by the smoke test. Errors and SMOKE_ markers are
  // always logged (when a log file was requested); everything else only in
  // verbose mode, and never more than a bounded number of lines.
  mainWindow.webContents.on(
    "console-message",
    (_event, level, message) => {
      if (message.includes("SMOKE_")) {
        log(message);
      } else if (level >= 2 || verbose) {
        log(`CONSOLE[${level}]: ${message.slice(0, 500)}`);
      }
    },
  );
  mainWindow.webContents.on("did-finish-load", () => {
    log("MAIN: did-finish-load");
  });
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    log(`MAIN: did-fail-load ${code} ${desc} ${url}`);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    log(`MAIN: render-process-gone ${details.reason}`);
  });

  if (smokeTestMode && rendererScript) {
    mainWindow.webContents.on("did-finish-load", () => {
      void mainWindow?.webContents
        .executeJavaScript(
          // rendererScript is already a full expression: `(async () => {...})()`.
          `(async () => { try { const r = await ${rendererScript}; console.log("SMOKE_RESULT:" + JSON.stringify(r)); return r; } catch (e) { console.log("SMOKE_FAIL: " + (e && e.message ? e.message : String(e))); return null; } })()`,
          false,
        )
        .then((result) => {
          if (result === "READY_FOR_SCREENSHOT") {
            // Screenshot mode: capture the running game, then exit.
            setTimeout(() => {
              const img = mainWindow?.webContents.capturePage();
              if (img) {
                img.then((nativeImage) => {
                  const target = process.env.OPENFRONT_SCREENSHOT ?? "";
                  if (target) {
                    fs.writeFileSync(target, nativeImage.toPNG());
                    log(`MAIN: screenshot saved to ${target}`);
                  }
                  log("SMOKE_OK");
                  app.quit();
                });
              }
            }, 1000);
          } else if (result === "SMOKE_OK") {
            log("SMOKE_OK");
            app.quit();
          } else {
            log(`SMOKE_FAIL: renderer script returned ${String(result)}`);
            app.quit();
          }
        })
        .catch((err: unknown) => {
          log(`SMOKE_FAIL: ${String(err)}`);
          app.quit();
        });
    });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  log("MAIN: app ready");
  try {
    createWindow();
    log("MAIN: window created");
  } catch (err) {
    log(`MAIN: createWindow threw: ${String(err)}`);
    app.quit();
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
