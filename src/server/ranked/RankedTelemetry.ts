import Redis from "ioredis";

export class RankedTelemetry {
  constructor(private readonly redis: Redis | null) {}

  async incrementQueued(mode: string, region: string): Promise<void> {
    if (!this.redis) return;
    await this.redis.hincrby("ranked:queue:counts", this.key(mode, region), 1);
  }

  async decrementQueued(mode: string, region: string): Promise<void> {
    if (!this.redis) return;
    await this.redis.hincrby("ranked:queue:counts", this.key(mode, region), -1);
  }

  async trackMatchFound(mode: string, region: string): Promise<void> {
    if (!this.redis) return;
    await this.redis.hincrby(
      "ranked:metrics:matches",
      this.key(mode, region),
      1,
    );
  }

  private key(mode: string, region: string): string {
    return `${mode}:${region}`;
  }
}
