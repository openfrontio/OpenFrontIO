// Browsers deliberately give a WebSocket "error" event no cause, and always
// follow it with a close. The close is the only place a failure can be
// described, so every socket logs this line there instead of at the error.
export function describeSocketClose(
  url: string,
  event: CloseEvent,
  openedAt: number | null,
): string {
  // No scheme or query string: matchmaking's query carries the instance id
  // and version. String surgery, not new URL(), so logging cannot throw.
  const target = url.replace(/^wss?:\/\//, "").split("?")[0];
  const code =
    event.code === 1006 ? "1006, no close frame" : String(event.code);
  const reason = event.reason ? ` "${event.reason}"` : "";
  const lifetime =
    openedAt === null
      ? "before it opened"
      : `after ${((Date.now() - openedAt) / 1000).toFixed(1)}s open`;
  const offline = navigator.onLine === false ? ", browser offline" : "";
  return `${target} closed (${code})${reason} ${lifetime}${offline}`;
}
