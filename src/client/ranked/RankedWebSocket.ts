import { RankedQueueTicket } from "../../server/ranked/types";

type RankedUpdateCallback = (ticket: RankedQueueTicket) => void;

export class RankedWebSocket {
  private ws: WebSocket | null = null;
  private reconnectTimeout: number | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private playerId: string | null = null;
  private ticketId: string | null = null;
  private callbacks = new Set<RankedUpdateCallback>();

  constructor(private readonly serverUrl: string) {}

  connect(playerId: string, ticketId?: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Already connected, just update subscription
      if (ticketId && ticketId !== this.ticketId) {
        this.ticketId = ticketId;
        this.subscribe(playerId, ticketId);
      }
      return;
    }

    this.playerId = playerId;
    this.ticketId = ticketId ?? null;

    const wsUrl = this.serverUrl.replace(/^http/, "ws") + "/ws/ranked";
    console.log("[RankedWS] Connecting to", wsUrl);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("[RankedWS] Connected");
      this.reconnectAttempts = 0;
      if (this.playerId) {
        this.subscribe(this.playerId, this.ticketId ?? undefined);
      }
      // Start ping interval
      this.startPing();
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error("[RankedWS] Failed to parse message", error);
      }
    };

    this.ws.onclose = () => {
      console.log("[RankedWS] Disconnected");
      this.stopPing();
      this.attemptReconnect();
    };

    this.ws.onerror = (error) => {
      console.error("[RankedWS] Error", error);
    };
  }

  private subscribe(playerId: string, ticketId?: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "subscribe",
          playerId,
          ticketId,
        }),
      );
    }
  }

  private handleMessage(message: any): void {
    if (message.type === "ticket_update") {
      const ticket = message.ticket as RankedQueueTicket;
      this.callbacks.forEach((callback) => callback(ticket));
    } else if (message.type === "pong") {
      // Keep-alive response
    }
  }

  onUpdate(callback: RankedUpdateCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  private pingInterval: number | null = null;

  private startPing(): void {
    this.stopPing();
    this.pingInterval = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000); // Ping every 30 seconds
  }

  private stopPing(): void {
    if (this.pingInterval !== null) {
      window.clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log("[RankedWS] Max reconnect attempts reached");
      return;
    }

    if (this.reconnectTimeout !== null) {
      return; // Already scheduled
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    this.reconnectAttempts++;

    console.log(
      `[RankedWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`,
    );

    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.playerId) {
        this.connect(this.playerId, this.ticketId ?? undefined);
      }
    }, delay);
  }

  disconnect(): void {
    this.stopPing();
    if (this.reconnectTimeout !== null) {
      window.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.reconnectAttempts = 0;
  }
}
