import {
  AnalyticsPayload,
  BucketMode,
  LobbyRecord,
  TimelineBucket,
} from "../shared/types";
import "./styles.css";

const DEFAULT_BUCKET_MODE: BucketMode = "game_mode_team";
const DEFAULT_LOOKBACK_HOURS = 24;

const app = document.getElementById("app");
if (!app) {
  throw new Error("Missing #app");
}

app.innerHTML = `
  <section class="topbar">
    <div>
      <h1 class="title">Lobby Statistics</h1>
      <p class="subtitle">Realtime ingest for /lobbies with lifecycle and conversion analytics</p>
    </div>
    <div class="controls">
      <label>Bucket
        <select id="bucketMode">
          <option value="game_mode">Game mode</option>
          <option value="game_mode_team" selected>Game mode + teams</option>
          <option value="map">Map</option>
          <option value="map_size">Map size + mode</option>
          <option value="modifiers">Modifiers</option>
        </select>
      </label>
      <label>Lookback (h)
        <input id="lookbackHours" type="number" min="1" max="720" value="${DEFAULT_LOOKBACK_HOURS}" />
      </label>
      <button id="refreshBtn">Refresh</button>
      <button id="autoBtn">Auto: on</button>
    </div>
  </section>
  <section id="health"></section>
  <section id="summary" class="grid kpi-grid"></section>
  <section class="layout">
    <article class="card">
      <h3>Bucket Performance</h3>
      <div id="bucketTable"></div>
    </article>
    <article class="card">
      <h3>Timeline (Open/Close/Start)</h3>
      <div id="timelineChart" class="chart"></div>
    </article>
    <article class="card wide">
      <h3>Lobby Order Analysis</h3>
      <div id="orderChart" class="chart"></div>
      <div id="orderTable"></div>
    </article>
    <article class="card">
      <h3>Games That Did Not Start</h3>
      <div id="neverStarted"></div>
    </article>
    <article class="card">
      <h3>Low Fill Starts</h3>
      <div id="lowFill"></div>
    </article>
  </section>
`;

const controls = {
  bucketMode: document.getElementById("bucketMode") as HTMLSelectElement,
  lookbackHours: document.getElementById("lookbackHours") as HTMLInputElement,
  refreshBtn: document.getElementById("refreshBtn") as HTMLButtonElement,
  autoBtn: document.getElementById("autoBtn") as HTMLButtonElement,
};

const containers = {
  health: document.getElementById("health") as HTMLDivElement,
  summary: document.getElementById("summary") as HTMLDivElement,
  bucketTable: document.getElementById("bucketTable") as HTMLDivElement,
  timelineChart: document.getElementById("timelineChart") as HTMLDivElement,
  orderChart: document.getElementById("orderChart") as HTMLDivElement,
  orderTable: document.getElementById("orderTable") as HTMLDivElement,
  neverStarted: document.getElementById("neverStarted") as HTMLDivElement,
  lowFill: document.getElementById("lowFill") as HTMLDivElement,
};

let autoRefresh = true;
let refreshTimer: number | null = null;

controls.refreshBtn.onclick = () => {
  void loadData();
};
controls.autoBtn.onclick = () => {
  autoRefresh = !autoRefresh;
  controls.autoBtn.textContent = `Auto: ${autoRefresh ? "on" : "off"}`;
  if (autoRefresh) scheduleRefresh();
  if (!autoRefresh && refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
};

controls.bucketMode.onchange = () => void loadData();
controls.lookbackHours.onchange = () => void loadData();

void loadData();

async function loadData(): Promise<void> {
  const bucketMode = controls.bucketMode.value as BucketMode;
  const lookbackHours = Number(controls.lookbackHours.value || DEFAULT_LOOKBACK_HOURS);
  const [health, analytics] = await Promise.all([
    fetchJson("/api/health"),
    fetchJson(
      `/api/analytics?bucketMode=${encodeURIComponent(bucketMode)}&lookbackHours=${encodeURIComponent(
        String(lookbackHours),
      )}`,
    ),
  ]);

  renderHealth(health);
  renderAnalytics(analytics as AnalyticsPayload);
  scheduleRefresh();
}

function scheduleRefresh(): void {
  if (!autoRefresh) return;
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    void loadData();
  }, 5000);
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Request failed ${res.status} for ${url}`);
  }
  return res.json();
}

function renderHealth(payload: any): void {
  const notes = Array.isArray(payload.systemNotes)
    ? payload.systemNotes
        .slice(-5)
        .map((note: string) => `<div class="mono">${escapeHtml(note)}</div>`)
        .join("")
    : "";
  containers.health.innerHTML = `
    <div class="card">
      <span class="pill">ingest: ${payload.status}</span>
      <span class="pill mono">messages ${payload.messagesReceived}</span>
      <span class="pill mono">reconnects ${payload.reconnectCount}</span>
      <span class="pill mono">tracked ${payload.lobbiesTracked}</span>
      <span class="pill mono">last update ${new Date(payload.lastUpdatedAt).toLocaleString()}</span>
      <span class="pill mono">target ${payload.target.targetWsUrl}</span>
      <div style="margin-top:10px;color:#9db1c5;font-size:12px;">${notes}</div>
    </div>
  `;
}

function renderAnalytics(payload: AnalyticsPayload): void {
  renderSummary(payload);
  renderBucketTable(payload);
  renderTimeline(payload.timeline);
  renderOrder(payload);
  renderInteresting("neverStarted", payload.interesting.neverStarted);
  renderInteresting("lowFill", payload.interesting.lowFillStarted);
}

function renderSummary(payload: AnalyticsPayload): void {
  const cards = [
    ["Lobbies", payload.summary.total],
    ["Active", payload.summary.active],
    ["In Progress", payload.summary.inProgress],
    ["Completed", payload.summary.completed],
    ["Did Not Start", payload.summary.notStarted],
    ["Underfilled Starts", payload.summary.underfilledStarted],
    ["Avg Open (sec)", payload.summary.avgOpenSec.toFixed(1)],
    ["Avg Join Rate / min", payload.summary.avgJoinRatePerMin.toFixed(2)],
    ["Avg Peak Fill %", payload.summary.avgPeakFillPct.toFixed(1)],
  ];
  containers.summary.innerHTML = cards
    .map(
      ([label, value]) => `
      <article class="card">
        <div class="kpi-label">${label}</div>
        <div class="kpi-value mono">${value}</div>
      </article>
    `,
    )
    .join("");
}

function renderBucketTable(payload: AnalyticsPayload): void {
  containers.bucketTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Bucket</th>
          <th>Count</th>
          <th>In Progress</th>
          <th>Completed</th>
          <th>Not Started</th>
          <th>Avg Open(s)</th>
          <th>Join/min</th>
          <th>Fill@Close</th>
        </tr>
      </thead>
      <tbody>
        ${payload.buckets
          .slice(0, 40)
          .map(
            (bucket) => `
            <tr>
              <td class="mono">${escapeHtml(bucket.bucket)}</td>
              <td>${bucket.count}</td>
              <td class="status-started">${bucket.inProgress}</td>
              <td class="status-completed">${bucket.completed}</td>
              <td class="status-did_not_start">${bucket.notStarted}</td>
              <td>${bucket.avgOpenSec.toFixed(1)}</td>
              <td>${bucket.avgJoinRatePerMin.toFixed(2)}</td>
              <td>${(bucket.avgFillAtClose * 100).toFixed(1)}%</td>
            </tr>
          `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderTimeline(timeline: TimelineBucket[]): void {
  if (timeline.length === 0) {
    containers.timelineChart.innerHTML = "<p>No data yet.</p>";
    return;
  }
  const width = 760;
  const height = 250;
  const pad = 26;
  const maxY = Math.max(
    1,
    ...timeline.map((row) => Math.max(row.opened, row.closed, row.started)),
  );
  const minX = timeline[0].minute;
  const maxX = timeline[timeline.length - 1].minute;
  const x = (v: number) =>
    pad + ((v - minX) / Math.max(1, maxX - minX)) * (width - pad * 2);
  const y = (v: number) => height - pad - (v / maxY) * (height - pad * 2);

  const poly = (key: "opened" | "closed" | "started", color: string) => {
    const points = timeline.map((row) => `${x(row.minute)},${y(row[key])}`).join(" ");
    return `<polyline fill="none" stroke="${color}" stroke-width="2" points="${points}" />`;
  };

  containers.timelineChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
      ${poly("opened", "#4fa3ff")}
      ${poly("closed", "#ffd166")}
      ${poly("started", "#9fff7a")}
      <text x="${pad}" y="${pad - 8}" fill="#9db1c5" font-size="11">opened</text>
      <text x="${pad + 70}" y="${pad - 8}" fill="#9db1c5" font-size="11">closed</text>
      <text x="${pad + 130}" y="${pad - 8}" fill="#9db1c5" font-size="11">started</text>
    </svg>
  `;
}

function renderOrder(payload: AnalyticsPayload): void {
  const rows = payload.order.slice(-40);
  if (rows.length === 0) {
    containers.orderChart.innerHTML = "<p>No data yet.</p>";
    containers.orderTable.innerHTML = "";
    return;
  }
  const width = 1220;
  const rowHeight = 18;
  const height = Math.max(220, rows.length * rowHeight + 30);

  const minAt = Math.min(...rows.map((row) => row.openedAt));
  const maxAt = Math.max(
    ...rows.map((row) => row.closedAt ?? row.startDetectedAt ?? row.openedAt),
  );
  const pad = 16;
  const x = (v: number) =>
    pad + ((v - minAt) / Math.max(1, maxAt - minAt)) * (width - pad * 2);

  const bars = rows
    .map((row, i) => {
      const y = 20 + i * rowHeight;
      const startX = x(row.openedAt);
      const endAt = row.closedAt ?? row.startDetectedAt ?? row.openedAt;
      const endX = Math.max(startX + 2, x(endAt));
      const color = colorForBucket(row.bucket, row.status);
      const statusStroke =
        row.status === "started"
          ? "#9fff7a"
          : row.status === "completed"
            ? "#7fd3ff"
          : row.status === "did_not_start"
            ? "#ff6b6b"
            : "#ffd166";
      const openDurationText = formatDurationMs(row.openDurationMs);
      const gameDurationText = formatGameDuration(row, payload.now);
      return `
        <rect x="${startX.toFixed(1)}" y="${y}" width="${(endX - startX).toFixed(1)}" height="10" fill="${color}" stroke="${statusStroke}" stroke-width="0.7" opacity="0.9">
          <title>${row.gameID} | ${row.bucket} | status ${row.status} | open ${openDurationText} | game ${gameDurationText}</title>
        </rect>
      `;
    })
    .join("");

  const legendBuckets = Array.from(new Set(rows.map((row) => row.bucket))).slice(0, 12);
  const legend = legendBuckets
    .map((bucket, index) => {
      const color = colorForBucket(bucket);
      const xPos = 14 + (index % 4) * 300;
      const yPos = 12 + Math.floor(index / 4) * 14;
      return `
        <rect x="${xPos}" y="${yPos}" width="10" height="10" fill="${color}" opacity="0.95"></rect>
        <text x="${xPos + 14}" y="${yPos + 9}" fill="#d3e2ef" font-size="10">${escapeHtml(
          bucket.length > 36 ? `${bucket.slice(0, 36)}...` : bucket,
        )}</text>
      `;
    })
    .join("");

  containers.orderChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
      ${legend}
      ${bars}
    </svg>
  `;

  containers.orderTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Game</th>
          <th>Bucket</th>
          <th>Status</th>
          <th>Lobby + Game</th>
          <th>Peak Fill</th>
          <th>Join/min</th>
          <th>Opened</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .slice()
          .reverse()
          .map(
            (row) => `
            <tr>
              <td class="mono">${row.gameID}</td>
              <td class="mono">
                <span style="display:inline-block;width:9px;height:9px;border-radius:999px;background:${colorForBucket(row.bucket, row.status)};margin-right:6px;vertical-align:middle;"></span>${escapeHtml(row.bucket)}
              </td>
              <td class="status-${row.status}">${row.status}</td>
              <td>${formatDurationMs(row.openDurationMs)} + ${formatGameDuration(row, payload.now)}</td>
              <td>${row.maxPlayers ? `${row.peakClients}/${row.maxPlayers}` : row.peakClients}</td>
              <td>${row.joinRatePerMin.toFixed(2)}</td>
              <td>${new Date(row.openedAt).toLocaleString()}</td>
            </tr>
          `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderInteresting(target: "neverStarted" | "lowFill", rows: LobbyRecord[]): void {
  const element =
    target === "neverStarted" ? containers.neverStarted : containers.lowFill;

  if (rows.length === 0) {
    element.innerHTML = "<p>No entries in selected window.</p>";
    return;
  }

  element.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Game</th>
          <th>Mode</th>
          <th>Map</th>
          <th>Peak</th>
          <th>Start Fill</th>
          <th>Open</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .slice(0, 12)
          .map(
            (row) => `
            <tr>
              <td class="mono">${row.gameID}</td>
              <td>${row.gameConfig?.gameMode ?? "-"}</td>
              <td>${row.gameConfig?.gameMap ?? "-"}</td>
              <td>${row.maxPlayers ? `${row.peakClients}/${row.maxPlayers}` : row.peakClients}</td>
              <td>${row.fillRatioAtStart !== undefined ? `${(row.fillRatioAtStart * 100).toFixed(1)}%` : "-"}</td>
              <td>${formatDurationMs(row.openDurationMs)}</td>
            </tr>
          `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function formatDurationMs(durationMs: number | undefined): string {
  if (durationMs === undefined) return "-";
  if (durationMs < 1000) return `${durationMs}ms`;
  const sec = Math.round(durationMs / 1000);
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

function formatDurationSec(durationSec: number | undefined): string {
  if (durationSec === undefined) return "-";
  return formatDurationMs(durationSec * 1000);
}

function formatGameDuration(
  row: {
    status: string;
    startDetectedAt?: number;
    actualStartAt?: number;
    actualEndAt?: number;
    archiveDurationSec?: number;
  },
  now: number,
): string {
  if (
    row.actualStartAt !== undefined &&
    row.actualEndAt !== undefined &&
    row.actualEndAt >= row.actualStartAt
  ) {
    return formatDurationMs(row.actualEndAt - row.actualStartAt);
  }

  if (row.archiveDurationSec !== undefined) {
    return formatDurationSec(row.archiveDurationSec);
  }

  if (row.status === "started") {
    const start = row.actualStartAt ?? row.startDetectedAt;
    if (start !== undefined && now >= start) {
      return `${formatDurationMs(now - start)} (running)`;
    }
  }

  if (
    row.status === "completed" &&
    row.startDetectedAt !== undefined &&
    row.actualEndAt !== undefined &&
    row.actualEndAt >= row.startDetectedAt
  ) {
    return formatDurationMs(row.actualEndAt - row.startDetectedAt);
  }

  return "-";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function colorForBucket(bucket: string, status?: string): string {
  const hue = hashString(bucket) % 360;
  if (status === "started") {
    // In-progress games keep bucket hue but are less saturated.
    return `hsl(${hue} 40% 58%)`;
  }
  return `hsl(${hue} 75% 58%)`;
}
