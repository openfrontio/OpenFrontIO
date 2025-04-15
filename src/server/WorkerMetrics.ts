import promClient from "prom-client";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { GameManager } from "./GameManager";

const config = getServerConfigFromServer();
const region = config.region();

// Initialize the Prometheus registry
const register = new promClient.Registry();

// Enable default Node.js metrics collection
promClient.collectDefaultMetrics({ register });

// Add worker-specific metrics
const activeGamesGauge = new promClient.Gauge({
  name: "openfront_active_games_count",
  help: "Number of active games on this worker",
  labelNames: ["region"],
  registers: [register],
});

const connectedClientsGauge = new promClient.Gauge({
  name: "openfront_connected_clients_count",
  help: "Number of connected clients on this worker",
  labelNames: ["region"],
  registers: [register],
});

const memoryUsageGauge = new promClient.Gauge({
  name: "openfront_memory_usage_bytes",
  help: "Current memory usage of the worker process in bytes",
  labelNames: ["region"],
  registers: [register],
});

// Export the metrics for use in the worker
export const metrics = {
  register,
  activeGamesGauge,
  connectedClientsGauge,
  memoryUsageGauge,

  // Function to update game-related metrics
  updateGameMetrics: (gameManager: GameManager) => {
    activeGamesGauge.set({ region: region }, gameManager.activeGames());
    connectedClientsGauge.set({ region: region }, gameManager.activeClients());

    // Update memory usage metrics
    const memoryUsage = process.memoryUsage();
    memoryUsageGauge.set({ region: region }, memoryUsage.heapUsed);
  },
};
