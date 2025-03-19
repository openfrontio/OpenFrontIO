import promClient from "prom-client";
import { GameManager } from "./GameManager";

// Initialize the Prometheus registry
const register = new promClient.Registry();

// Enable default Node.js metrics collection
promClient.collectDefaultMetrics({ register });

// Add worker-specific metrics
const activeGamesGauge = new promClient.Gauge({
  name: "active_games_count",
  help: "Number of active games on this worker",
  registers: [register],
});

const connectedClientsGauge = new promClient.Gauge({
  name: "connected_clients_count",
  help: "Number of connected clients on this worker",
  registers: [register],
});

const memoryUsageGauge = new promClient.Gauge({
  name: "memory_usage_bytes",
  help: "Current memory usage of the worker process in bytes",
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
    activeGamesGauge.set(gameManager.activeGames());
    connectedClientsGauge.set(gameManager.activeClients());

    // Update memory usage metrics
    const memoryUsage = process.memoryUsage();
    memoryUsageGauge.set(memoryUsage.heapUsed);
  },
};
