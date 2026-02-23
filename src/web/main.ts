import {
  AnalyticsPayload,
  BucketMode,
  LobbyRecord,
  TimelineBucket,
  peakFillClients,
} from "../shared/types";
import * as d3 from "d3";
import "./styles.css";

const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_ORDER_COUNT = 40;

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
      <label>Order Count
        <select id="orderCount">
          <option value="20">20</option>
          <option value="40" selected>40</option>
          <option value="80">80</option>
          <option value="120">120</option>
          <option value="200">200</option>
        </select>
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
    <article class="card">
      <h3>Join Rate Trend</h3>
      <div id="joinRateChart" class="chart"></div>
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
  orderCount: document.getElementById("orderCount") as HTMLSelectElement,
  refreshBtn: document.getElementById("refreshBtn") as HTMLButtonElement,
  autoBtn: document.getElementById("autoBtn") as HTMLButtonElement,
};

const containers = {
  health: document.getElementById("health") as HTMLDivElement,
  summary: document.getElementById("summary") as HTMLDivElement,
  bucketTable: document.getElementById("bucketTable") as HTMLDivElement,
  timelineChart: document.getElementById("timelineChart") as HTMLDivElement,
  joinRateChart: document.getElementById("joinRateChart") as HTMLDivElement,
  orderChart: document.getElementById("orderChart") as HTMLDivElement,
  orderTable: document.getElementById("orderTable") as HTMLDivElement,
  neverStarted: document.getElementById("neverStarted") as HTMLDivElement,
  lowFill: document.getElementById("lowFill") as HTMLDivElement,
};

let autoRefresh = true;
let refreshTimer: number | null = null;
let latestAnalytics: AnalyticsPayload | null = null;

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
controls.orderCount.onchange = () => {
  if (latestAnalytics) {
    renderOrder(latestAnalytics);
    return;
  }
  void loadData();
};

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
  latestAnalytics = analytics as AnalyticsPayload;
  renderAnalytics(latestAnalytics);
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
  renderJoinRate(payload);
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

  containers.timelineChart.innerHTML = "";
  const width = 760;
  const height = 250;
  const pad = 26;
  const maxY = Math.max(
    1,
    ...timeline.map((row) => Math.max(row.opened, row.closed, row.started)),
  );
  const minX = timeline[0].minute;
  const maxX = timeline[timeline.length - 1].minute;
  const x = d3
    .scaleLinear()
    .domain([minX, Math.max(minX + 1, maxX)])
    .range([pad, width - pad]);
  const y = d3.scaleLinear().domain([0, maxY]).range([height - pad, pad]);

  const svg = d3
    .select(containers.timelineChart)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", "100%")
    .attr("height", "100%");

  const lineFor = (key: "opened" | "closed" | "started") =>
    d3
      .line<TimelineBucket>()
      .x((row) => x(row.minute))
      .y((row) => y(row[key]));

  svg
    .append("path")
    .datum(timeline)
    .attr("fill", "none")
    .attr("stroke", "#4fa3ff")
    .attr("stroke-width", 2)
    .attr("d", lineFor("opened"));

  svg
    .append("path")
    .datum(timeline)
    .attr("fill", "none")
    .attr("stroke", "#ffd166")
    .attr("stroke-width", 2)
    .attr("d", lineFor("closed"));

  svg
    .append("path")
    .datum(timeline)
    .attr("fill", "none")
    .attr("stroke", "#9fff7a")
    .attr("stroke-width", 2)
    .attr("d", lineFor("started"));

  svg
    .append("text")
    .attr("x", pad)
    .attr("y", pad - 8)
    .attr("fill", "#9db1c5")
    .attr("font-size", 11)
    .text("opened");
  svg
    .append("text")
    .attr("x", pad + 70)
    .attr("y", pad - 8)
    .attr("fill", "#9db1c5")
    .attr("font-size", 11)
    .text("closed");
  svg
    .append("text")
    .attr("x", pad + 130)
    .attr("y", pad - 8)
    .attr("fill", "#9db1c5")
    .attr("font-size", 11)
    .text("started");
}

function renderJoinRate(payload: AnalyticsPayload): void {
  const rows = payload.order
    .map((row) => ({
      at: row.openedAt,
      joinRate: Math.max(0, row.joinRatePerMin),
      status: row.status,
      bucket: row.bucket,
      gameID: row.gameID,
    }))
    .filter((row) => Number.isFinite(row.joinRate))
    .sort((a, b) => a.at - b.at);

  if (rows.length === 0) {
    containers.joinRateChart.innerHTML = "<p>No data yet.</p>";
    return;
  }

  containers.joinRateChart.innerHTML = "";
  const width = 760;
  const height = 250;
  const pad = 30;
  const minX = rows[0].at;
  const maxX = rows[rows.length - 1].at;
  const maxY = niceJoinRateMax(Math.max(0.5, ...rows.map((row) => row.joinRate)));
  const x = d3
    .scaleLinear()
    .domain([minX, Math.max(minX + 1, maxX)])
    .range([pad, width - pad]);
  const y = d3
    .scaleLinear()
    .domain([0, Math.max(0.001, maxY)])
    .range([height - pad, pad]);

  const trendWindow = Math.max(3, Math.min(15, Math.floor(rows.length / 10)));
  const trend = rows.map((row, index) => {
    const start = Math.max(0, index - trendWindow + 1);
    const slice = rows.slice(start, index + 1);
    const avg = slice.reduce((acc, entry) => acc + entry.joinRate, 0) / slice.length;
    return { at: row.at, value: avg };
  });

  const line = d3
    .line<(typeof rows)[number]>()
    .x((row) => x(row.at))
    .y((row) => y(row.joinRate));
  const trendLine = d3
    .line<(typeof trend)[number]>()
    .x((point) => x(point.at))
    .y((point) => y(point.value));

  const svg = d3
    .select(containers.joinRateChart)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", "100%")
    .attr("height", "100%");

  const yTicks = 4;
  const grid = Array.from({ length: yTicks + 1 }, (_, i) => {
    const value = (maxY * i) / yTicks;
    const yPos = y(value);
    return { value, yPos };
  });

  svg
    .selectAll("line.grid")
    .data(grid)
    .enter()
    .append("line")
    .attr("class", "grid")
    .attr("x1", pad)
    .attr("y1", (d) => d.yPos)
    .attr("x2", width - pad)
    .attr("y2", (d) => d.yPos)
    .attr("stroke", "#264056")
    .attr("stroke-width", 0.7)
    .attr("stroke-dasharray", "3 4");

  svg
    .selectAll("text.grid-label")
    .data(grid)
    .enter()
    .append("text")
    .attr("class", "grid-label")
    .attr("x", 6)
    .attr("y", (d) => d.yPos + 4)
    .attr("fill", "#9db1c5")
    .attr("font-size", 10)
    .text((d) => d.value.toFixed(1));

  svg
    .append("line")
    .attr("x1", pad)
    .attr("y1", height - pad)
    .attr("x2", width - pad)
    .attr("y2", height - pad)
    .attr("stroke", "#3c5b78")
    .attr("stroke-width", 1);

  svg
    .append("path")
    .datum(rows)
    .attr("fill", "none")
    .attr("stroke", "#4fa3ff")
    .attr("stroke-width", 1.2)
    .attr("opacity", 0.55)
    .attr("d", line);

  svg
    .append("path")
    .datum(trend)
    .attr("fill", "none")
    .attr("stroke", "#9fff7a")
    .attr("stroke-width", 2)
    .attr("d", trendLine);

  const points = svg
    .selectAll("circle.join-rate-point")
    .data(rows)
    .enter()
    .append("circle")
    .attr("class", "join-rate-point")
    .attr("cx", (row) => x(row.at))
    .attr("cy", (row) => y(row.joinRate))
    .attr("r", 2.8)
    .attr("fill", (row) => colorForStatus(row.status))
    .attr("opacity", 0.9);

  points
    .append("title")
    .text(
      (row) =>
        `${row.gameID} | ${row.bucket} | join/min ${row.joinRate.toFixed(2)} | ${new Date(
          row.at,
        ).toLocaleString()}`,
    );

  svg
    .append("text")
    .attr("x", pad)
    .attr("y", pad - 10)
    .attr("fill", "#9db1c5")
    .attr("font-size", 10)
    .text("join/min raw (blue) + moving avg (green)");
}

function renderOrder(payload: AnalyticsPayload): void {
  const rows = payload.order.slice(-resolveOrderCount());
  if (rows.length === 0) {
    containers.orderChart.innerHTML = "<p>No data yet.</p>";
    containers.orderTable.innerHTML = "";
    return;
  }
  const width = 1220;
  const rowHeight = 18;
  const height = Math.max(220, rows.length * rowHeight + 30);

  const minAt = Math.min(...rows.map((row) => row.openedAt));
  const maxAt = Math.max(...rows.map((row) => orderRowMaxAt(row, payload.now)));
  const pad = 16;
  const x = d3
    .scaleLinear()
    .domain([minAt, Math.max(minAt + 1, maxAt)])
    .range([pad, width - pad]);

  const statusStrokeFor = (status: string): string =>
    status === "started"
      ? "#9fff7a"
      : status === "completed"
        ? "#7fd3ff"
      : status === "did_not_start"
        ? "#ff6b6b"
        : "#ffd166";

  containers.orderChart.innerHTML = "";
  const svg = d3
    .select(containers.orderChart)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", "100%")
    .attr("height", "100%");

  const legendBuckets = Array.from(new Set(rows.map((row) => row.bucket))).slice(0, 12);
  const legend = svg.append("g").attr("class", "order-legend");
  legendBuckets.forEach((bucket, index) => {
    const color = colorForBucket(bucket);
    const xPos = 14 + (index % 4) * 300;
    const yPos = 12 + Math.floor(index / 4) * 14;
    legend
      .append("rect")
      .attr("x", xPos)
      .attr("y", yPos)
      .attr("width", 10)
      .attr("height", 10)
      .attr("fill", color)
      .attr("opacity", 0.95);
    legend
      .append("text")
      .attr("x", xPos + 14)
      .attr("y", yPos + 9)
      .attr("fill", "#d3e2ef")
      .attr("font-size", 10)
      .text(bucket.length > 36 ? `${bucket.slice(0, 36)}...` : bucket);
  });

  const rowGroups = svg
    .append("g")
    .attr("class", "order-bars")
    .selectAll("g.order-row")
    .data(rows)
    .enter()
    .append("g")
    .attr("class", "order-row");

  rowGroups.each(function eachRow(
    this: SVGGElement,
    row: AnalyticsPayload["order"][number],
    index: number,
  ): void {
    const group = d3.select(this);
    const y = 20 + index * rowHeight;
    const startX = x(row.openedAt);
    const lobbyEndAt = orderRowLobbyEndAt(row);
    const lobbyEndX = Math.max(startX + 2, x(lobbyEndAt));
    const lobbyColor = colorForBucketPhase(row.bucket, "lobby", row.status);
    const gameStartAt = orderRowGameStartAt(row);
    const gameEndAt = orderRowGameEndAt(row, payload.now);
    const statusStroke = statusStrokeFor(row.status);
    const openDurationText = formatDurationMs(row.openDurationMs);
    const gameDurationText = formatGameDuration(row, payload.now);
    const titleText = `${row.gameID} | ${row.bucket} | status ${row.status} | open ${openDurationText} | game ${gameDurationText}`;

    group
      .append("rect")
      .attr("x", startX)
      .attr("y", y)
      .attr("width", lobbyEndX - startX)
      .attr("height", 10)
      .attr("fill", lobbyColor)
      .attr("stroke", statusStroke)
      .attr("stroke-width", 0.7)
      .attr("opacity", 0.95)
      .append("title")
      .text(titleText);

    if (gameStartAt !== undefined && gameEndAt !== undefined && gameEndAt > gameStartAt) {
      const gameStartX = Math.max(startX + 1, x(gameStartAt));
      const gameEndX = Math.max(gameStartX + 2, x(gameEndAt));
      const gameColor = colorForBucketPhase(row.bucket, "game", row.status);
      group
        .append("rect")
        .attr("x", gameStartX)
        .attr("y", y)
        .attr("width", gameEndX - gameStartX)
        .attr("height", 10)
        .attr("fill", gameColor)
        .attr("stroke", statusStroke)
        .attr("stroke-width", 0.6)
        .attr("opacity", 0.95)
        .append("title")
        .text(titleText);
    }
  });

  svg
    .append("text")
    .attr("x", 14)
    .attr("y", height - 10)
    .attr("fill", "#9db1c5")
    .attr("font-size", 10)
    .text("Saturated segment = lobby open time, muted segment = game runtime");

  containers.orderTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Game</th>
          <th>Bucket</th>
          <th>Status</th>
          <th>Lobby + Game</th>
          <th>Peak Fill</th>
          <th>Connected / Active / Spawned</th>
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
              <td>${formatPeakFill(row)}</td>
              <td>${formatReplayParticipation(row)}</td>
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

function resolveOrderCount(): number {
  const parsed = Number(controls.orderCount.value || DEFAULT_ORDER_COUNT);
  if (!Number.isFinite(parsed)) return DEFAULT_ORDER_COUNT;
  return Math.max(10, Math.min(500, Math.floor(parsed)));
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
              <td>${formatPeakFill(row)}</td>
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

function niceJoinRateMax(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function formatDurationSec(durationSec: number | undefined): string {
  if (durationSec === undefined) return "-";
  return formatDurationMs(durationSec * 1000);
}

function formatReplayParticipation(
  row: Pick<
    AnalyticsPayload["order"][number],
    | "archivePlayers"
    | "archiveConnectedPlayers"
    | "archiveActivePlayers"
    | "archiveSpawnedPlayers"
  >,
): string {
  const connected = row.archiveConnectedPlayers;
  const active = row.archiveActivePlayers;
  const spawned = row.archiveSpawnedPlayers;
  const total = row.archivePlayers;

  if (connected === undefined && active === undefined && spawned === undefined) {
    return "-";
  }

  const triplet = `${connected ?? "-"} / ${active ?? "-"} / ${spawned ?? "-"}`;
  if (total === undefined) return triplet;
  return `${triplet} of ${total}`;
}

function formatPeakFill(
  row: Pick<
    AnalyticsPayload["order"][number],
    "peakClients" | "maxPlayers" | "archiveConnectedPlayers" | "archivePlayers"
  >,
): string {
  const peak = peakFillClients(row);
  if (row.maxPlayers && row.maxPlayers > 0) {
    return `${peak}/${row.maxPlayers}`;
  }
  return String(peak);
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
  return colorForBucketPhase(bucket, "lobby", status);
}

function colorForStatus(status: string): string {
  switch (status) {
    case "started":
      return "#9fff7a";
    case "completed":
      return "#7fd3ff";
    case "did_not_start":
      return "#ff6b6b";
    default:
      return "#ffd166";
  }
}

function colorForBucketPhase(
  bucket: string,
  phase: "lobby" | "game",
  status?: string,
): string {
  const hue = hashString(bucket) % 360;
  if (phase === "game") {
    return `hsl(${hue} 40% 44%)`;
  }
  if (status === "started") {
    // In-progress games keep bucket hue but are less saturated.
    return `hsl(${hue} 40% 58%)`;
  }
  return `hsl(${hue} 75% 58%)`;
}

function orderRowLobbyEndAt(row: AnalyticsPayload["order"][number]): number {
  return row.actualStartAt ?? row.startDetectedAt ?? row.closedAt ?? row.openedAt;
}

function orderRowGameStartAt(
  row: AnalyticsPayload["order"][number],
): number | undefined {
  const start = row.actualStartAt ?? row.startDetectedAt;
  if (start === undefined) return undefined;
  return Math.max(orderRowLobbyEndAt(row), start);
}

function orderRowGameEndAt(
  row: AnalyticsPayload["order"][number],
  now: number,
): number | undefined {
  const start = orderRowGameStartAt(row);
  if (start === undefined) return undefined;

  if (row.actualEndAt !== undefined && row.actualEndAt >= start) {
    return row.actualEndAt;
  }
  if (row.archiveDurationSec !== undefined && row.archiveDurationSec > 0) {
    return start + row.archiveDurationSec * 1000;
  }
  if (row.status === "started" && now >= start) {
    return now;
  }

  return undefined;
}

function orderRowMaxAt(row: AnalyticsPayload["order"][number], now: number): number {
  return orderRowGameEndAt(row, now) ?? orderRowLobbyEndAt(row);
}
