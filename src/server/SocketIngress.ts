import { Logger } from "winston";
import { z } from "zod";
import { ZbContext } from "../../zbin";
import { CloseCode, CloseReason } from "../core/CloseCodes";
import { ClientID, ClientMessage, ClientMessageSchema } from "../core/Schemas";
import { decodeClientMessageUnvalidated } from "../core/ZbinWire";
import { Client } from "./Client";
import { ClientMsgRateLimiter } from "./ClientMsgRateLimiter";
import { MatchTelemetryRecorder } from "./MatchTelemetryRecorder";

export const KICK_REASON_TOO_MUCH_DATA = "kick_reason.too_much_data";
export const KICK_REASON_INVALID_MESSAGE = "kick_reason.invalid_message";

// Messages that speak for a player in the simulation, so a spectator may not
// send them — including hash, which feeds desync agreement, and report, which
// is one player's word against another's. Ping and rejoin remain connection
// housekeeping.
const SPECTATOR_BLOCKED_MESSAGES = new Set([
  "intent",
  "winner",
  "live_stats",
  "hash",
  "report",
]);

// What the ingress needs from the game it feeds.
export interface SocketIngressView {
  // The wire dictionary, once the game has started (see GameServer.zbinCtx).
  zbinCtx: () => ZbContext | undefined;
  serverTick: () => number;
  // A message that passed decoding, validation, rate limiting and the
  // spectator block.
  onMessage: (client: Client, msg: ClientMessage) => void;
  onClose: (client: Client) => void;
  kick: (clientID: ClientID, reasonKey: string) => void;
}

// The socket side of a game: attaches the listeners to a client's socket and
// runs every incoming frame through decode -> validate -> rate-limit ->
// spectator-block before the game sees it. A frame that fails is dropped or
// gets its sender kicked here; what a valid message does is
// GameServer.handleClientMessage.
export class SocketIngress {
  constructor(
    private readonly log: Logger,
    private readonly telemetry: MatchTelemetryRecorder,
    private readonly view: SocketIngressView,
    private readonly rateLimiter: Pick<
      ClientMsgRateLimiter,
      "check"
    > = new ClientMsgRateLimiter(),
  ) {}

  attach(client: Client): void {
    client.ws.removeAllListeners("message");
    client.ws.on("message", async (message: Buffer) => {
      try {
        this.receive(client, message);
      } catch (error) {
        this.log.info(
          `error handling websocket request in game server: ${error}`,
          {
            clientID: client.clientID,
          },
        );
      }
    });
    client.ws.on("close", () => {
      this.log.info("client disconnected", {
        clientID: client.clientID,
        persistentID: client.persistentID,
      });
      this.view.onClose(client);
    });
    client.ws.on("error", (error: Error) => {
      if ((error as any).code === "WS_ERR_UNEXPECTED_RSV_1") {
        client.ws.close(CloseCode.ProtocolError, CloseReason.ProtocolError);
      }
    });

    // Check if WebSocket already closed before we added the listener (race
    // condition) — the 'close' event has already fired, so the handler above
    // will never run for this client.
    if (client.ws.readyState >= 2) {
      this.log.info("client WebSocket already closing/closed, removing", {
        clientID: client.clientID,
        readyState: client.ws.readyState,
      });
      this.view.onClose(client);
    }
  }

  // One frame off a client's socket. Public so the pipeline can be driven
  // without a socket.
  receive(client: Client, message: Buffer): void {
    // Decode and validate in two steps (instead of one parseBytes) so a
    // message that is structurally sound but fails validation — the
    // signature of a buggy or cheating client — can still be attributed
    // to its intent in telemetry, exactly like the JSON path did.
    let raw: ClientMessage;
    try {
      // A Buffer is a Uint8Array and zbin honours its byteOffset.
      raw = decodeClientMessageUnvalidated(message, this.view.zbinCtx());
    } catch (e) {
      // Corrupt bytes: no readable type, nothing to attribute.
      this.log.warn(`Failed to decode client message, kicking`, {
        clientID: client.clientID,
        error: String(e),
      });
      this.view.kick(client.clientID, KICK_REASON_INVALID_MESSAGE);
      return;
    }
    const parsed = ClientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      const reasonDetail = z.prettifyError(parsed.error);
      if (raw.type === "intent") {
        this.telemetry.intentObserved(
          client,
          raw.intent,
          typeof raw.intent?.type === "string" ? raw.intent.type : null,
          "rejected",
          this.view.serverTick(),
          KICK_REASON_INVALID_MESSAGE,
          reasonDetail,
        );
      }
      this.log.warn(`Failed to parse client message, kicking`, {
        clientID: client.clientID,
        error: reasonDetail,
      });
      this.view.kick(client.clientID, KICK_REASON_INVALID_MESSAGE);
      return;
    }
    const clientMsg = parsed.data;
    const bytes = message.length;
    const rateResult = this.rateLimiter.check(
      client.clientID,
      clientMsg.type,
      bytes,
    );
    if (rateResult === "kick") {
      if (clientMsg.type === "intent") {
        this.telemetry.intentObserved(
          client,
          { ...clientMsg.intent, clientID: client.clientID },
          clientMsg.intent.type,
          "rejected",
          this.view.serverTick(),
          KICK_REASON_TOO_MUCH_DATA,
        );
      }
      this.log.warn(`Client rate limit exceeded, kicking`, {
        clientID: client.clientID,
        type: clientMsg.type,
      });
      this.view.kick(client.clientID, KICK_REASON_TOO_MUCH_DATA);
      return;
    }
    if (rateResult === "limit") {
      if (clientMsg.type === "intent") {
        this.telemetry.intentObserved(
          client,
          { ...clientMsg.intent, clientID: client.clientID },
          clientMsg.intent.type,
          "rejected",
          this.view.serverTick(),
          "limit",
        );
      }
      this.log.warn(`Client message rate limit exceeded, dropping`, {
        clientID: client.clientID,
        type: clientMsg.type,
      });
      return;
    }
    // A spectator is not in the simulation, so none of what it sends can be
    // game state. Without this, claiming to spectate is a way past the lobby
    // cap and into the intent stream.
    if (client.spectator && SPECTATOR_BLOCKED_MESSAGES.has(clientMsg.type)) {
      this.log.warn(`dropping ${clientMsg.type} from spectator`, {
        clientID: client.clientID,
      });
      return;
    }
    this.view.onMessage(client, clientMsg);
  }
}
