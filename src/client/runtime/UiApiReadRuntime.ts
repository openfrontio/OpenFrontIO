import {
  ClanLeaderboardResponseSchema,
  type ClanLeaderboardResponse,
} from "../../core/ApiSchemas";
import { getServerConfigFromClient } from "../../core/configuration/ConfigLoader";
import {
  type AnalyticsRecord,
  type GameInfo,
  type GameRecord,
  GameRecordSchema,
} from "../../core/Schemas";
import { fetchGameById, getApiBase } from "../Api";
import {
  dispatchUiAction,
  initDioxusRuntime,
} from "../UiRuntimeBridge";
import {
  isLikelyApiUnavailableError,
  isLocalExternalApiBase,
  localApiUnavailableMessage,
} from "../ExternalApi";
import { subscribeUiRuntimeEvents } from "./UiRuntimeEventRouter";
import {
  parseUiRuntimeErrorMessage,
  parseUiRuntimePayload,
  parseUiRuntimeReason,
  parseUiRuntimeRequestId,
  parseUiRuntimeString,
} from "./UiRuntimeParsing";
import { UI_RUNTIME_ACTIONS, UI_RUNTIME_EVENTS } from "./UiRuntimeProtocol";

const ACTION_STATS_REQUEST = UI_RUNTIME_ACTIONS.uiReadStatsRequest;
const ACTION_STATS_RETRY = UI_RUNTIME_ACTIONS.uiReadStatsRetry;
const ACTION_STATS_ERROR = UI_RUNTIME_ACTIONS.uiReadStatsError;

const ACTION_GAME_INFO_REQUEST = UI_RUNTIME_ACTIONS.uiReadGameInfoRequest;
const ACTION_GAME_INFO_RETRY = UI_RUNTIME_ACTIONS.uiReadGameInfoRetry;
const ACTION_GAME_INFO_ERROR = UI_RUNTIME_ACTIONS.uiReadGameInfoError;

const ACTION_LOBBY_EXISTS_REQUEST = UI_RUNTIME_ACTIONS.uiReadLobbyExistsRequest;
const ACTION_LOBBY_EXISTS_RETRY = UI_RUNTIME_ACTIONS.uiReadLobbyExistsRetry;
const ACTION_LOBBY_EXISTS_ERROR = UI_RUNTIME_ACTIONS.uiReadLobbyExistsError;

const ACTION_LOBBY_ARCHIVE_REQUEST =
  UI_RUNTIME_ACTIONS.uiReadLobbyArchiveRequest;
const ACTION_LOBBY_ARCHIVE_RETRY = UI_RUNTIME_ACTIONS.uiReadLobbyArchiveRetry;
const ACTION_LOBBY_ARCHIVE_ERROR = UI_RUNTIME_ACTIONS.uiReadLobbyArchiveError;

const ACTION_LOBBY_STATE_REQUEST = UI_RUNTIME_ACTIONS.uiReadLobbyStateRequest;
const ACTION_LOBBY_STATE_RETRY = UI_RUNTIME_ACTIONS.uiReadLobbyStateRetry;
const ACTION_LOBBY_STATE_ERROR = UI_RUNTIME_ACTIONS.uiReadLobbyStateError;

const EVENT_STATS_LOADING = UI_RUNTIME_EVENTS.uiReadStatsLoading;
const EVENT_STATS_RETRY = UI_RUNTIME_EVENTS.uiReadStatsRetry;
const EVENT_STATS_ERROR = UI_RUNTIME_EVENTS.uiReadStatsError;

const EVENT_GAME_INFO_LOADING = UI_RUNTIME_EVENTS.uiReadGameInfoLoading;
const EVENT_GAME_INFO_RETRY = UI_RUNTIME_EVENTS.uiReadGameInfoRetry;
const EVENT_GAME_INFO_ERROR = UI_RUNTIME_EVENTS.uiReadGameInfoError;

const EVENT_LOBBY_EXISTS_LOADING = UI_RUNTIME_EVENTS.uiReadLobbyExistsLoading;
const EVENT_LOBBY_EXISTS_RETRY = UI_RUNTIME_EVENTS.uiReadLobbyExistsRetry;
const EVENT_LOBBY_EXISTS_ERROR = UI_RUNTIME_EVENTS.uiReadLobbyExistsError;

const EVENT_LOBBY_ARCHIVE_LOADING = UI_RUNTIME_EVENTS.uiReadLobbyArchiveLoading;
const EVENT_LOBBY_ARCHIVE_RETRY = UI_RUNTIME_EVENTS.uiReadLobbyArchiveRetry;
const EVENT_LOBBY_ARCHIVE_ERROR = UI_RUNTIME_EVENTS.uiReadLobbyArchiveError;

const EVENT_LOBBY_STATE_LOADING = UI_RUNTIME_EVENTS.uiReadLobbyStateLoading;
const EVENT_LOBBY_STATE_RETRY = UI_RUNTIME_EVENTS.uiReadLobbyStateRetry;
const EVENT_LOBBY_STATE_ERROR = UI_RUNTIME_EVENTS.uiReadLobbyStateError;

export const UI_API_RUNTIME_EVENTS = {
  statsLoading: "ui-api-runtime:stats-loading",
  statsRetry: "ui-api-runtime:stats-retry",
  statsError: "ui-api-runtime:stats-error",
  statsSuccess: "ui-api-runtime:stats-success",
  gameInfoLoading: "ui-api-runtime:game-info-loading",
  gameInfoRetry: "ui-api-runtime:game-info-retry",
  gameInfoError: "ui-api-runtime:game-info-error",
  gameInfoSuccess: "ui-api-runtime:game-info-success",
  lobbyExistsLoading: "ui-api-runtime:lobby-exists-loading",
  lobbyExistsRetry: "ui-api-runtime:lobby-exists-retry",
  lobbyExistsError: "ui-api-runtime:lobby-exists-error",
  lobbyExistsSuccess: "ui-api-runtime:lobby-exists-success",
  lobbyArchiveLoading: "ui-api-runtime:lobby-archive-loading",
  lobbyArchiveRetry: "ui-api-runtime:lobby-archive-retry",
  lobbyArchiveError: "ui-api-runtime:lobby-archive-error",
  lobbyArchiveSuccess: "ui-api-runtime:lobby-archive-success",
  lobbyStateLoading: "ui-api-runtime:lobby-state-loading",
  lobbyStateRetry: "ui-api-runtime:lobby-state-retry",
  lobbyStateError: "ui-api-runtime:lobby-state-error",
  lobbyStateSuccess: "ui-api-runtime:lobby-state-success",
} as const;

export type UiApiReadReason = "open" | "retry";

export interface UiApiReadLoadingDetail {
  requestId: number;
  reason: UiApiReadReason;
  gameId?: string;
  lobbyId?: string;
  atMs?: number;
}

export interface UiApiReadErrorDetail extends UiApiReadLoadingDetail {
  message: string;
}

export interface UiApiStatsSuccessDetail {
  requestId: number;
  reason: UiApiReadReason;
  data: ClanLeaderboardResponse;
}

export interface UiApiGameInfoSuccessDetail {
  requestId: number;
  reason: UiApiReadReason;
  gameId: string;
  session: AnalyticsRecord;
}

export interface UiApiLobbyExistsSuccessDetail {
  requestId: number;
  reason: UiApiReadReason;
  lobbyId: string;
  exists: boolean;
  status: number;
}

export interface UiApiLobbyArchiveSuccessDetail {
  requestId: number;
  reason: UiApiReadReason;
  lobbyId: string;
  status: number;
  record: GameRecord | null;
}

export interface UiApiLobbyStateSuccessDetail {
  requestId: number;
  reason: UiApiReadReason;
  lobbyId: string;
  gameInfo: GameInfo;
}

type LobbyExistsPending = {
  resolve: (detail: UiApiLobbyExistsSuccessDetail) => void;
  reject: (error: Error) => void;
};

type LobbyArchivePending = {
  resolve: (detail: UiApiLobbyArchiveSuccessDetail) => void;
  reject: (error: Error) => void;
};

type LobbyStatePending = {
  resolve: (detail: UiApiLobbyStateSuccessDetail) => void;
  reject: (error: Error) => void;
};

let hasStarted = false;
let startPromise: Promise<void> | null = null;
let runtimeUnsubscribe: (() => void) | null = null;

let statsRequestCounter = 0;
let gameInfoRequestCounter = 0;
let lobbyExistsRequestCounter = 0;
let lobbyArchiveRequestCounter = 0;
let lobbyStateRequestCounter = 0;

const pendingLobbyExists = new Map<number, LobbyExistsPending>();
const pendingLobbyArchive = new Map<number, LobbyArchivePending>();
const pendingLobbyState = new Map<number, LobbyStatePending>();

function emitHostEvent<T>(eventType: string, detail: T): void {
  window.dispatchEvent(
    new CustomEvent(eventType, {
      detail,
      bubbles: false,
      composed: false,
    }),
  );
}

function parseReadReason(value: unknown): UiApiReadReason {
  return parseUiRuntimeReason(value);
}

function formatErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function resolveLobbyExists(
  requestId: number,
  detail: UiApiLobbyExistsSuccessDetail,
): void {
  const pending = pendingLobbyExists.get(requestId);
  if (!pending) {
    return;
  }
  pendingLobbyExists.delete(requestId);
  pending.resolve(detail);
}

function rejectLobbyExists(requestId: number, error: Error): void {
  const pending = pendingLobbyExists.get(requestId);
  if (!pending) {
    return;
  }
  pendingLobbyExists.delete(requestId);
  pending.reject(error);
}

function resolveLobbyArchive(
  requestId: number,
  detail: UiApiLobbyArchiveSuccessDetail,
): void {
  const pending = pendingLobbyArchive.get(requestId);
  if (!pending) {
    return;
  }
  pendingLobbyArchive.delete(requestId);
  pending.resolve(detail);
}

function rejectLobbyArchive(requestId: number, error: Error): void {
  const pending = pendingLobbyArchive.get(requestId);
  if (!pending) {
    return;
  }
  pendingLobbyArchive.delete(requestId);
  pending.reject(error);
}

function resolveLobbyState(
  requestId: number,
  detail: UiApiLobbyStateSuccessDetail,
): void {
  const pending = pendingLobbyState.get(requestId);
  if (!pending) {
    return;
  }
  pendingLobbyState.delete(requestId);
  pending.resolve(detail);
}

function rejectLobbyState(requestId: number, error: Error): void {
  const pending = pendingLobbyState.get(requestId);
  if (!pending) {
    return;
  }
  pendingLobbyState.delete(requestId);
  pending.reject(error);
}

async function fetchStatsForRequest(
  requestId: number,
  reason: UiApiReadReason,
): Promise<void> {
  try {
    const response = await fetch(`${getApiBase()}/public/clans/leaderboard`, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Unexpected status ${response.status}`);
    }

    const json = await response.json();
    const parsed = ClanLeaderboardResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error("Invalid response format");
    }

    if (requestId !== statsRequestCounter) {
      return;
    }

    emitHostEvent<UiApiStatsSuccessDetail>(UI_API_RUNTIME_EVENTS.statsSuccess, {
      requestId,
      reason,
      data: parsed.data,
    });
  } catch (error) {
    if (requestId !== statsRequestCounter) {
      return;
    }

    const apiBase = getApiBase();
    const message =
      isLocalExternalApiBase(apiBase) && isLikelyApiUnavailableError(error)
        ? localApiUnavailableMessage("Stats")
        : formatErrorMessage(error, "Failed to load leaderboard");
    const dispatched = dispatchUiAction({
      type: ACTION_STATS_ERROR,
      payload: {
        requestId,
        reason,
        message,
      },
    });

    if (!dispatched) {
      emitHostEvent<UiApiReadErrorDetail>(UI_API_RUNTIME_EVENTS.statsError, {
        requestId,
        reason,
        message,
      });
    }
  }
}

async function fetchGameInfoForRequest(
  requestId: number,
  reason: UiApiReadReason,
  gameId: string,
): Promise<void> {
  try {
    const session = await fetchGameById(gameId);
    if (!session) {
      if (isLocalExternalApiBase(getApiBase())) {
        throw new Error(localApiUnavailableMessage("Game info"));
      }
      throw new Error("Game info unavailable");
    }

    if (requestId !== gameInfoRequestCounter) {
      return;
    }

    emitHostEvent<UiApiGameInfoSuccessDetail>(
      UI_API_RUNTIME_EVENTS.gameInfoSuccess,
      {
        requestId,
        reason,
        gameId,
        session,
      },
    );
  } catch (error) {
    if (requestId !== gameInfoRequestCounter) {
      return;
    }

    const apiBase = getApiBase();
    const message =
      isLocalExternalApiBase(apiBase) && isLikelyApiUnavailableError(error)
        ? localApiUnavailableMessage("Game info")
        : formatErrorMessage(error, "Failed to load game info");
    const dispatched = dispatchUiAction({
      type: ACTION_GAME_INFO_ERROR,
      payload: {
        requestId,
        reason,
        gameId,
        message,
      },
    });

    if (!dispatched) {
      emitHostEvent<UiApiReadErrorDetail>(UI_API_RUNTIME_EVENTS.gameInfoError, {
        requestId,
        reason,
        gameId,
        message,
      });
    }
  }
}

async function fetchLobbyExistsForRequest(
  requestId: number,
  reason: UiApiReadReason,
  lobbyId: string,
): Promise<void> {
  try {
    const config = await getServerConfigFromClient();
    const response = await fetch(
      `/${config.workerPath(lobbyId)}/api/game/${lobbyId}/exists`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      },
    );

    let exists = false;
    try {
      const body = (await response.json()) as Record<string, unknown>;
      exists = body.exists === true;
    } catch {
      exists = false;
    }

    const detail: UiApiLobbyExistsSuccessDetail = {
      requestId,
      reason,
      lobbyId,
      exists,
      status: response.status,
    };

    emitHostEvent<UiApiLobbyExistsSuccessDetail>(
      UI_API_RUNTIME_EVENTS.lobbyExistsSuccess,
      detail,
    );
    resolveLobbyExists(requestId, detail);
  } catch (error) {
    const message = formatErrorMessage(error, "Failed to check lobby status");
    const dispatched = dispatchUiAction({
      type: ACTION_LOBBY_EXISTS_ERROR,
      payload: {
        requestId,
        reason,
        lobbyId,
        message,
      },
    });

    if (!dispatched) {
      emitHostEvent<UiApiReadErrorDetail>(
        UI_API_RUNTIME_EVENTS.lobbyExistsError,
        {
          requestId,
          reason,
          lobbyId,
          message,
        },
      );
    }

    rejectLobbyExists(requestId, new Error(message));
  }
}

async function fetchLobbyArchiveForRequest(
  requestId: number,
  reason: UiApiReadReason,
  lobbyId: string,
): Promise<void> {
  const apiBase = getApiBase();

  try {
    const response = await fetch(`${apiBase}/game/${encodeURIComponent(lobbyId)}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (response.status === 404) {
      const detail: UiApiLobbyArchiveSuccessDetail = {
        requestId,
        reason,
        lobbyId,
        status: 404,
        record: null,
      };
      emitHostEvent<UiApiLobbyArchiveSuccessDetail>(
        UI_API_RUNTIME_EVENTS.lobbyArchiveSuccess,
        detail,
      );
      resolveLobbyArchive(requestId, detail);
      return;
    }

    if (response.status !== 200) {
      const detail: UiApiLobbyArchiveSuccessDetail = {
        requestId,
        reason,
        lobbyId,
        status: response.status,
        record: null,
      };
      emitHostEvent<UiApiLobbyArchiveSuccessDetail>(
        UI_API_RUNTIME_EVENTS.lobbyArchiveSuccess,
        detail,
      );
      resolveLobbyArchive(requestId, detail);
      return;
    }

    const json = await response.json();
    const parsed = GameRecordSchema.safeParse(json);
    const detail: UiApiLobbyArchiveSuccessDetail = {
      requestId,
      reason,
      lobbyId,
      status: response.status,
      record: parsed.success ? parsed.data : null,
    };

    emitHostEvent<UiApiLobbyArchiveSuccessDetail>(
      UI_API_RUNTIME_EVENTS.lobbyArchiveSuccess,
      detail,
    );
    resolveLobbyArchive(requestId, detail);
  } catch (error) {
    const message =
      isLocalExternalApiBase(apiBase) && isLikelyApiUnavailableError(error)
        ? localApiUnavailableMessage("Game info")
        : formatErrorMessage(error, "Failed to load archived lobby");
    const dispatched = dispatchUiAction({
      type: ACTION_LOBBY_ARCHIVE_ERROR,
      payload: {
        requestId,
        reason,
        lobbyId,
        message,
      },
    });

    if (!dispatched) {
      emitHostEvent<UiApiReadErrorDetail>(
        UI_API_RUNTIME_EVENTS.lobbyArchiveError,
        {
          requestId,
          reason,
          lobbyId,
          message,
        },
      );
    }

    rejectLobbyArchive(requestId, new Error(message));
  }
}

async function fetchLobbyStateForRequest(
  requestId: number,
  reason: UiApiReadReason,
  lobbyId: string,
): Promise<void> {
  try {
    const config = await getServerConfigFromClient();
    const response = await fetch(
      `/${config.workerPath(lobbyId)}/api/game/${lobbyId}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      },
    );

    if (!response.ok) {
      throw new Error(`Unexpected status ${response.status}`);
    }

    const gameInfo = (await response.json()) as GameInfo;
    const detail: UiApiLobbyStateSuccessDetail = {
      requestId,
      reason,
      lobbyId,
      gameInfo,
    };

    emitHostEvent<UiApiLobbyStateSuccessDetail>(
      UI_API_RUNTIME_EVENTS.lobbyStateSuccess,
      detail,
    );
    resolveLobbyState(requestId, detail);
  } catch (error) {
    const message = formatErrorMessage(error, "Failed to load lobby state");
    const dispatched = dispatchUiAction({
      type: ACTION_LOBBY_STATE_ERROR,
      payload: {
        requestId,
        reason,
        lobbyId,
        message,
      },
    });

    if (!dispatched) {
      emitHostEvent<UiApiReadErrorDetail>(
        UI_API_RUNTIME_EVENTS.lobbyStateError,
        {
          requestId,
          reason,
          lobbyId,
          message,
        },
      );
    }

    rejectLobbyState(requestId, new Error(message));
  }
}

async function handleRuntimeEvent(
  eventType: string,
  payload: unknown,
  atMs?: number,
) {
  const parsedPayload = parseUiRuntimePayload(payload);

  if (eventType === EVENT_STATS_LOADING) {
    const requestId = parseUiRuntimeRequestId(
      parsedPayload.requestId,
      statsRequestCounter,
    );
    const reason = parseReadReason(parsedPayload.reason);
    emitHostEvent<UiApiReadLoadingDetail>(UI_API_RUNTIME_EVENTS.statsLoading, {
      requestId,
      reason,
      atMs,
    });
    await fetchStatsForRequest(requestId, reason);
    return;
  }

  if (eventType === EVENT_STATS_RETRY) {
    emitHostEvent<UiApiReadLoadingDetail>(UI_API_RUNTIME_EVENTS.statsRetry, {
      requestId: parseUiRuntimeRequestId(
        parsedPayload.requestId,
        statsRequestCounter,
      ),
      reason: parseReadReason(parsedPayload.reason),
      atMs,
    });
    return;
  }

  if (eventType === EVENT_STATS_ERROR) {
    emitHostEvent<UiApiReadErrorDetail>(UI_API_RUNTIME_EVENTS.statsError, {
      requestId: parseUiRuntimeRequestId(
        parsedPayload.requestId,
        statsRequestCounter,
      ),
      reason: parseReadReason(parsedPayload.reason),
      message: parseUiRuntimeErrorMessage(parsedPayload),
      atMs,
    });
    return;
  }

  if (eventType === EVENT_GAME_INFO_LOADING) {
    const requestId = parseUiRuntimeRequestId(
      parsedPayload.requestId,
      gameInfoRequestCounter,
    );
    const reason = parseReadReason(parsedPayload.reason);
    const gameId = parseUiRuntimeString(parsedPayload.gameId);

    emitHostEvent<UiApiReadLoadingDetail>(
      UI_API_RUNTIME_EVENTS.gameInfoLoading,
      {
        requestId,
        reason,
        gameId,
        atMs,
      },
    );

    if (!gameId) {
      const dispatched = dispatchUiAction({
        type: ACTION_GAME_INFO_ERROR,
        payload: {
          requestId,
          reason,
          gameId,
          message: "Missing gameId",
        },
      });

      if (!dispatched) {
        emitHostEvent<UiApiReadErrorDetail>(
          UI_API_RUNTIME_EVENTS.gameInfoError,
          {
            requestId,
            reason,
            gameId,
            message: "Missing gameId",
            atMs,
          },
        );
      }
      return;
    }

    await fetchGameInfoForRequest(requestId, reason, gameId);
    return;
  }

  if (eventType === EVENT_GAME_INFO_RETRY) {
    emitHostEvent<UiApiReadLoadingDetail>(UI_API_RUNTIME_EVENTS.gameInfoRetry, {
      requestId: parseUiRuntimeRequestId(
        parsedPayload.requestId,
        gameInfoRequestCounter,
      ),
      reason: parseReadReason(parsedPayload.reason),
      gameId: parseUiRuntimeString(parsedPayload.gameId),
      atMs,
    });
    return;
  }

  if (eventType === EVENT_GAME_INFO_ERROR) {
    emitHostEvent<UiApiReadErrorDetail>(UI_API_RUNTIME_EVENTS.gameInfoError, {
      requestId: parseUiRuntimeRequestId(
        parsedPayload.requestId,
        gameInfoRequestCounter,
      ),
      reason: parseReadReason(parsedPayload.reason),
      gameId: parseUiRuntimeString(parsedPayload.gameId),
      message: parseUiRuntimeErrorMessage(parsedPayload),
      atMs,
    });
    return;
  }

  if (eventType === EVENT_LOBBY_EXISTS_LOADING) {
    const requestId = parseUiRuntimeRequestId(
      parsedPayload.requestId,
      lobbyExistsRequestCounter,
    );
    const reason = parseReadReason(parsedPayload.reason);
    const lobbyId = parseUiRuntimeString(parsedPayload.lobbyId);

    emitHostEvent<UiApiReadLoadingDetail>(
      UI_API_RUNTIME_EVENTS.lobbyExistsLoading,
      {
        requestId,
        reason,
        lobbyId,
        atMs,
      },
    );

    if (!lobbyId) {
      const message = "Missing lobbyId";
      const dispatched = dispatchUiAction({
        type: ACTION_LOBBY_EXISTS_ERROR,
        payload: {
          requestId,
          reason,
          lobbyId,
          message,
        },
      });

      if (!dispatched) {
        emitHostEvent<UiApiReadErrorDetail>(
          UI_API_RUNTIME_EVENTS.lobbyExistsError,
          {
            requestId,
            reason,
            lobbyId,
            message,
            atMs,
          },
        );
      }

      rejectLobbyExists(requestId, new Error(message));
      return;
    }

    await fetchLobbyExistsForRequest(requestId, reason, lobbyId);
    return;
  }

  if (eventType === EVENT_LOBBY_EXISTS_RETRY) {
    emitHostEvent<UiApiReadLoadingDetail>(
      UI_API_RUNTIME_EVENTS.lobbyExistsRetry,
      {
        requestId: parseUiRuntimeRequestId(
          parsedPayload.requestId,
          lobbyExistsRequestCounter,
        ),
        reason: parseReadReason(parsedPayload.reason),
        lobbyId: parseUiRuntimeString(parsedPayload.lobbyId),
        atMs,
      },
    );
    return;
  }

  if (eventType === EVENT_LOBBY_EXISTS_ERROR) {
    const requestId = parseUiRuntimeRequestId(
      parsedPayload.requestId,
      lobbyExistsRequestCounter,
    );
    const detail: UiApiReadErrorDetail = {
      requestId,
      reason: parseReadReason(parsedPayload.reason),
      lobbyId: parseUiRuntimeString(parsedPayload.lobbyId),
      message: parseUiRuntimeErrorMessage(parsedPayload),
      atMs,
    };

    emitHostEvent<UiApiReadErrorDetail>(
      UI_API_RUNTIME_EVENTS.lobbyExistsError,
      detail,
    );
    rejectLobbyExists(requestId, new Error(detail.message));
    return;
  }

  if (eventType === EVENT_LOBBY_ARCHIVE_LOADING) {
    const requestId = parseUiRuntimeRequestId(
      parsedPayload.requestId,
      lobbyArchiveRequestCounter,
    );
    const reason = parseReadReason(parsedPayload.reason);
    const lobbyId = parseUiRuntimeString(parsedPayload.lobbyId);

    emitHostEvent<UiApiReadLoadingDetail>(
      UI_API_RUNTIME_EVENTS.lobbyArchiveLoading,
      {
        requestId,
        reason,
        lobbyId,
        atMs,
      },
    );

    if (!lobbyId) {
      const message = "Missing lobbyId";
      const dispatched = dispatchUiAction({
        type: ACTION_LOBBY_ARCHIVE_ERROR,
        payload: {
          requestId,
          reason,
          lobbyId,
          message,
        },
      });

      if (!dispatched) {
        emitHostEvent<UiApiReadErrorDetail>(
          UI_API_RUNTIME_EVENTS.lobbyArchiveError,
          {
            requestId,
            reason,
            lobbyId,
            message,
            atMs,
          },
        );
      }

      rejectLobbyArchive(requestId, new Error(message));
      return;
    }

    await fetchLobbyArchiveForRequest(requestId, reason, lobbyId);
    return;
  }

  if (eventType === EVENT_LOBBY_ARCHIVE_RETRY) {
    emitHostEvent<UiApiReadLoadingDetail>(
      UI_API_RUNTIME_EVENTS.lobbyArchiveRetry,
      {
        requestId: parseUiRuntimeRequestId(
          parsedPayload.requestId,
          lobbyArchiveRequestCounter,
        ),
        reason: parseReadReason(parsedPayload.reason),
        lobbyId: parseUiRuntimeString(parsedPayload.lobbyId),
        atMs,
      },
    );
    return;
  }

  if (eventType === EVENT_LOBBY_ARCHIVE_ERROR) {
    const requestId = parseUiRuntimeRequestId(
      parsedPayload.requestId,
      lobbyArchiveRequestCounter,
    );
    const detail: UiApiReadErrorDetail = {
      requestId,
      reason: parseReadReason(parsedPayload.reason),
      lobbyId: parseUiRuntimeString(parsedPayload.lobbyId),
      message: parseUiRuntimeErrorMessage(parsedPayload),
      atMs,
    };

    emitHostEvent<UiApiReadErrorDetail>(
      UI_API_RUNTIME_EVENTS.lobbyArchiveError,
      detail,
    );
    rejectLobbyArchive(requestId, new Error(detail.message));
    return;
  }

  if (eventType === EVENT_LOBBY_STATE_LOADING) {
    const requestId = parseUiRuntimeRequestId(
      parsedPayload.requestId,
      lobbyStateRequestCounter,
    );
    const reason = parseReadReason(parsedPayload.reason);
    const lobbyId = parseUiRuntimeString(parsedPayload.lobbyId);

    emitHostEvent<UiApiReadLoadingDetail>(
      UI_API_RUNTIME_EVENTS.lobbyStateLoading,
      {
        requestId,
        reason,
        lobbyId,
        atMs,
      },
    );

    if (!lobbyId) {
      const message = "Missing lobbyId";
      const dispatched = dispatchUiAction({
        type: ACTION_LOBBY_STATE_ERROR,
        payload: {
          requestId,
          reason,
          lobbyId,
          message,
        },
      });

      if (!dispatched) {
        emitHostEvent<UiApiReadErrorDetail>(
          UI_API_RUNTIME_EVENTS.lobbyStateError,
          {
            requestId,
            reason,
            lobbyId,
            message,
            atMs,
          },
        );
      }

      rejectLobbyState(requestId, new Error(message));
      return;
    }

    await fetchLobbyStateForRequest(requestId, reason, lobbyId);
    return;
  }

  if (eventType === EVENT_LOBBY_STATE_RETRY) {
    emitHostEvent<UiApiReadLoadingDetail>(
      UI_API_RUNTIME_EVENTS.lobbyStateRetry,
      {
        requestId: parseUiRuntimeRequestId(
          parsedPayload.requestId,
          lobbyStateRequestCounter,
        ),
        reason: parseReadReason(parsedPayload.reason),
        lobbyId: parseUiRuntimeString(parsedPayload.lobbyId),
        atMs,
      },
    );
    return;
  }

  if (eventType === EVENT_LOBBY_STATE_ERROR) {
    const requestId = parseUiRuntimeRequestId(
      parsedPayload.requestId,
      lobbyStateRequestCounter,
    );
    const detail: UiApiReadErrorDetail = {
      requestId,
      reason: parseReadReason(parsedPayload.reason),
      lobbyId: parseUiRuntimeString(parsedPayload.lobbyId),
      message: parseUiRuntimeErrorMessage(parsedPayload),
      atMs,
    };

    emitHostEvent<UiApiReadErrorDetail>(
      UI_API_RUNTIME_EVENTS.lobbyStateError,
      detail,
    );
    rejectLobbyState(requestId, new Error(detail.message));
  }
}

export async function ensureUiApiReadRuntimeStarted(): Promise<void> {
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
        EVENT_STATS_LOADING,
        EVENT_STATS_RETRY,
        EVENT_STATS_ERROR,
        EVENT_GAME_INFO_LOADING,
        EVENT_GAME_INFO_RETRY,
        EVENT_GAME_INFO_ERROR,
        EVENT_LOBBY_EXISTS_LOADING,
        EVENT_LOBBY_EXISTS_RETRY,
        EVENT_LOBBY_EXISTS_ERROR,
        EVENT_LOBBY_ARCHIVE_LOADING,
        EVENT_LOBBY_ARCHIVE_RETRY,
        EVENT_LOBBY_ARCHIVE_ERROR,
        EVENT_LOBBY_STATE_LOADING,
        EVENT_LOBBY_STATE_RETRY,
        EVENT_LOBBY_STATE_ERROR,
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

export async function requestStatsRead(
  reason: UiApiReadReason = "open",
): Promise<void> {
  await ensureUiApiReadRuntimeStarted();
  statsRequestCounter += 1;
  const requestId = statsRequestCounter;

  const actionType =
    reason === "retry" ? ACTION_STATS_RETRY : ACTION_STATS_REQUEST;
  const dispatched = dispatchUiAction({
    type: actionType,
    payload: {
      requestId,
      reason,
    },
  });

  if (!dispatched) {
    emitHostEvent<UiApiReadErrorDetail>(UI_API_RUNTIME_EVENTS.statsError, {
      requestId,
      reason,
      message: "UI runtime rejected stats read action",
    });
    return;
  }
}

export async function requestGameInfoRead(
  gameId: string,
  reason: UiApiReadReason = "open",
): Promise<void> {
  await ensureUiApiReadRuntimeStarted();
  gameInfoRequestCounter += 1;
  const requestId = gameInfoRequestCounter;

  const actionType =
    reason === "retry" ? ACTION_GAME_INFO_RETRY : ACTION_GAME_INFO_REQUEST;
  const dispatched = dispatchUiAction({
    type: actionType,
    payload: {
      requestId,
      reason,
      gameId,
    },
  });

  if (!dispatched) {
    emitHostEvent<UiApiReadErrorDetail>(UI_API_RUNTIME_EVENTS.gameInfoError, {
      requestId,
      reason,
      gameId,
      message: "UI runtime rejected game-info read action",
    });
    return;
  }
}

export async function requestLobbyExistsRead(
  lobbyId: string,
  reason: UiApiReadReason = "open",
): Promise<UiApiLobbyExistsSuccessDetail> {
  await ensureUiApiReadRuntimeStarted();
  lobbyExistsRequestCounter += 1;
  const requestId = lobbyExistsRequestCounter;

  const actionType =
    reason === "retry" ? ACTION_LOBBY_EXISTS_RETRY : ACTION_LOBBY_EXISTS_REQUEST;

  const result = new Promise<UiApiLobbyExistsSuccessDetail>((resolve, reject) => {
    pendingLobbyExists.set(requestId, { resolve, reject });
  });

  const dispatched = dispatchUiAction({
    type: actionType,
    payload: {
      requestId,
      reason,
      lobbyId,
    },
  });

  if (!dispatched) {
    const error = new Error("UI runtime rejected lobby-exists read action");
    emitHostEvent<UiApiReadErrorDetail>(UI_API_RUNTIME_EVENTS.lobbyExistsError, {
      requestId,
      reason,
      lobbyId,
      message: error.message,
    });
    rejectLobbyExists(requestId, error);
  }

  return result;
}

export async function requestLobbyArchiveRead(
  lobbyId: string,
  reason: UiApiReadReason = "open",
): Promise<UiApiLobbyArchiveSuccessDetail> {
  await ensureUiApiReadRuntimeStarted();
  lobbyArchiveRequestCounter += 1;
  const requestId = lobbyArchiveRequestCounter;

  const actionType =
    reason === "retry" ? ACTION_LOBBY_ARCHIVE_RETRY : ACTION_LOBBY_ARCHIVE_REQUEST;

  const result = new Promise<UiApiLobbyArchiveSuccessDetail>(
    (resolve, reject) => {
      pendingLobbyArchive.set(requestId, { resolve, reject });
    },
  );

  const dispatched = dispatchUiAction({
    type: actionType,
    payload: {
      requestId,
      reason,
      lobbyId,
    },
  });

  if (!dispatched) {
    const error = new Error("UI runtime rejected lobby-archive read action");
    emitHostEvent<UiApiReadErrorDetail>(
      UI_API_RUNTIME_EVENTS.lobbyArchiveError,
      {
        requestId,
        reason,
        lobbyId,
        message: error.message,
      },
    );
    rejectLobbyArchive(requestId, error);
  }

  return result;
}

export async function requestLobbyStateRead(
  lobbyId: string,
  reason: UiApiReadReason = "open",
): Promise<UiApiLobbyStateSuccessDetail> {
  await ensureUiApiReadRuntimeStarted();
  lobbyStateRequestCounter += 1;
  const requestId = lobbyStateRequestCounter;

  const actionType =
    reason === "retry" ? ACTION_LOBBY_STATE_RETRY : ACTION_LOBBY_STATE_REQUEST;

  const result = new Promise<UiApiLobbyStateSuccessDetail>((resolve, reject) => {
    pendingLobbyState.set(requestId, { resolve, reject });
  });

  const dispatched = dispatchUiAction({
    type: actionType,
    payload: {
      requestId,
      reason,
      lobbyId,
    },
  });

  if (!dispatched) {
    const error = new Error("UI runtime rejected lobby-state read action");
    emitHostEvent<UiApiReadErrorDetail>(UI_API_RUNTIME_EVENTS.lobbyStateError, {
      requestId,
      reason,
      lobbyId,
      message: error.message,
    });
    rejectLobbyState(requestId, error);
  }

  return result;
}
