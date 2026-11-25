import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";

// After a failed catalogue fetch, the next request waits this long. The lobby
// tag, hover summary and panel ask on every render (the summary and panel
// about ten times a second in a game), so without it an API outage would turn
// each render into a request.
export const CATALOGUE_RETRY_MS = 30_000;

// One component's request for the cosmetics catalogue, for the card art: at
// most one in flight, and after a failure (null or a throw) a later request
// tries again once CATALOGUE_RETRY_MS has passed. No timer: only a request
// made by a later render retries.
export class CardCatalogueRequest {
  private inFlight = false;
  private retryAt = 0;

  constructor(
    private readonly fetch: () => Promise<Cosmetics | null>,
    private readonly onLoaded: (cosmetics: Cosmetics) => void,
  ) {}

  request(): void {
    if (this.inFlight || Date.now() < this.retryAt) return;
    this.inFlight = true;
    const failed = () => {
      this.inFlight = false;
      this.retryAt = Date.now() + CATALOGUE_RETRY_MS;
    };
    void this.fetch().then((cosmetics) => {
      if (cosmetics === null) return failed();
      this.inFlight = false;
      this.onLoaded(cosmetics);
    }, failed);
  }
}
