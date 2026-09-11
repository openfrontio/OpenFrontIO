import { ClientEnv, NoServerError } from "src/client/ClientEnv";
import { PublicGames } from "../core/Schemas";
import { decodeLobbyMessage } from "../core/ZbinWire";
import { showInGameAlert } from "./InGameModal";
import { ensureServerList } from "./ServerList";
import { translateText } from "./Utils";

interface LobbySocketOptions {
  reconnectDelay?: number;
  maxWsAttempts?: number;
  pollIntervalMs?: number;
  // Fired at most once, when the server advertises a different build commit
  // than this bundle — i.e. a new version deployed while this tab was open.
  onUpdateAvailable?: () => void;
}

function getRandomWorkerPath(numWorkers: number): string {
  const workerIndex = Math.floor(Math.random() * numWorkers);
  return `/w${workerIndex}`;
}

export class PublicLobbySocket {
  private ws: WebSocket | null = null;
  private wsReconnectTimeout: number | null = null;
  private wsConnectionAttempts = 0;
  private wsAttemptCounted = false;
  private workerPath: string = "";
  private stopped = true;
  // Latest full snapshot, used as the base for applying counts-only deltas.
  private lastFull: PublicGames | null = null;

  private readonly reconnectDelay: number;
  private readonly maxWsAttempts: number;
  private readonly onUpdateAvailable?: () => void;
  private updateAvailableFired = false;

  constructor(
    private onLobbiesUpdate: (data: PublicGames) => void,
    options?: LobbySocketOptions,
  ) {
    this.reconnectDelay = options?.reconnectDelay ?? 3000;
    this.maxWsAttempts = options?.maxWsAttempts ?? 3;
    this.onUpdateAvailable = options?.onUpdateAvailable;
  }

  async start() {
    this.stopped = false;
    this.wsConnectionAttempts = 0;
    // The lobby list needs a server: ask the API which one (multi-server
    // v2), falling back to the page's own values. It answers "outdated"
    // when no server takes new games from this build any more and a newer
    // version exists — the rollover has moved on without this tab. The
    // lobby list is the first thing every homepage starts, so this is where
    // the player finds out: the same one-shot "update available" prompt a
    // newer commit in the feed raises. The connection goes ahead either
    // way, so a shell that never prompts (desktop, whose updater owns
    // updates) still gets its lobby list from the fallback values.
    const listStatus = await ensureServerList();
    if (this.stopped) return;
    if (listStatus === "outdated") this.fireUpdateAvailable();
    // Get config to determine number of workers, then pick a random one.
    // With no list and nothing injected there is no server to ask (a static
    // page while the API is unreachable), which is a connection failure like
    // any other: take the same path a refused socket does rather than
    // rejecting a promise most callers never await.
    try {
      this.workerPath = getRandomWorkerPath(ClientEnv.numWorkers());
    } catch (e) {
      if (!(e instanceof NoServerError)) throw e;
      this.handleConnectError(e);
      return;
    }
    this.connectWebSocket();
  }

  stop() {
    this.stopped = true;
    this.lastFull = null;
    this.disconnectWebSocket();
  }

  private connectWebSocket() {
    try {
      // Clean up existing WebSocket before creating a new one
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      // Drop any cached snapshot — the server primes new connections with a
      // fresh full message, and a stale base could mis-merge incoming deltas.
      this.lastFull = null;

      // WS origin comes from ClientEnv (same-origin on web, audience-derived on
      // the desktop app://openfront origin), not window.location.host.
      const wsUrl = `${ClientEnv.serverWsBase()}${this.workerPath}/lobbies`;

      this.ws = new WebSocket(wsUrl);
      // Frames are zbin payloads; without this they would arrive as Blobs.
      this.ws.binaryType = "arraybuffer";
      this.wsAttemptCounted = false;

      this.ws.addEventListener("open", () => this.handleOpen());
      this.ws.addEventListener("message", (event) => this.handleMessage(event));
      this.ws.addEventListener("close", () => this.handleClose());
      this.ws.addEventListener("error", (error) => this.handleError(error));
    } catch (error) {
      this.handleConnectError(error);
    }
  }

  private handleOpen() {
    console.log("WebSocket connected: lobby updating");
    this.wsConnectionAttempts = 0;
    if (this.wsReconnectTimeout !== null) {
      clearTimeout(this.wsReconnectTimeout);
      this.wsReconnectTimeout = null;
    }
  }

  private handleMessage(event: MessageEvent) {
    try {
      const message = decodeLobbyMessage(
        new Uint8Array(event.data as ArrayBuffer),
      );
      if (message.type === "full") {
        this.checkServerCommit(message.gitCommit);
        this.checkDeploymentActive(message.active);
        this.lastFull = {
          serverTime: message.serverTime,
          games: message.games,
        };
        this.onLobbiesUpdate(this.lastFull);
        return;
      }
      // counts: patch numClients onto the last full snapshot. If we have no
      // base yet (shouldn't happen — server primes on connect), ignore it
      // and wait for the next full.
      if (this.lastFull === null) {
        return;
      }
      const patchedGames = { ...this.lastFull.games };
      for (const type of Object.keys(patchedGames) as Array<
        keyof typeof patchedGames
      >) {
        const list = patchedGames[type];
        if (!list) continue;
        patchedGames[type] = list.map((lobby) => {
          const next = message.counts[lobby.gameID];
          return next === undefined || next === lobby.numClients
            ? lobby
            : { ...lobby, numClients: next };
        });
      }
      this.lastFull = {
        serverTime: message.serverTime,
        games: patchedGames,
      };
      this.onLobbiesUpdate(this.lastFull);
    } catch (error) {
      console.error("Error parsing WebSocket message:", error);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.close();
        } catch (closeError) {
          console.error(
            "Error closing WebSocket after parse failure:",
            closeError,
          );
        }
      }
    }
  }

  // The one gate for the "update available" prompt: however this tab found
  // out (the server list at start, a newer commit in the feed, a drained
  // deployment), the player is asked at most once.
  private fireUpdateAvailable() {
    if (this.updateAvailableFired || this.onUpdateAvailable === undefined) {
      return;
    }
    this.updateAvailableFired = true;
    this.onUpdateAvailable();
  }

  private checkServerCommit(serverCommit: string | undefined) {
    if (this.updateAvailableFired || this.onUpdateAvailable === undefined) {
      return;
    }
    if (serverCommit === undefined) return;
    const ownCommit = ClientEnv.gitCommit();
    if (ownCommit === "DEV" || serverCommit === ownCommit) return;
    this.fireUpdateAvailable();
  }

  // The deployment serving this feed says the load balancer routes elsewhere.
  // It has stopped queueing public lobbies, so without a reload this tab
  // would watch the list drain empty: the commit compare above can't catch
  // it, since this (pinned) server reports its own commit — equal to this
  // bundle's on a same-commit flip. A reload re-fetches the shell from the
  // site host, which repins to the active deployment.
  private checkDeploymentActive(active: boolean | undefined) {
    if (this.updateAvailableFired || this.onUpdateAvailable === undefined) {
      return;
    }
    if (active !== false) return;
    this.fireUpdateAvailable();
  }

  private handleClose() {
    if (this.stopped) return;
    console.log("WebSocket disconnected, attempting to reconnect...");
    if (!this.wsAttemptCounted) {
      this.wsAttemptCounted = true;
      this.wsConnectionAttempts++;
    }
    if (this.wsConnectionAttempts >= this.maxWsAttempts) {
      console.error("Max WebSocket attempts reached");
      void this.promptIfOutdated();
    } else {
      this.scheduleReconnect();
    }
  }

  // Reconnecting has given up. A tab that was already sitting on the
  // homepage when its server left the list (drained, then fenced or
  // removed) never gets a feed to learn from — it just watches the socket
  // fail — so ask the list again here. If nothing runs this build any more
  // and a newer version exists, this is the same one-shot prompt start()
  // raises. ensureServerList never throws and answers from the cached list,
  // so this costs nothing when the failure was only the network.
  private async promptIfOutdated(): Promise<void> {
    if (this.updateAvailableFired || this.onUpdateAvailable === undefined) {
      return;
    }
    const listStatus = await ensureServerList();
    if (this.stopped) return;
    if (listStatus === "outdated") this.fireUpdateAvailable();
  }

  private handleError(error: Event) {
    console.error("WebSocket error:", error);
  }

  private handleConnectError(error: unknown) {
    console.error("Error connecting WebSocket:", error);
    if (!this.wsAttemptCounted) {
      this.wsAttemptCounted = true;
      this.wsConnectionAttempts++;
    }
    if (this.wsConnectionAttempts >= this.maxWsAttempts) {
      void showInGameAlert(translateText("error_modal.connection_error"));
      void this.promptIfOutdated();
    } else {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.wsReconnectTimeout !== null) return;
    this.wsReconnectTimeout = window.setTimeout(() => {
      this.wsReconnectTimeout = null;
      this.connectWebSocket();
    }, this.reconnectDelay);
  }

  private disconnectWebSocket() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.wsReconnectTimeout !== null) {
      clearTimeout(this.wsReconnectTimeout);
      this.wsReconnectTimeout = null;
    }
  }
}
