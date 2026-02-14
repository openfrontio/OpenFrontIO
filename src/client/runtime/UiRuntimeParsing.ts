export type UiRuntimePayload = Record<string, unknown>;

export function parseUiRuntimePayload(payload: unknown): UiRuntimePayload {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return {};
  }
  return payload as UiRuntimePayload;
}

export function parseUiRuntimeReason(value: unknown): "open" | "retry" {
  return value === "retry" ? "retry" : "open";
}

export function parseUiRuntimeRequestId(
  value: unknown,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

export function parseUiRuntimeString(
  value: unknown,
  fallback = "",
): string {
  return typeof value === "string" ? value : fallback;
}

export function parseUiRuntimeErrorMessage(
  payload: UiRuntimePayload,
  fallback = "request-failed",
): string {
  const message = payload.message;
  if (typeof message === "string" && message.length > 0) {
    return message;
  }
  return fallback;
}
