import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import newsItems from "../../../resources/news.json";
import { getNews } from "../../../src/client/Api";
import {
  filterNewsByPlatform,
  getVisibleNewsItems,
  NewsBox,
  NewsItem,
} from "../../../src/client/components/NewsBox";
import {
  fetchCosmetics,
  invalidateCosmetics,
  refreshStaleCosmetics,
} from "../../../src/client/Cosmetics";

vi.mock("../../../src/client/Api", () => ({
  getNews: vi.fn(async () => [
    {
      id: "md",
      title: "Markdown",
      type: "announcement",
      description: "Read the **rules** first",
    },
    { id: "md2", title: "Two", type: "announcement", description: "B" },
  ]),
}));

vi.mock("../../../src/client/Cosmetics", () => ({
  fetchCosmetics: vi.fn(async () => null),
  invalidateCosmetics: vi.fn(),
  refreshStaleCosmetics: vi.fn(() => true),
}));

/** A catalog running `sales`, with nothing else in it. */
function catalogWith(
  ...sales: { id: string; name: string; endsAt: string }[]
): Cosmetics {
  return {
    patterns: {},
    flags: {},
    promotions: sales.map((sale) => ({ percentOff: 25, ...sale })),
  } as unknown as Cosmetics;
}

/** news.json as the API serves it while sale `id` runs and is announced. */
function newsAnnouncing(id: string) {
  return [
    {
      id: `promotion-${id}`,
      title: "Weekend Sale",
      type: "announcement" as const,
      description: "25% off cosmetics in the store.",
    },
    { id: "md", title: "Patch notes", type: "announcement" as const },
  ];
}

const DISMISSED_NEWS_KEY = "dismissedNewsItems";
const allItems = newsItems as NewsItem[];

function createMockLocalStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

describe("NewsBox", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getVisibleNewsItems", () => {
    it("returns all items when none are dismissed", () => {
      const items = getVisibleNewsItems(allItems);
      expect(items.length).toBe(newsItems.length);
    });

    it("filters out dismissed items", () => {
      const items = getVisibleNewsItems(allItems);
      const firstId = items[0].id;
      localStorage.setItem(DISMISSED_NEWS_KEY, JSON.stringify([firstId]));
      const filtered = getVisibleNewsItems(allItems);
      expect(filtered.find((i) => i.id === firstId)).toBeUndefined();
      expect(filtered.length).toBe(items.length - 1);
    });

    it("returns empty when all items are dismissed", () => {
      const allIds = allItems.map((i) => i.id);
      localStorage.setItem(DISMISSED_NEWS_KEY, JSON.stringify(allIds));
      const items = getVisibleNewsItems(allItems);
      expect(items.length).toBe(0);
    });
  });

  describe("filterNewsByPlatform", () => {
    const everywhere: NewsItem = { id: "a", title: "A", type: "announcement" };
    const emptyList: NewsItem = {
      id: "b",
      title: "B",
      type: "announcement",
      platforms: [],
    };
    const webOnly: NewsItem = {
      id: "c",
      title: "C",
      type: "announcement",
      platforms: ["web", "crazygames"],
    };
    const items = [everywhere, emptyList, webOnly];

    it("hides items targeted at other platforms", () => {
      expect(filterNewsByPlatform(items, "steam").map((i) => i.id)).toEqual([
        "a",
        "b",
      ]);
    });

    it("shows items targeted at the current platform", () => {
      expect(filterNewsByPlatform(items, "web").map((i) => i.id)).toEqual([
        "a",
        "b",
        "c",
      ]);
    });
  });

  describe("the element", () => {
    afterEach(() => {
      document.body.innerHTML = "";
    });

    // The markdown renderer is its own chunk, loaded with the news.
    it("renders a description's markdown", async () => {
      const box = document.createElement("news-box");
      document.body.appendChild(box);

      await vi.waitFor(() =>
        expect(box.querySelector("strong")?.textContent).toBe("rules"),
      );
    });

    it("is the sale banner for as long as an announced sale runs", async () => {
      const endsAt = new Date(Date.now() + 3_600_000).toISOString();
      vi.mocked(getNews).mockResolvedValueOnce(newsAnnouncing("7"));
      vi.mocked(fetchCosmetics).mockResolvedValueOnce(
        catalogWith({ id: "7", name: "Weekend Sale", endsAt }),
      );
      const box = document.createElement("news-box");
      document.body.appendChild(box);

      await vi.waitFor(() =>
        expect(box.querySelector("[data-store-sale-banner]")).toBeTruthy(),
      );
      const banner = box.querySelector("[data-store-sale-banner]")!;
      expect(banner.textContent).toContain("Weekend Sale");
      expect(banner.querySelector("sale-countdown")).toBeTruthy();
      // No news under it, nothing to dismiss, no rotation.
      expect(box.textContent).not.toContain("Patch notes");
      expect(box.querySelector('[aria-label="news_box.dismiss"]')).toBeNull();

      (banner as HTMLButtonElement).click();
      expect(window.location.hash).toBe("#modal=store&tab=cosmetics&sub=sale");
    });

    it("leaves the news alone for a sale not set to announce", async () => {
      const endsAt = new Date(Date.now() + 3_600_000).toISOString();
      vi.mocked(fetchCosmetics).mockResolvedValueOnce(
        catalogWith({ id: "7", name: "Quiet Sale", endsAt }),
      );
      const box = document.createElement("news-box");
      document.body.appendChild(box);

      await vi.waitFor(() => expect(box.textContent).toContain("Markdown"));
      expect(box.querySelector("[data-store-sale-banner]")).toBeNull();
    });

    describe("as time passes", () => {
      const MINUTE = 60_000;
      const sale = (id: string, name: string, endsInMs: number) => ({
        id,
        name,
        endsAt: new Date(Date.now() + endsInMs).toISOString(),
      });
      const bannerOf = (box: Element) =>
        box.querySelector("[data-store-sale-banner]");

      beforeEach(() => {
        vi.useFakeTimers();
        vi.mocked(invalidateCosmetics).mockClear();
        vi.mocked(refreshStaleCosmetics).mockClear();
      });

      afterEach(() => {
        vi.useRealTimers();
        vi.mocked(fetchCosmetics).mockReset();
        vi.mocked(fetchCosmetics).mockResolvedValue(null);
        vi.unstubAllGlobals();
        vi.stubGlobal("localStorage", createMockLocalStorage());
      });

      it("goes back to the news when the sale ends", async () => {
        const weekend = sale("7", "Weekend Sale", 60 * MINUTE);
        vi.mocked(getNews).mockResolvedValueOnce(newsAnnouncing("7"));
        // The refetch at its end still lists it (the API caches for a minute).
        vi.mocked(fetchCosmetics).mockResolvedValue(catalogWith(weekend));
        const box = document.createElement("news-box");
        document.body.appendChild(box);
        await vi.waitFor(() => expect(bannerOf(box)).toBeTruthy());

        await vi.advanceTimersByTimeAsync(60 * MINUTE + 1_000);

        await vi.waitFor(() =>
          expect(box.textContent).toContain("Patch notes"),
        );
        expect(bannerOf(box)).toBeNull();
        // The ended sale's news item stays out of the rotation.
        expect(box.textContent).not.toContain("25% off cosmetics");
      });

      it("shows a sale that starts after the page loaded", async () => {
        vi.mocked(fetchCosmetics).mockResolvedValue(catalogWith());
        const box = document.createElement("news-box");
        document.body.appendChild(box);
        await vi.waitFor(() => expect(box.textContent).toContain("Markdown"));
        expect(bannerOf(box)).toBeNull();

        vi.mocked(fetchCosmetics).mockResolvedValue(
          catalogWith(sale("7", "Surprise Sale", 60 * MINUTE)),
        );
        vi.mocked(getNews).mockResolvedValueOnce(newsAnnouncing("7"));
        await vi.advanceTimersByTimeAsync(5 * MINUTE);

        await vi.waitFor(() => expect(bannerOf(box)).toBeTruthy());
        expect(bannerOf(box)!.textContent).toContain("Surprise Sale");
        expect(refreshStaleCosmetics).toHaveBeenCalled();
      });

      it("doesn't refetch while nobody can see the box", async () => {
        vi.mocked(fetchCosmetics).mockResolvedValue(catalogWith());
        const box = document.createElement("news-box");
        box.checkVisibility = () => false;
        document.body.appendChild(box);
        await vi.waitFor(() => expect(box.textContent).toContain("Markdown"));

        await vi.advanceTimersByTimeAsync(5 * MINUTE);

        expect(refreshStaleCosmetics).not.toHaveBeenCalled();
        expect(invalidateCosmetics).not.toHaveBeenCalled();
      });

      it("drops a sale on time while a stale catalog is retried", async () => {
        // The first sale has ended but is still listed, so the box is retrying
        // every 15 seconds. The other ends well before the next retry.
        const ended = sale("6", "Old Sale", -MINUTE);
        const ending = sale("7", "Ending Sale", 2_000);
        vi.mocked(getNews).mockResolvedValueOnce(newsAnnouncing("7"));
        vi.mocked(fetchCosmetics).mockResolvedValue(catalogWith(ended, ending));
        const box = document.createElement("news-box");
        document.body.appendChild(box);
        await vi.waitFor(() => expect(bannerOf(box)).toBeTruthy());

        await vi.advanceTimersByTimeAsync(3_000);

        expect(bannerOf(box)).toBeNull();
      });

      it("keeps rendering when a refetch brings fewer news items", async () => {
        // A sale not set to announce keeps the box refetching news.json.
        vi.mocked(fetchCosmetics).mockResolvedValue(
          catalogWith(sale("7", "Quiet Sale", 60 * MINUTE)),
        );
        const box = document.createElement("news-box");
        document.body.appendChild(box);
        await vi.waitFor(() => expect(box.textContent).toContain("Markdown"));
        // The cycle moves on to the second item.
        await vi.advanceTimersByTimeAsync(5_000);
        await vi.waitFor(() => expect(box.textContent).toContain("Two"));

        vi.mocked(getNews).mockResolvedValueOnce([
          { id: "only", title: "Only one", type: "announcement" },
        ]);
        await vi.advanceTimersByTimeAsync(5 * MINUTE);

        await vi.waitFor(() => expect(box.textContent).toContain("Only one"));
      });

      it("keeps a sale's banner when a news refetch announces nothing", async () => {
        const announced = sale("7", "Weekend Sale", 60 * MINUTE);
        const quiet = sale("8", "Quiet Sale", 60 * MINUTE);
        vi.mocked(getNews).mockResolvedValueOnce(newsAnnouncing("7"));
        vi.mocked(fetchCosmetics).mockResolvedValue(
          catalogWith(announced, quiet),
        );
        const box = document.createElement("news-box");
        document.body.appendChild(box);
        await vi.waitFor(() => expect(bannerOf(box)).toBeTruthy());

        // The quiet sale prompts a refetch, which gets news with no sale in it.
        await vi.advanceTimersByTimeAsync(5 * MINUTE);

        expect(bannerOf(box)!.textContent).toContain("Weekend Sale");
      });

      it("drops an ended sale even when the catalog object is the same", async () => {
        const catalog = catalogWith(
          sale("6", "Short Sale", 2_000),
          sale("7", "Long Sale", 60 * MINUTE),
        );
        vi.mocked(getNews).mockResolvedValueOnce([
          ...newsAnnouncing("6"),
          ...newsAnnouncing("7").slice(0, 1),
        ]);
        vi.mocked(fetchCosmetics).mockResolvedValue(catalog);
        const box = document.createElement("news-box");
        document.body.appendChild(box);
        await vi.waitFor(() =>
          expect(bannerOf(box)!.textContent).toContain("Short Sale"),
        );

        await vi.advanceTimersByTimeAsync(3_000);

        await vi.waitFor(() =>
          expect(bannerOf(box)!.textContent).not.toContain("Short Sale"),
        );
        expect(bannerOf(box)!.textContent).toContain("Long Sale");
      });

      it("copes with a sale ending further off than a timer can wait", async () => {
        const spy = vi.spyOn(globalThis, "setTimeout");
        vi.mocked(fetchCosmetics).mockResolvedValue(
          catalogWith(sale("7", "Long Sale", 40 * 24 * 60 * MINUTE)),
        );
        vi.mocked(getNews).mockResolvedValueOnce(newsAnnouncing("7"));
        const box = document.createElement("news-box");
        document.body.appendChild(box);
        await vi.waitFor(() => expect(bannerOf(box)).toBeTruthy());

        expect(spy).toHaveBeenCalledWith(expect.any(Function), 5 * MINUTE);
        spy.mockRestore();
      });
    });

    it("does not start cycle timer if disconnected before loadNews resolves", async () => {
      const el = new NewsBox() as any;
      document.body.appendChild(el);
      el.remove();
      await new Promise((r) => setTimeout(r, 10));
      expect(el.cycleTimer).toBeNull();
    });
  });

  describe("news items structure", () => {
    it("each item has required fields", () => {
      const items = getVisibleNewsItems(allItems);
      for (const item of items) {
        expect(item.id).toBeDefined();
        expect(typeof item.id).toBe("string");
        expect(item.title).toBeDefined();
        expect(typeof item.title).toBe("string");
        const hasDescription =
          item.description !== undefined ||
          item.descriptionTranslationKey !== undefined;
        expect(hasDescription).toBe(true);
        expect(item.type).toBeDefined();
        expect(["tournament", "tutorial", "announcement", "warning"]).toContain(
          item.type,
        );
      }
    });

    it("each item has a unique id", () => {
      const items = getVisibleNewsItems(allItems);
      const ids = items.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("contains a tournament entry", () => {
      const items = getVisibleNewsItems(allItems);
      expect(items.some((i) => i.type === "tournament")).toBe(true);
    });
  });
});
