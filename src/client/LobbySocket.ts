import { GameInfo } from "../core/Schemas";

type LobbyUpdateHandler = (lobbies: GameInfo[]) => void;

interface LobbySocketOptions {
  reconnectDelay?: number;
  maxWsAttempts?: number;
  pollIntervalMs?: number;
}

export class PublicLobbySocket {
  private ws: WebSocket | null = null;
  private wsReconnectTimeout: number | null = null;
  private fallbackPollInterval: number | null = null;
  private wsConnectionAttempts = 0;
  private wsAttemptCounted = false;

  private readonly reconnectDelay: number;
  private readonly maxWsAttempts: number;
  private readonly pollIntervalMs: number;
  private readonly onLobbiesUpdate: LobbyUpdateHandler;

  constructor(
    onLobbiesUpdate: LobbyUpdateHandler,
    options?: LobbySocketOptions,
  ) {
    this.onLobbiesUpdate = onLobbiesUpdate;
    this.reconnectDelay = options?.reconnectDelay ?? 3000;
    this.maxWsAttempts = options?.maxWsAttempts ?? 3;
    this.pollIntervalMs = options?.pollIntervalMs ?? 1000;
  }

  start() {
    this.wsConnectionAttempts = 0;
    this.connectWebSocket();
  }

  stop() {
    this.disconnectWebSocket();
    this.stopFallbackPolling();
  }

  private connectWebSocket() {
    try {
      // Clean up existing WebSocket before creating a new one
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/lobbies`;

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
    this.stopFallbackPolling();
  }

  private handleMessage(event: MessageEvent) {
    try {
      const message = JSON.parse(event.data as string);
      if (message.type === "lobbies_update") {
        this.onLobbiesUpdate(message.data?.lobbies ?? []);
      }
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
      console.log(
        "Max WebSocket attempts reached, falling back to HTTP polling",
      );
      this.startFallbackPolling();
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
      this.startFallbackPolling();
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

  private startFallbackPolling() {
    if (this.fallbackPollInterval !== null) return;
    console.log("Starting HTTP fallback polling");
    this.fetchLobbiesHTTP();
    this.fallbackPollInterval = window.setInterval(() => {
      this.fetchLobbiesHTTP();
    }, this.pollIntervalMs);
  }

  private stopFallbackPolling() {
    if (this.fallbackPollInterval !== null) {
      clearInterval(this.fallbackPollInterval);
      this.fallbackPollInterval = null;
    }
  }

  private async fetchLobbiesHTTP() {
    try {
      const response = await fetch(`/api/public_lobbies`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      this.onLobbiesUpdate(data.lobbies as GameInfo[]);
    } catch (error) {
      console.error("Error fetching lobbies via HTTP:", error);
    }
  }
}
