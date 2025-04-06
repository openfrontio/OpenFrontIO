import { ClientID, GameID, LogSeverity } from "../core/Schemas";

export interface slogMsg {
  logKey: string;
  msg: string;
  data?: {
    stack?: unknown;
    clientID?: unknown;
    clientIP?: unknown;
    gameID?: unknown;
    isRejoin?: unknown;
  };
  severity?: LogSeverity;
  gameID?: GameID;
  clientID?: ClientID;
  persistentID?: string;
  stack?: string; // Added stack property
}

export function slog(msg: slogMsg): void {
  msg.severity = msg.severity ?? LogSeverity.Info;

  // Format stack trace if available
  if (msg.stack) {
    // Keep the stack trace in the log data
    if (!msg.data) {
      msg.data = { stack: msg.stack };
    } else if (typeof msg.data === "object") {
      msg.data.stack = msg.stack;
    }
  }

  if (process.env.GAME_ENV == "dev") {
    // Avoid blowing up the log during development.
    if (msg.logKey == "client_console_log") {
      return;
    }
    if (msg.severity != LogSeverity.Debug) {
      console.log(msg.msg);
      // Print stack trace in development for errors
      if (msg.severity === LogSeverity.Error && msg.stack) {
        console.error(msg.stack);
      }
    }
  } else {
    try {
      console.log(JSON.stringify(msg));
    } catch (error) {
      console.error("Failed to stringify log message:", error);
      // Fallback to basic logging
      console.log(`${msg.severity}: ${msg.msg}`);
      if (msg.severity === LogSeverity.Error && msg.stack) {
        console.error(msg.stack);
      }
    }
  }
}
