import { generateID } from "../../core/Util";
import { getPlayToken } from "../Auth";
import { dispatchUiAction, initDioxusRuntime } from "../UiRuntimeBridge";
import {
  parseUiRuntimeErrorMessage,
  parseUiRuntimePayload,
  parseUiRuntimeReason,
  parseUiRuntimeRequestId,
  parseUiRuntimeString,
} from "./UiRuntimeParsing";
import { subscribeUiRuntimeEvents } from "./UiRuntimeEventRouter";
import { UI_RUNTIME_ACTIONS, UI_RUNTIME_EVENTS } from "./UiRuntimeProtocol";
import { requestLobbyExistsRead } from "./UiApiReadRuntime";

const ACTION_MATCHMAKING_REQUEST =
  UI_RUNTIME_ACTIONS.uiMatchmakingSearchRequest;
const ACTION_MATCHMAKING_RETRY = UI_RUNTIME_ACTIONS.uiMatchmakingSearchRetry;
const ACTION_MATCHMAKING_CANCEL = UI_RUNTIME_ACTIONS.uiMatchmakingSearchCancel;
const ACTION_MATCHMAKING_ERROR = UI_RUNTIME_ACTIONS.uiMatchmakingSearchError;

const EVENT_MATCHMAKING_LOADING = UI_RUNTIME_EVENTS.uiMatchmakingSearchLoading;
const EVENT_MATCHMAKING_RETRY = UI_RUNTIME_EVENTS.uiMatchmakingSearchRetry;
const EVENT_MATCHMAKING_CANCEL = UI_RUNTIME_EVENTS.uiMatchmakingSearchCancel;
const EVENT_MATCHMAKING_ERROR = UI_RUNTIME_EVENTS.uiMatchmakingSearchError;

type UiMatchmakingReason = "open" | "retry";

type UiMatchmakingPhase =
  | "idle"
  | "connecting"
  | "searching"
  | "waiting-for-game"
  | "closed"
  | "error";

export interface UiMatchmakingStateDetail {
  requestId: number;
  reason: UiMatchmakingReason;
  phase: UiMatchmakingPhase;
  connected: boolean;
  gameId: string | null;
  message?: string;
  atMs?: number;
}

export interface UiMatchmakingJoinLobbyDetail {
  requestId: number;
  gameID: string;
  clientID: string;
}

export interface UiMatchmakingErrorDetail {
  requestId: number;
  reason: UiMatchmakingReason;
  message: string;
  atMs?: number;
}

export const UI_MATCHMAKING_RUNTIME_EVENTS = {
  stateChanged: "ui-matchmaking-runtime:state-changed",
  joinLobby: "ui-matchmaking-runtime:join-lobby",
  error: "ui-matchmaking-runtime:error",
} as const;

let hasStarted = false;
let startPromise: Promise<void> | null = null;
let runtimeUnsubscribe: (() => void) | null = null;
let requestCounter = 0;
let activeRequestId: number | null = null;
let activeReason: UiMatchmakingReason = "open";
let activeSocket: WebSocket | null = null;
let lobbyCheckInterval: ReturnType<typeof setInterval> | null = null;

function emitHostEvent<T>(eventType: string, detail: T): void {
  window.dispatchEvent(
    new CustomEvent(eventType, {
      detail,
      bubbles: false,
      composed: false,
    }),
  );
}

function emitState(detail: UiMatchmakingStateDetail): void {
  emitHostEvent<UiMatchmakingStateDetail>(
    UI_MATCHMAKING_RUNTIME_EVENTS.stateChanged,
    detail,
  );
}

function emitError(detail: UiMatchmakingErrorDetail): void {
  emitHostEvent<UiMatchmakingErrorDetail>(
    UI_MATCHMAKING_RUNTIME_EVENTS.error,
    detail,
  );
}

function emitJoinLobby(detail: UiMatchmakingJoinLobbyDetail): void {
  emitHostEvent<UiMatchmakingJoinLobbyDetail>(
    UI_MATCHMAKING_RUNTIME_EVENTS.joinLobby,
    detail,
  );
}

function currentRequestId(fallback = requestCounter): number {
  return activeRequestId ?? fallback;
}

function matchmakingWebSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const instanceId = encodeURIComponent(window.INSTANCE_ID ?? "");
  return `${protocol}//${window.location.host}/matchmaking/join?instance_id=${instanceId}`;
}

function cleanupConnection(): void {
  activeSocket?.close();
  activeSocket = null;
  if (lobbyCheckInterval !== null) {
    clearInterval(lobbyCheckInterval);
    lobbyCheckInterval = null;
  }
}

function dispatchRuntimeError(
  requestId: number,
  reason: UiMatchmakingReason,
  message: string,
): void {
  const dispatched = dispatchUiAction({
    type: ACTION_MATCHMAKING_ERROR,
    payload: {
      requestId,
      reason,
      message,
    },
  });
  if (!dispatched) {
    emitError({
      requestId,
      reason,
      message,
    });
  }
}

async function pollLobbyUntilReady(
  requestId: number,
  reason: UiMatchmakingReason,
  gameId: string,
): Promise<void> {
  try {
    const detail = await requestLobbyExistsRead(gameId, reason);
    if (requestId !== activeRequestId) {
      return;
    }
    if (detail.status !== 200 || !detail.exists) {
      return;
    }

    cleanupConnection();
    emitJoinLobby({
      requestId,
      gameID: gameId,
      clientID: generateID(),
    });
    emitState({
      requestId,
      reason,
      phase: "closed",
      connected: false,
      gameId,
    });
  } catch (error) {
    if (requestId !== activeRequestId) {
      return;
    }
    dispatchRuntimeError(
      requestId,
      reason,
      error instanceof Error ? error.message : "Failed to check lobby status",
    );
  }
}

async function beginMatchmaking(requestId: number, reason: UiMatchmakingReason): Promise<void> {
  cleanupConnection();
  activeRequestId = requestId;
  activeReason = reason;

  emitState({
    requestId,
    reason,
    phase: "connecting",
    connected: false,
    gameId: null,
  });

  try {
    const socket = new WebSocket(matchmakingWebSocketUrl());
    activeSocket = socket;

    socket.onopen = async () => {
      if (requestId !== activeRequestId) {
        return;
      }
      emitState({
        requestId,
        reason,
        phase: "searching",
        connected: true,
        gameId: null,
      });
      socket.send(
        JSON.stringify({
          type: "join",
          jwt: await getPlayToken(),
        }),
      );
    };

    socket.onmessage = (event) => {
      if (requestId !== activeRequestId) {
        return;
      }
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        payload = {};
      }
      if (payload.type !== "match-assignment") {
        return;
      }
      const gameId = typeof payload.gameId === "string" ? payload.gameId : "";
      if (!gameId) {
        dispatchRuntimeError(requestId, reason, "Match assignment missing gameId");
        return;
      }
      socket.close();
      emitState({
        requestId,
        reason,
        phase: "waiting-for-game",
        connected: false,
        gameId,
      });

      if (lobbyCheckInterval !== null) {
        clearInterval(lobbyCheckInterval);
      }
      lobbyCheckInterval = setInterval(() => {
        void pollLobbyUntilReady(requestId, reason, gameId);
      }, 1000);
    };

    socket.onerror = () => {
      if (requestId !== activeRequestId) {
        return;
      }
      dispatchRuntimeError(requestId, reason, "WebSocket matchmaking connection failed");
    };

    socket.onclose = () => {
      if (requestId !== activeRequestId) {
        return;
      }
      if (lobbyCheckInterval !== null) {
        return;
      }
      emitState({
        requestId,
        reason,
        phase: "closed",
        connected: false,
        gameId: null,
      });
    };
  } catch (error) {
    dispatchRuntimeError(
      requestId,
      reason,
      error instanceof Error ? error.message : "Failed to start matchmaking",
    );
  }
}

function cancelMatchmaking(requestId: number, reason: UiMatchmakingReason, atMs?: number): void {
  if (activeRequestId !== null && requestId !== activeRequestId) {
    return;
  }
  cleanupConnection();
  activeRequestId = null;
  emitState({
    requestId,
    reason,
    phase: "closed",
    connected: false,
    gameId: null,
    atMs,
  });
}

async function handleRuntimeEvent(
  eventType: string,
  payload: unknown,
  atMs?: number,
): Promise<void> {
  const parsedPayload = parseUiRuntimePayload(payload);
  if (eventType === EVENT_MATCHMAKING_LOADING) {
    const requestId = parseUiRuntimeRequestId(
      parsedPayload.requestId,
      currentRequestId(),
    );
    const reason = parseUiRuntimeReason(parsedPayload.reason);
    await beginMatchmaking(requestId, reason);
    return;
  }

  if (eventType === EVENT_MATCHMAKING_RETRY) {
    const requestId = parseUiRuntimeRequestId(
      parsedPayload.requestId,
      currentRequestId(),
    );
    const reason = parseUiRuntimeReason(parsedPayload.reason);
    emitState({
      requestId,
      reason,
      phase: "searching",
      connected: true,
      gameId: null,
      atMs,
    });
    return;
  }

  if (eventType === EVENT_MATCHMAKING_CANCEL) {
    const requestId = parseUiRuntimeRequestId(
      parsedPayload.requestId,
      currentRequestId(),
    );
    cancelMatchmaking(requestId, activeReason, atMs);
    return;
  }

  if (eventType === EVENT_MATCHMAKING_ERROR) {
    const requestId = parseUiRuntimeRequestId(
      parsedPayload.requestId,
      currentRequestId(),
    );
    const reason = parseUiRuntimeReason(parsedPayload.reason);
    const message = parseUiRuntimeErrorMessage(
      parsedPayload,
      "Matchmaking request failed",
    );
    emitError({
      requestId,
      reason,
      message,
      atMs,
    });
    emitState({
      requestId,
      reason,
      phase: "error",
      connected: false,
      gameId: parseUiRuntimeString(parsedPayload.gameId) || null,
      message,
      atMs,
    });
  }
}

export async function ensureUiMatchmakingRuntimeStarted(): Promise<void> {
  if (hasStarted) {
    return;
  }
  if (startPromise) {
    return startPromise;
  }

  startPromise = (async () => {
    await initDioxusRuntime();

    runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
      [
        EVENT_MATCHMAKING_LOADING,
        EVENT_MATCHMAKING_RETRY,
        EVENT_MATCHMAKING_CANCEL,
        EVENT_MATCHMAKING_ERROR,
      ],
      async (event) => {
        await handleRuntimeEvent(event.type, event.payload, event.atMs);
      },
    );

    hasStarted = true;
  })();

  try {
    await startPromise;
  } finally {
    startPromise = null;
  }
}

export async function requestUiMatchmakingOpen(
  reason: UiMatchmakingReason = "open",
): Promise<number> {
  await ensureUiMatchmakingRuntimeStarted();
  requestCounter += 1;
  const requestId = requestCounter;
  activeRequestId = requestId;
  activeReason = reason;

  const dispatched = dispatchUiAction({
    type:
      reason === "retry"
        ? ACTION_MATCHMAKING_RETRY
        : ACTION_MATCHMAKING_REQUEST,
    payload: {
      requestId,
      reason,
    },
  });

  if (!dispatched) {
    emitError({
      requestId,
      reason,
      message: "UI runtime rejected matchmaking action",
    });
  }

  return requestId;
}

export async function requestUiMatchmakingCancel(reason = "component"): Promise<void> {
  await ensureUiMatchmakingRuntimeStarted();
  const requestId = currentRequestId(0);
  const dispatched = dispatchUiAction({
    type: ACTION_MATCHMAKING_CANCEL,
    payload: {
      requestId,
      reason,
    },
  });

  if (!dispatched) {
    cancelMatchmaking(requestId, activeReason);
  }
}
