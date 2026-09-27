import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import * as dotenv from "dotenv";
import { GameManager } from "./GameManager";
import { getOtelResource, getPromLabels } from "./OtelResource";
import { ServerEnv } from "./ServerEnv";
import { SingleplayerPresence } from "./SingleplayerPresence";
import { WorkerLobbyService } from "./WorkerLobbyService";

dotenv.config();

export function initWorkerMetrics(
  gameManager: GameManager,
  lobbyService: WorkerLobbyService,
  singleplayerPresence: SingleplayerPresence,
): void {
  // Create resource with worker information
  const resource = getOtelResource();

  // Configure auth headers
  const headers: Record<string, string> = {};
  if (ServerEnv.otelEnabled()) {
    headers["Authorization"] = "Basic " + ServerEnv.otelAuthHeader();
  }

  // Create metrics exporter
  const metricExporter = new OTLPMetricExporter({
    url: `${ServerEnv.otelEndpoint()}/v1/metrics`,
    headers,
  });

  // Configure the metric reader
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 15000, // Export metrics every 15 seconds
  });

  // Create a meter provider
  const meterProvider = new MeterProvider({
    resource,
    readers: [metricReader],
  });

  // Get meter for creating metrics
  const meter = meterProvider.getMeter("worker-metrics");

  // Create observable gauges
  const activeGamesGauge = meter.createObservableGauge(
    "openfront.active_games.gauge",
    {
      description: "Number of active games on this worker",
    },
  );

  const connectedClientsGauge = meter.createObservableGauge(
    "openfront.connected_clients.gauge",
    {
      description: "Number of connected clients on this worker",
    },
  );

  const lobbyClientsGauge = meter.createObservableGauge(
    "openfront.lobby_clients.gauge",
    {
      description:
        "Number of clients connected to the /lobbies WebSocket on this worker",
    },
  );

  const singleplayerGamesGauge = meter.createObservableGauge(
    "openfront.singleplayer_games.gauge",
    {
      description:
        "Number of in-browser singleplayer games heartbeating to this worker",
    },
  );

  const desyncsGauge = meter.createObservableGauge("openfront.desyncs.gauge", {
    description: "Number of detected desyncs on active games on this worker",
  });

  const memoryUsageGauge = meter.createObservableGauge(
    "openfront.memory_usage.bytes",
    {
      description: "Current memory usage of the worker process in bytes",
    },
  );

  activeGamesGauge.addCallback((result) => {
    const count = gameManager.activeGames();
    result.observe(count, getPromLabels());
  });

  connectedClientsGauge.addCallback((result) => {
    const labels = getPromLabels();
    for (const [platform, count] of gameManager.activeClientsByPlatform()) {
      result.observe(count, { ...labels, "openfront.platform": platform });
    }
  });

  lobbyClientsGauge.addCallback((result) => {
    const labels = getPromLabels();
    for (const [platform, count] of lobbyService.connectedClientsByPlatform()) {
      result.observe(count, { ...labels, "openfront.platform": platform });
    }
  });

  singleplayerGamesGauge.addCallback((result) => {
    const labels = getPromLabels();
    for (const [
      platform,
      count,
    ] of singleplayerPresence.activeGamesByPlatform()) {
      result.observe(count, { ...labels, "openfront.platform": platform });
    }
  });

  desyncsGauge.addCallback((result) => {
    const count = gameManager.desyncCount();
    result.observe(count, getPromLabels());
  });

  memoryUsageGauge.addCallback((result) => {
    const memoryUsage = process.memoryUsage();
    result.observe(memoryUsage.heapUsed, getPromLabels());
  });

  console.log("Metrics initialized with GameManager");
}
