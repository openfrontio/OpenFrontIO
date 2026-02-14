import type { GameInfo } from "../../core/Schemas";
import { getServerConfigFromClient } from "../../core/configuration/ConfigLoader";
import { generateID } from "../../core/Util";
import { getApiBase } from "../Api";
import { sendMagicLink } from "../Auth";
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

export type UiApiMutationReason = "open" | "retry";

const ACTION_HOST_CREATE_REQUEST = UI_RUNTIME_ACTIONS.uiMutateHostCreateRequest;
const ACTION_HOST_CREATE_RETRY = UI_RUNTIME_ACTIONS.uiMutateHostCreateRetry;
const ACTION_HOST_CREATE_ERROR = UI_RUNTIME_ACTIONS.uiMutateHostCreateError;

const ACTION_HOST_START_REQUEST = UI_RUNTIME_ACTIONS.uiMutateHostStartRequest;
const ACTION_HOST_START_RETRY = UI_RUNTIME_ACTIONS.uiMutateHostStartRetry;
const ACTION_HOST_START_ERROR = UI_RUNTIME_ACTIONS.uiMutateHostStartError;

const ACTION_MAGIC_LINK_REQUEST =
  UI_RUNTIME_ACTIONS.uiMutateAccountMagicLinkRequest;
const ACTION_MAGIC_LINK_RETRY = UI_RUNTIME_ACTIONS.uiMutateAccountMagicLinkRetry;
const ACTION_MAGIC_LINK_ERROR = UI_RUNTIME_ACTIONS.uiMutateAccountMagicLinkError;

const EVENT_HOST_CREATE_LOADING = UI_RUNTIME_EVENTS.uiMutateHostCreateLoading;
const EVENT_HOST_CREATE_ERROR = UI_RUNTIME_EVENTS.uiMutateHostCreateError;

const EVENT_HOST_START_LOADING = UI_RUNTIME_EVENTS.uiMutateHostStartLoading;
const EVENT_HOST_START_ERROR = UI_RUNTIME_EVENTS.uiMutateHostStartError;

const EVENT_MAGIC_LINK_LOADING =
  UI_RUNTIME_EVENTS.uiMutateAccountMagicLinkLoading;
const EVENT_MAGIC_LINK_ERROR = UI_RUNTIME_EVENTS.uiMutateAccountMagicLinkError;

type HostCreatePending = {
  resolve: (lobby: GameInfo) => void;
  reject: (error: Error) => void;
};

type HostStartPending = {
  resolve: (ok: boolean) => void;
  reject: (error: Error) => void;
};

type MagicLinkPending = {
  resolve: (ok: boolean) => void;
  reject: (error: Error) => void;
};

let hasStarted = false;
let startPromise: Promise<void> | null = null;
let runtimeUnsubscribe: (() => void) | null = null;

let hostCreateRequestCounter = 0;
let hostStartRequestCounter = 0;
let magicLinkRequestCounter = 0;

const pendingHostCreate = new Map<number, HostCreatePending>();
const pendingHostStart = new Map<number, HostStartPending>();
const pendingMagicLink = new Map<number, MagicLinkPending>();

function parseMutationReason(value: unknown): UiApiMutationReason {
  return parseUiRuntimeReason(value);
}

function resolveHostCreate(requestId: number, lobby: GameInfo): void {
  const pending = pendingHostCreate.get(requestId);
  if (!pending) return;
  pendingHostCreate.delete(requestId);
  pending.resolve(lobby);
}

function rejectHostCreate(requestId: number, error: Error): void {
  const pending = pendingHostCreate.get(requestId);
  if (!pending) return;
  pendingHostCreate.delete(requestId);
  pending.reject(error);
}

function resolveHostStart(requestId: number): void {
  const pending = pendingHostStart.get(requestId);
  if (!pending) return;
  pendingHostStart.delete(requestId);
  pending.resolve(true);
}

function rejectHostStart(requestId: number, error: Error): void {
  const pending = pendingHostStart.get(requestId);
  if (!pending) return;
  pendingHostStart.delete(requestId);
  pending.reject(error);
}

function resolveMagicLink(requestId: number): void {
  const pending = pendingMagicLink.get(requestId);
  if (!pending) return;
  pendingMagicLink.delete(requestId);
  pending.resolve(true);
}

function rejectMagicLink(requestId: number, error: Error): void {
  const pending = pendingMagicLink.get(requestId);
  if (!pending) return;
  pendingMagicLink.delete(requestId);
  pending.reject(error);
}

function reportMutationError(
  actionType: string,
  payload: Record<string, unknown>,
): void {
  dispatchUiAction({
    type: actionType,
    payload,
  });
}

async function performHostCreateRequest(
  requestId: number,
  reason: UiApiMutationReason,
  creatorClientID: string,
): Promise<void> {
  try {
    const config = await getServerConfigFromClient();
    const gameId = generateID();
    const response = await fetch(
      `/${config.workerPath(gameId)}/api/create_game/${gameId}?creatorClientID=${encodeURIComponent(creatorClientID)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const lobby = (await response.json()) as GameInfo;
    resolveHostCreate(requestId, lobby);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create lobby";
    reportMutationError(ACTION_HOST_CREATE_ERROR, {
      requestId,
      reason,
      creatorClientID,
      message,
    });
    rejectHostCreate(requestId, new Error(message));
  }
}

async function performHostStartRequest(
  requestId: number,
  reason: UiApiMutationReason,
  lobbyId: string,
): Promise<void> {
  try {
    const config = await getServerConfigFromClient();
    const response = await fetch(
      `${window.location.origin}/${config.workerPath(lobbyId)}/api/start_game/${lobbyId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    resolveHostStart(requestId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start game";
    reportMutationError(ACTION_HOST_START_ERROR, {
      requestId,
      reason,
      lobbyId,
      message,
    });
    rejectHostStart(requestId, new Error(message));
  }
}

async function performMagicLinkRequest(
  requestId: number,
  reason: UiApiMutationReason,
  email: string,
): Promise<void> {
  const apiBase = getApiBase();
  try {
    const success = await sendMagicLink(email);
    if (!success) {
      if (isLocalExternalApiBase(apiBase)) {
        throw new Error(localApiUnavailableMessage("Authentication"));
      }
      throw new Error("Failed to send recovery email");
    }

    resolveMagicLink(requestId);
  } catch (error) {
    const message =
      isLocalExternalApiBase(apiBase) && isLikelyApiUnavailableError(error)
        ? localApiUnavailableMessage("Authentication")
        : error instanceof Error
          ? error.message
          : "Failed to send recovery email";
    reportMutationError(ACTION_MAGIC_LINK_ERROR, {
      requestId,
      reason,
      email,
      message,
    });
    rejectMagicLink(requestId, new Error(message));
  }
}

async function handleRuntimeMutationEvent(
  eventType: string,
  payload: unknown,
): Promise<void> {
  const parsedPayload = parseUiRuntimePayload(payload);

  if (eventType === EVENT_HOST_CREATE_LOADING) {
    const requestId = parseUiRuntimeRequestId(
      parsedPayload.requestId,
      hostCreateRequestCounter,
    );
    const reason = parseMutationReason(parsedPayload.reason);
    const creatorClientID = parseUiRuntimeString(parsedPayload.creatorClientID);

    await performHostCreateRequest(requestId, reason, creatorClientID);
    return;
  }

  if (eventType === EVENT_HOST_CREATE_ERROR) {
    const requestId = parseUiRuntimeRequestId(
      parsedPayload.requestId,
      hostCreateRequestCounter,
    );
    const message = parseUiRuntimeErrorMessage(parsedPayload);
    rejectHostCreate(requestId, new Error(message));
    return;
  }

  if (eventType === EVENT_HOST_START_LOADING) {
    const requestId = parseUiRuntimeRequestId(
      parsedPayload.requestId,
      hostStartRequestCounter,
    );
    const reason = parseMutationReason(parsedPayload.reason);
    const lobbyId = parseUiRuntimeString(parsedPayload.lobbyId);

    await performHostStartRequest(requestId, reason, lobbyId);
    return;
  }

  if (eventType === EVENT_HOST_START_ERROR) {
    const requestId = parseUiRuntimeRequestId(
      parsedPayload.requestId,
      hostStartRequestCounter,
    );
    const message = parseUiRuntimeErrorMessage(parsedPayload);
    rejectHostStart(requestId, new Error(message));
    return;
  }

  if (eventType === EVENT_MAGIC_LINK_LOADING) {
    const requestId = parseUiRuntimeRequestId(
      parsedPayload.requestId,
      magicLinkRequestCounter,
    );
    const reason = parseMutationReason(parsedPayload.reason);
    const email = parseUiRuntimeString(parsedPayload.email);

    await performMagicLinkRequest(requestId, reason, email);
    return;
  }

  if (eventType === EVENT_MAGIC_LINK_ERROR) {
    const requestId = parseUiRuntimeRequestId(
      parsedPayload.requestId,
      magicLinkRequestCounter,
    );
    const message = parseUiRuntimeErrorMessage(parsedPayload);
    rejectMagicLink(requestId, new Error(message));
  }
}

export async function ensureUiApiMutationRuntimeStarted(): Promise<void> {
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
        EVENT_HOST_CREATE_LOADING,
        EVENT_HOST_CREATE_ERROR,
        EVENT_HOST_START_LOADING,
        EVENT_HOST_START_ERROR,
        EVENT_MAGIC_LINK_LOADING,
        EVENT_MAGIC_LINK_ERROR,
      ],
      async (event) => {
        await handleRuntimeMutationEvent(event.type, event.payload);
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

export async function requestHostLobbyCreate(
  creatorClientID: string,
  reason: UiApiMutationReason = "open",
): Promise<GameInfo> {
  await ensureUiApiMutationRuntimeStarted();
  hostCreateRequestCounter += 1;
  const requestId = hostCreateRequestCounter;

  const actionType =
    reason === "retry" ? ACTION_HOST_CREATE_RETRY : ACTION_HOST_CREATE_REQUEST;

  const result = new Promise<GameInfo>((resolve, reject) => {
    pendingHostCreate.set(requestId, { resolve, reject });
  });

  const dispatched = dispatchUiAction({
    type: actionType,
    payload: {
      requestId,
      reason,
      creatorClientID,
    },
  });

  if (!dispatched) {
    rejectHostCreate(
      requestId,
      new Error("UI runtime rejected host-lobby-create action"),
    );
  }

  return result;
}

export async function requestHostLobbyStart(
  lobbyId: string,
  reason: UiApiMutationReason = "open",
): Promise<boolean> {
  await ensureUiApiMutationRuntimeStarted();
  hostStartRequestCounter += 1;
  const requestId = hostStartRequestCounter;

  const actionType =
    reason === "retry" ? ACTION_HOST_START_RETRY : ACTION_HOST_START_REQUEST;

  const result = new Promise<boolean>((resolve, reject) => {
    pendingHostStart.set(requestId, { resolve, reject });
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
    rejectHostStart(
      requestId,
      new Error("UI runtime rejected host-lobby-start action"),
    );
  }

  return result;
}

export async function requestAccountMagicLink(
  email: string,
  reason: UiApiMutationReason = "open",
): Promise<boolean> {
  await ensureUiApiMutationRuntimeStarted();
  magicLinkRequestCounter += 1;
  const requestId = magicLinkRequestCounter;

  const actionType =
    reason === "retry" ? ACTION_MAGIC_LINK_RETRY : ACTION_MAGIC_LINK_REQUEST;

  const result = new Promise<boolean>((resolve, reject) => {
    pendingMagicLink.set(requestId, { resolve, reject });
  });

  const dispatched = dispatchUiAction({
    type: actionType,
    payload: {
      requestId,
      reason,
      email,
    },
  });

  if (!dispatched) {
    rejectMagicLink(
      requestId,
      new Error("UI runtime rejected account magic-link action"),
    );
  }

  return result;
}
