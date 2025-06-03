import { PseudoRandom } from "../core/PseudoRandom";

interface WorkerInfo {
  id: string;
  dns: string;
  activeClients: number;
  lastHeartbeat: Date;
  healthy: boolean;
}

// WorkerDiscoveryService - manages worker registry and load balancing
export class WorkerDiscoveryService {
  private workers: Map<string, WorkerInfo> = new Map();
  private readonly HEARTBEAT_TIMEOUT = 60000; // 60 seconds
  private readonly CLEANUP_INTERVAL = 5000; // Check every 5 seconds
  private readonly MAX_ACTIVE_CLIENTS = 500; // Can actually handle up to 1000, but we don't want to overload the workers
  private readonly rand = new PseudoRandom(1);

  constructor() {
    // Periodically clean up dead workers
    setInterval(() => this.cleanupDeadWorkers(), this.CLEANUP_INTERVAL);
  }

  // Worker sends heartbeat with current state
  updateWorkerHeartbeat(
    workerId: string,
    dns: string,
    activeClients: number,
  ): void {
    const existingWorker = this.workers.get(workerId);

    this.workers.set(workerId, {
      id: workerId,
      dns,
      activeClients,
      lastHeartbeat: new Date(),
      healthy: true,
    });

    // Log if this is a new worker
    if (!existingWorker) {
      console.log(`New worker registered: ${workerId} at ${dns}`);
    }
  }

  getAvailableWorker(): WorkerInfo | null {
    let healthyWorkers = Array.from(this.workers.values())
      .filter((w) => w.healthy && w.activeClients < this.MAX_ACTIVE_CLIENTS)
      .sort((a, b) => {
        // Sort by load percentage (ascending)
        const loadA = a.activeClients / this.MAX_ACTIVE_CLIENTS;
        const loadB = b.activeClients / this.MAX_ACTIVE_CLIENTS;
        return loadA - loadB;
      });

    if (healthyWorkers.length === 0) {
      healthyWorkers = Array.from(this.workers.values());
    }

    return this.rand.randElement(healthyWorkers);
  }

  // Get specific worker info
  getWorker(workerId: string): WorkerInfo | null {
    const worker = this.workers.get(workerId);
    return worker?.healthy ? worker : null;
  }

  // Remove dead workers
  private cleanupDeadWorkers() {
    const now = Date.now();

    for (const [workerId, worker] of this.workers) {
      const timeSinceHeartbeat = now - worker.lastHeartbeat.getTime();

      if (timeSinceHeartbeat > this.HEARTBEAT_TIMEOUT && worker.healthy) {
        // Mark as unhealthy first (soft delete)
        worker.healthy = false;
        console.log(
          `Worker ${workerId} marked unhealthy (no heartbeat for ${timeSinceHeartbeat}ms)`,
        );
      } else if (timeSinceHeartbeat > this.HEARTBEAT_TIMEOUT * 3) {
        // Hard delete after 30 seconds
        this.workers.delete(workerId);
        console.log(
          `Worker ${workerId} removed (dead for ${timeSinceHeartbeat}ms)`,
        );
      }
    }
  }

  // Manually remove a worker (for graceful shutdown)
  removeWorker(workerId: string): boolean {
    const existed = this.workers.has(workerId);
    this.workers.delete(workerId);
    if (existed) {
      console.log(`Worker ${workerId} manually removed`);
    }
    return existed;
  }
}
