import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { PublicGames, PublicGamesSchema } from "../core/Schemas";

interface LobbySocketOptions {
  reconnectDelay?: number;
  maxWsAttempts?: number;
  pollIntervalMs?: number;
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

  private readonly reconnectDelay: number;
  private readonly maxWsAttempts: number;

  constructor(
    private onLobbiesUpdate: (data: PublicGames) => void,
    options?: LobbySocketOptions,
  ) {
    this.reconnectDelay = options?.reconnectDelay ?? 3000;
    this.maxWsAttempts = options?.maxWsAttempts ?? 3;
  }

  async start() {
    this.wsConnectionAttempts = 0;
    // Get config to determine number of workers, then pick a random one
    const config = await getServerConfigFromClient();
    this.workerPath = getRandomWorkerPath(config.numWorkers());
    this.connectWebSocket();
  }

  stop() {
    this.disconnectWebSocket();
  }

  private connectWebSocket() {
    try {
      // Clean up existing WebSocket before creating a new one
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}${this.workerPath}/lobbies`;

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
      const publicGames = PublicGamesSchema.parse(
        JSON.parse(event.data as string),
      );
      this.onLobbiesUpdate(publicGames);
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

  private handleClose() {
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
