export function calculateServerTimeOffset(
  serverTimeMs: number,
  localNowMs: number = Date.now(),
): number {
  return serverTimeMs - localNowMs;
}

export function getServerNow(
  serverTimeOffsetMs: number,
  localNowMs: number = Date.now(),
): number {
  return localNowMs + serverTimeOffsetMs;
}

export function getSecondsUntilServerTimestamp(
  targetServerTimestampMs: number,
  serverTimeOffsetMs: number,
  localNowMs: number = Date.now(),
): number {
  return Math.max(
    0,
    Math.floor(
      (targetServerTimestampMs - getServerNow(serverTimeOffsetMs, localNowMs)) /
        1000,
    ),
  );
}
