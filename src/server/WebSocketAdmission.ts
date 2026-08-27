import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

// A game WebSocket is not associated with a GameServer until its first frame
// has authenticated and joined. Without a bounded handshake, an unauthenticated
// peer can keep a file descriptor and its event listeners alive indefinitely.
// These limits apply only to that pre-authentication window; normal in-game
// connections are not counted after the lease is completed.
export const PRE_AUTH_TIMEOUT_MS = 30_000;
export const MAX_PRE_AUTH_MESSAGE_BYTES = 64 * 1024;
// Transport starts its heartbeat as soon as the socket opens, while the join
// token may still be loading. Allow that one ping plus the actual join frame.
export const MAX_PRE_AUTH_MESSAGES_PER_CONNECTION = 2;
export const MAX_PRE_AUTH_CONNECTIONS = 1024;
export const MAX_PRE_AUTH_CONNECTIONS_PER_IP = 8;
export const MAX_PRE_AUTH_ATTEMPTS_PER_IP = 60;
export const PRE_AUTH_ATTEMPT_WINDOW_MS = 60_000;
export const MAX_TRACKED_PRE_AUTH_IPS = 4096;

// The IP comes from a proxy header in production and is therefore input to a
// bounded in-memory map. Invalid or absent values share one bucket instead of
// allowing an attacker to manufacture unbounded map keys.
export function normalizeClientIp(ip: string): string {
  const value = ip.trim();
  return isIP(value) === 0 ? "unknown" : value;
}

export function getClientIp(req: IncomingMessage): string {
  const cfIp = req.headers["cf-connecting-ip"];
  if (typeof cfIp === "string") {
    const normalized = normalizeClientIp(cfIp);
    if (normalized !== "unknown") return normalized;
  }
  return normalizeClientIp(req.socket.remoteAddress ?? "unknown");
}

export type PreAuthMessageResult =
  | "accepted"
  | "message_too_large"
  | "too_many_messages"
  | "released";

export interface WebSocketAdmissionLimits {
  maxConnections?: number;
  maxConnectionsPerIp?: number;
  maxAttemptsPerIp?: number;
  attemptWindowMs?: number;
  maxTrackedIps?: number;
  maxMessagesPerConnection?: number;
  maxMessageBytes?: number;
}

interface IpBucket {
  active: number;
  attempts: number[];
  lastSeen: number;
}

/**
 * A lease for one unauthenticated WebSocket. It is deliberately idempotent:
 * both the close event and the authentication path may try to release it, and
 * doing so twice must never make another client's slot available incorrectly.
 */
export class WebSocketAdmissionLease {
  private messageCount = 0;
  private released = false;

  constructor(
    private readonly releaseSlot: () => void,
    private readonly maxMessages: number,
    private readonly maxMessageBytes: number,
  ) {}

  acceptMessage(bytes: number): PreAuthMessageResult {
    if (this.released) return "released";
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      return "message_too_large";
    }
    if (bytes > this.maxMessageBytes) {
      return "message_too_large";
    }
    if (this.messageCount >= this.maxMessages) {
      return "too_many_messages";
    }
    this.messageCount++;
    return "accepted";
  }

  // Called when the handshake has completed successfully. The connected
  // socket is then governed by GameServer's normal lifecycle and no longer
  // consumes a pre-authentication slot.
  complete(): void {
    this.release();
  }

  // Called when the socket closes or the handshake is rejected.
  release(): void {
    if (this.released) return;
    this.released = true;
    this.releaseSlot();
  }
}

/**
 * Limits unauthenticated WebSocket resource usage before any JWT/API work is
 * performed. The global cap protects the worker when source IPs are obscured;
 * the per-IP caps stop one client from consuming every pending slot and rate
 * limit repeated handshake/API attempts after each connection is closed.
 */
export class WebSocketAdmissionControl {
  private readonly buckets = new Map<string, IpBucket>();
  private readonly maxConnections: number;
  private readonly maxConnectionsPerIp: number;
  private readonly maxAttemptsPerIp: number;
  private readonly attemptWindowMs: number;
  private readonly maxTrackedIps: number;
  private readonly maxMessagesPerConnection: number;
  private readonly maxMessageBytes: number;
  private activeConnections = 0;

  constructor(
    limits: WebSocketAdmissionLimits = {},
    private readonly now: () => number = Date.now,
  ) {
    this.maxConnections = limits.maxConnections ?? MAX_PRE_AUTH_CONNECTIONS;
    this.maxConnectionsPerIp =
      limits.maxConnectionsPerIp ?? MAX_PRE_AUTH_CONNECTIONS_PER_IP;
    this.maxAttemptsPerIp =
      limits.maxAttemptsPerIp ?? MAX_PRE_AUTH_ATTEMPTS_PER_IP;
    this.attemptWindowMs = limits.attemptWindowMs ?? PRE_AUTH_ATTEMPT_WINDOW_MS;
    this.maxTrackedIps = limits.maxTrackedIps ?? MAX_TRACKED_PRE_AUTH_IPS;
    this.maxMessagesPerConnection =
      limits.maxMessagesPerConnection ?? MAX_PRE_AUTH_MESSAGES_PER_CONNECTION;
    this.maxMessageBytes = limits.maxMessageBytes ?? MAX_PRE_AUTH_MESSAGE_BYTES;
  }

  acquire(ip: string): WebSocketAdmissionLease | null {
    const now = this.now();
    const key = normalizeClientIp(ip);
    // Do this before creating a bucket: once the worker is full, rejected
    // requests must not still be able to grow the bookkeeping map.
    if (this.activeConnections >= this.maxConnections) return null;
    const bucket = this.getBucket(key, now);
    if (bucket === null) return null;
    this.pruneAttempts(bucket, now);

    if (
      this.activeConnections >= this.maxConnections ||
      bucket.active >= this.maxConnectionsPerIp ||
      bucket.attempts.length >= this.maxAttemptsPerIp
    ) {
      return null;
    }

    bucket.active++;
    bucket.attempts.push(now);
    bucket.lastSeen = now;
    this.activeConnections++;

    return new WebSocketAdmissionLease(
      () => {
        bucket.active = Math.max(0, bucket.active - 1);
        this.activeConnections = Math.max(0, this.activeConnections - 1);
        bucket.lastSeen = this.now();
      },
      this.maxMessagesPerConnection,
      this.maxMessageBytes,
    );
  }

  // Exposed for focused tests and operational metrics without exposing the
  // internal IP buckets.
  pendingConnections(): number {
    return this.activeConnections;
  }

  private getBucket(key: string, now: number): IpBucket | null {
    let bucket = this.buckets.get(key);
    if (bucket !== undefined) return bucket;

    this.pruneBuckets(now);
    if (this.buckets.size >= this.maxTrackedIps) return null;
    bucket = { active: 0, attempts: [], lastSeen: now };
    this.buckets.set(key, bucket);
    return bucket;
  }

  private pruneAttempts(bucket: IpBucket, now: number): void {
    const cutoff = now - this.attemptWindowMs;
    bucket.attempts = bucket.attempts.filter((attempt) => attempt > cutoff);
  }

  private pruneBuckets(now: number): void {
    for (const [key, bucket] of this.buckets) {
      this.pruneAttempts(bucket, now);
      if (
        bucket.active === 0 &&
        bucket.attempts.length === 0 &&
        now - bucket.lastSeen >= this.attemptWindowMs
      ) {
        this.buckets.delete(key);
      }
    }
  }
}
