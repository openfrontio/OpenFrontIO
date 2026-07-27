import { ClientEnv } from "src/client/ClientEnv";
import { PublicGames, PublicLobbyMessageSchema } from "../core/Schemas";

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
    // Get config to determine number of workers, then pick a random one
    this.workerPath = getRandomWorkerPath(ClientEnv.numWorkers());
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
      const message = PublicLobbyMessageSchema.parse(
        JSON.parse(event.data as string),
      );
      if (message.type === "full") {
        this.checkServerCommit(message.gitCommit);
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

  private checkServerCommit(serverCommit: string | undefined) {
    if (this.updateAvailableFired || this.onUpdateAvailable === undefined) {
      return;
    }
    if (serverCommit === undefined) return;
    const ownCommit = ClientEnv.gitCommit();
    if (ownCommit === "DEV" || serverCommit === ownCommit) return;
    this.updateAvailableFired = true;
    this.onUpdateAvailable();
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
    } else {
      this.scheduleReconnect();
    }
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
      alert("error connecting to game service");
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
