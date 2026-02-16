import {
  AnalyticsPayload,
  BucketMode,
  BucketStat,
  LobbyRecord,
  TimelineBucket,
  bucketForConfig,
  joinRatePerMinute,
  peakFillRatio,
  safeMaxPlayers,
} from "../shared/types";

const clampLookback = (hours: number): number => {
  if (!Number.isFinite(hours)) return 24;
  return Math.max(1, Math.min(24 * 30, Math.floor(hours)));
};

export function buildAnalytics(
  allLobbies: LobbyRecord[],
  bucketMode: BucketMode,
  lookbackHoursRaw: number,
): AnalyticsPayload {
  const now = Date.now();
  const lookbackHours = clampLookback(lookbackHoursRaw);
  const since = now - lookbackHours * 60 * 60 * 1000;

  const lobbies = allLobbies
    .filter((lobby) => lobby.firstSeenAt >= since)
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt);

  const started = lobbies.filter((l) => l.status === "started");
  const completed = lobbies.filter((l) => l.status === "completed");
  const notStarted = lobbies.filter((l) => l.status === "did_not_start");
  const unknown = lobbies.filter((l) => l.status === "unknown");
  const active = lobbies.filter((l) => l.status === "active");

  const avgOpenSec =
    average(
      lobbies
        .map((lobby) => lobby.openDurationMs)
        .filter((value): value is number => value !== undefined),
    ) / 1000;
  const avgJoinRatePerMin = average(lobbies.map((lobby) => joinRatePerMinute(lobby)));
  const avgPeakFillPct = average(lobbies.map((lobby) => peakFillRatio(lobby))) * 100;
  const startedOrCompleted = [...started, ...completed];
  const underfilledStarted = startedOrCompleted.filter((lobby) => {
    if (lobby.playersAtStart === undefined || !lobby.maxPlayers) return false;
    return lobby.playersAtStart < lobby.maxPlayers;
  }).length;

  const bucketMap = new Map<string, LobbyRecord[]>();
  for (const lobby of lobbies) {
    const bucket = bucketForConfig(lobby.gameConfig, bucketMode);
    if (!bucketMap.has(bucket)) bucketMap.set(bucket, []);
    bucketMap.get(bucket)!.push(lobby);
  }
  const buckets: BucketStat[] = Array.from(bucketMap.entries())
    .map(([bucket, entries]) => {
      const startedCount = entries.filter((entry) => entry.status === "started").length;
      const completedCount = entries.filter(
        (entry) => entry.status === "completed",
      ).length;
      const notStartedCount = entries.filter(
        (entry) => entry.status === "did_not_start",
      ).length;
      const avgPlayersAtStart = average(
        entries
          .map((entry) => entry.playersAtStart)
          .filter((value): value is number => value !== undefined),
      );
      const avgFillAtClose = average(
        entries.map((entry) => entry.lastObservedClients / safeMaxPlayers(entry)),
      );
      const avgOpen = average(
        entries
          .map((entry) => entry.openDurationMs)
          .filter((value): value is number => value !== undefined),
      );
      return {
        bucket,
        count: entries.length,
        inProgress: startedCount,
        completed: completedCount,
        started: startedCount,
        notStarted: notStartedCount,
        avgOpenSec: avgOpen / 1000,
        avgJoinRatePerMin: average(entries.map((entry) => joinRatePerMinute(entry))),
        avgFillAtClose,
        avgPlayersAtStart,
      };
    })
    .sort((a, b) => b.count - a.count);

  const timeline = buildTimeline(lobbies);

  const order = lobbies
    .map((lobby) => ({
      gameID: lobby.gameID,
      bucket: bucketForConfig(lobby.gameConfig, bucketMode),
      openedAt: lobby.openedAt,
      closedAt: lobby.closedAt,
      startDetectedAt: lobby.startDetectedAt,
      actualStartAt: lobby.actualStartAt,
      actualEndAt: lobby.actualEndAt,
      archivePlayers: lobby.archivePlayers,
      archiveDurationSec: lobby.archiveDurationSec,
      archiveConnectedPlayers: lobby.archiveConnectedPlayers,
      archiveActivePlayers: lobby.archiveActivePlayers,
      scheduledStartAt: lobby.scheduledStartAt,
      peakClients: lobby.peakClients,
      maxPlayers: lobby.maxPlayers,
      status: lobby.status,
      openDurationMs: lobby.openDurationMs,
      joinRatePerMin: joinRatePerMinute(lobby),
    }))
    .sort((a, b) => a.openedAt - b.openedAt);

  const neverStarted = notStarted
    .slice()
    .sort((a, b) => (b.openDurationMs ?? 0) - (a.openDurationMs ?? 0))
    .slice(0, 20);
  const lowFillStarted = startedOrCompleted
    .filter((lobby) => {
      if (lobby.playersAtStart === undefined || !lobby.maxPlayers) return false;
      return lobby.playersAtStart / lobby.maxPlayers < 0.7;
    })
    .sort((a, b) => {
      const aFill = (a.playersAtStart ?? 0) / Math.max(1, a.maxPlayers ?? 1);
      const bFill = (b.playersAtStart ?? 0) / Math.max(1, b.maxPlayers ?? 1);
      return aFill - bFill;
    })
    .slice(0, 20);
  const highChurn = lobbies
    .filter((lobby) => lobby.observedLeaveEvents > 0)
    .sort((a, b) => {
      const aChurn = a.observedJoinEvents + a.observedLeaveEvents;
      const bChurn = b.observedJoinEvents + b.observedLeaveEvents;
      return bChurn - aChurn;
    })
    .slice(0, 20);

  return {
    now,
    summary: {
      total: lobbies.length,
      active: active.length,
      inProgress: started.length,
      completed: completed.length,
      started: started.length,
      notStarted: notStarted.length,
      unknown: unknown.length,
      underfilledStarted,
      avgOpenSec,
      avgJoinRatePerMin,
      avgPeakFillPct,
    },
    buckets,
    timeline,
    order,
    interesting: {
      neverStarted,
      lowFillStarted,
      highChurn,
    },
  };
}

function buildTimeline(lobbies: LobbyRecord[]): TimelineBucket[] {
  const byMinute = new Map<number, TimelineBucket>();

  const push = (when: number, key: "opened" | "closed" | "started"): void => {
    const minute = Math.floor(when / 60_000) * 60_000;
    const existing = byMinute.get(minute) ?? {
      minute,
      opened: 0,
      closed: 0,
      started: 0,
    };
    existing[key] += 1;
    byMinute.set(minute, existing);
  };

  for (const lobby of lobbies) {
    push(lobby.openedAt, "opened");
    if (lobby.closedAt) push(lobby.closedAt, "closed");
    if (lobby.status === "started" && lobby.startDetectedAt) {
      push(lobby.startDetectedAt, "started");
    }
  }

  return Array.from(byMinute.values()).sort((a, b) => a.minute - b.minute);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}
