import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Store experiments, client side (src/client/Experiments.ts): the player's
// test group, the cohort catalog it is priced with, the exposures that count
// the player in, and the price check on purchases.

const env = vi.hoisted(() => ({
  signedIn: true,
  sub: "account-a",
  steam: false,
}));

vi.mock("../../src/client/ApiBase", () => ({
  getApiBase: () => "https://api.test",
  getAudience: () => "openfront.io",
}));

vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  peekAuthHeader: () => (env.signedIn ? "Bearer token" : ""),
  userAuth: async () =>
    env.signedIn ? { jwt: "token", claims: { sub: env.sub } } : false,
  getAuthHeader: async () => (env.signedIn ? "Bearer token" : ""),
  logOut: vi.fn(async () => true),
}));

vi.mock("../../src/client/DesktopShell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/DesktopShell")>()),
  isSteamShell: () => env.steam,
}));

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getUserMe: vi.fn(),
  invalidateUserMe: vi.fn(),
}));

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn().mockResolvedValue(true),
  showInGameConfirm: vi.fn().mockResolvedValue(true),
}));

const Experiments = await import("../../src/client/Experiments");
const Cosmetics = await import("../../src/client/Cosmetics");
const { StoreTracker } = await import("../../src/client/StoreTracking");
const { getUserMe, invalidateUserMe } = await import("../../src/client/Api");
const { showInGameAlert } = await import("../../src/client/InGameModal");
await import("../../src/client/components/SaleBanner");
await import("../../src/client/components/NewsBox");

const KEY = "daily_deal_depth_1";
const DEEPER = `${KEY}.deeper`;

function assignments(variant: "control" | "deeper", counted = true) {
  return {
    assignments: [
      {
        key: KEY,
        surface: "flash_sale_depth",
        variant,
        counted,
        params: variant === "deeper" ? { percentOffShift: 10 } : {},
      },
    ],
    catalogCohort: variant === "deeper" && counted ? DEEPER : null,
  };
}

const endsAt = () => new Date(Date.now() + 3_600_000).toISOString();

// The flash item at 35% for control, 45% for the Deeper group (80 → 52 / 44).
function catalog(percentOff: number): Cosmetics {
  const sale = {
    id: "40",
    name: "Hot sale",
    percentOff,
    endsAt: endsAt(),
    kind: "flash",
  };
  return {
    patterns: {},
    flags: {
      skull_candle: {
        name: "skull_candle",
        url: "/flags/skull_candle.svg",
        affiliateCode: null,
        product: null,
        rarity: "rare",
        priceHard: Math.round(80 * (1 - percentOff / 100)),
        listPriceHard: 80,
        promotion: sale,
      },
    },
    promotions: [sale],
  } as unknown as Cosmetics;
}

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;
let experimentsRoute: Route;
let purchaseRoute: Route;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function calls(fragment: string): [string, RequestInit | undefined][] {
  return fetchMock.mock.calls
    .map(([url, init]) => [String(url), init] as [string, RequestInit])
    .filter(([url]) => url.includes(fragment));
}

const catalogCalls = () => calls("/cosmetics.json");
const experimentCalls = () =>
  calls("/users/@me/experiments").filter(
    ([url]) => !url.includes("/exposures"),
  );
const exposureBodies = () =>
  calls("/users/@me/experiments/exposures").map(([, init]) =>
    JSON.parse(String(init!.body)),
  );

type Entry = {
  target: Element;
  isIntersecting: boolean;
  intersectionRatio: number;
};

class FakeIO {
  static instances: FakeIO[] = [];
  observed = new Set<Element>();
  constructor(public cb: (entries: Entry[]) => void) {
    FakeIO.instances.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
}

/** Reports the element in or out of view to every observer watching it. */
function setVisible(el: Element, visible: boolean) {
  for (const io of FakeIO.instances) {
    if (!io.observed.has(el)) continue;
    io.cb([
      {
        target: el,
        isIntersecting: visible,
        intersectionRatio: visible ? 1 : 0,
      },
    ]);
  }
}

function flashCard(): HTMLElement {
  const el = document.createElement("section");
  el.setAttribute("data-store-flash", "");
  document.body.appendChild(el);
  return el;
}

const translations = {
  "store.price_changed": "PRICE CHANGED",
  "store.sale_percent_off": "-{percent}%",
  "store.flash_sale_item_banner": "{name} at {percent}% off",
  "store.purchase_success": "bought {name}",
  "cosmetics.hard": "plutonium",
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  env.signedIn = true;
  env.sub = "account-a";
  env.steam = false;
  Experiments.resetExperimentsForTest();
  Cosmetics.invalidateCosmetics();
  localStorage.clear();
  FakeIO.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIO);
  experimentsRoute = () => json(200, { assignments: [], catalogCohort: null });
  purchaseRoute = () => json(200, { amount: "44" });
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/users/@me/experiments/exposures")) {
      return json(200, { recorded: 1, ignored: 0 });
    }
    if (url.includes("/users/@me/experiments")) {
      return experimentsRoute(url, init);
    }
    if (url.includes("/cosmetics.json")) {
      return json(200, catalog(url.includes("cohort=") ? 45 : 35));
    }
    if (url.includes("/shop/purchase")) return purchaseRoute(url, init);
    if (url.includes("/news.json")) {
      return json(200, [
        { id: "promotion-40", title: "Hot sale", type: "announcement" },
      ]);
    }
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const lang = document.createElement("lang-selector");
  Object.assign(lang, {
    translations,
    defaultTranslations: translations,
    currentLang: "en",
  });
  document.body.appendChild(lang);
});

afterEach(() => {
  document.body.innerHTML = "";
  Cosmetics.invalidateCosmetics();
  Experiments.resetExperimentsForTest();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.mocked(showInGameAlert).mockClear();
});

describe("loading the player's groups", () => {
  it("asks once per account, with the bearer and the platform", async () => {
    experimentsRoute = () => json(200, assignments("deeper"));
    const state = await Experiments.loadExperiments();
    await Experiments.loadExperiments();
    expect(experimentCalls()).toHaveLength(1);
    const [url, init] = experimentCalls()[0];
    expect(url).toBe("https://api.test/users/@me/experiments?platform=web");
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      "Bearer token",
    );
    expect(state.catalogCohort).toBe(DEEPER);
    expect(Experiments.catalogCohort()).toBe(DEEPER);
    expect(Experiments.experimentAssignment(KEY)?.variant).toBe("deeper");
  });

  it("reloads for a different account, and drops the old group", async () => {
    experimentsRoute = () => json(200, assignments("deeper"));
    await Experiments.loadExperiments();
    env.sub = "account-b";
    experimentsRoute = () => json(200, assignments("control"));
    await Experiments.loadExperiments();
    expect(experimentCalls()).toHaveLength(2);
    expect(Experiments.catalogCohort()).toBeNull();
    expect(Experiments.experimentAssignment(KEY)?.variant).toBe("control");
  });

  it("makes no call, and fetches the plain catalog, when signed out", async () => {
    env.signedIn = false;
    Experiments.expectExperiments();
    await Experiments.loadExperiments();
    await Cosmetics.fetchCosmetics();
    expect(experimentCalls()).toHaveLength(0);
    expect(catalogCalls().map(([url]) => url)).toEqual([
      "https://api.test/cosmetics.json?rail=web",
    ]);
  });

  it("settles at once when signed out, so the catalog doesn't wait", async () => {
    env.signedIn = false;
    Experiments.expectExperiments();
    void Experiments.loadExperiments();
    // No timers advanced: the catalog goes out on the published (empty)
    // groups, not on the 1.5 s timeout.
    await Cosmetics.fetchCosmetics();
    expect(Experiments.experimentsState()).toMatchObject({
      account: null,
      assignments: [],
    });
    expect(catalogCalls()).toHaveLength(1);
  });

  it("makes no call on Steam", async () => {
    env.steam = true;
    Experiments.expectExperiments();
    const state = await Experiments.loadExperiments();
    expect(experimentCalls()).toHaveLength(0);
    expect(state).toMatchObject({ assignments: [], catalogCohort: null });
    const fetched = Cosmetics.fetchCosmetics();
    await vi.advanceTimersByTimeAsync(Cosmetics.EXPERIMENTS_WAIT_MS);
    await fetched;
    expect(catalogCalls().map(([url]) => url)[0]).not.toContain("cohort=");
  });

  it.each([
    ["a server error", () => json(500, { error: "boom" })],
    ["an unexpected body", () => json(200, { nope: true })],
    [
      "a network failure",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("falls back to the plain store on %s", async (_label, route) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    experimentsRoute = route as Route;
    Experiments.expectExperiments();
    void Experiments.loadExperiments();
    const cosmetics = await Cosmetics.fetchCosmetics();
    expect(cosmetics).not.toBeNull();
    expect(catalogCalls().map(([url]) => url)).toEqual([
      "https://api.test/cosmetics.json?rail=web",
    ]);
    expect(Experiments.experimentsState()?.assignments).toEqual([]);
    // Nothing to expose.
    const el = flashCard();
    Experiments.exposureWatcher.observe(el, "store_flash");
    setVisible(el, true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(exposureBodies()).toEqual([]);
  });
});

describe("the cohort catalog", () => {
  it("fetches the Deeper group's catalog by its cohort", async () => {
    experimentsRoute = () => json(200, assignments("deeper"));
    Experiments.expectExperiments();
    void Experiments.loadExperiments();
    const cosmetics = await Cosmetics.fetchCosmetics();
    expect(catalogCalls().map(([url]) => url)).toEqual([
      `https://api.test/cosmetics.json?rail=web&cohort=${DEEPER}`,
    ]);
    // The banner and the store read the group's % from promotions[].
    expect(cosmetics?.promotions?.[0].percentOff).toBe(45);
    expect(Experiments.assignmentKnown()).toBe(true);
  });

  it("fetches the plain catalog for control", async () => {
    experimentsRoute = () => json(200, assignments("control"));
    Experiments.expectExperiments();
    void Experiments.loadExperiments();
    await Cosmetics.fetchCosmetics();
    expect(catalogCalls().map(([url]) => url)).toEqual([
      "https://api.test/cosmetics.json?rail=web",
    ]);
    expect(Experiments.assignmentKnown()).toBe(true);
  });

  it("doesn't wait when nothing will load the groups", async () => {
    await Cosmetics.fetchCosmetics();
    expect(catalogCalls()).toHaveLength(1);
    expect(Experiments.assignmentKnown()).toBe(false);
  });
});

describe("a group that arrives late", () => {
  for (const variant of ["control", "deeper"] as const) {
    it(`(${variant}) goes out plain, sends nothing, then refetches and exposes once`, async () => {
      let answer!: (r: Response) => void;
      experimentsRoute = () =>
        new Promise<Response>((resolve) => (answer = resolve));
      Experiments.expectExperiments();
      void Experiments.loadExperiments();
      const changed = vi.fn();
      document.addEventListener(Experiments.COSMETICS_CHANGED, changed);

      const first = Cosmetics.fetchCosmetics();
      await vi.advanceTimersByTimeAsync(Cosmetics.EXPERIMENTS_WAIT_MS);
      await first;
      expect(catalogCalls().map(([url]) => url)).toEqual([
        "https://api.test/cosmetics.json?rail=web",
      ]);
      expect(Experiments.assignmentKnown()).toBe(false);

      // The card is on screen before the group is known: no exposure, in
      // either group.
      const el = flashCard();
      Experiments.exposureWatcher.observe(el, "store_flash");
      setVisible(el, true);
      await vi.advanceTimersByTimeAsync(2000);
      expect(exposureBodies()).toEqual([]);

      // The group lands: the catalog is refetched in every group.
      answer(json(200, assignments(variant)));
      await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
      document.removeEventListener(Experiments.COSMETICS_CHANGED, changed);
      expect(catalogCalls().map(([url]) => url)).toEqual([
        "https://api.test/cosmetics.json?rail=web",
        variant === "deeper"
          ? `https://api.test/cosmetics.json?rail=web&cohort=${DEEPER}`
          : "https://api.test/cosmetics.json?rail=web",
      ]);
      const fresh = (changed.mock.calls[0][0] as CustomEvent<Cosmetics>).detail;
      expect(fresh.promotions?.[0].percentOff).toBe(
        variant === "deeper" ? 45 : 35,
      );
      expect(Experiments.assignmentKnown()).toBe(true);

      // The card already on screen now sends exactly one exposure, with the
      // group it rendered.
      await vi.advanceTimersByTimeAsync(1000);
      expect(exposureBodies()).toEqual([
        {
          platform: "web",
          exposures: [{ key: KEY, variant, surface: "store_flash" }],
        },
      ]);
      setVisible(el, false);
      setVisible(el, true);
      await vi.advanceTimersByTimeAsync(5000);
      expect(exposureBodies()).toHaveLength(1);
    });
  }
});

describe("exposures", () => {
  async function known(variant: "control" | "deeper", counted = true) {
    experimentsRoute = () => json(200, assignments(variant, counted));
    Experiments.expectExperiments();
    void Experiments.loadExperiments();
    await Cosmetics.fetchCosmetics();
    // The profile, for the publicId the exposure is remembered under.
    document.dispatchEvent(
      new CustomEvent("userMeResponse", {
        detail: { player: { publicId: "PUB1" } },
      }),
    );
  }

  it("waits for a full second half in view", async () => {
    await known("deeper");
    const el = flashCard();
    Experiments.exposureWatcher.observe(el, "store_flash");
    setVisible(el, true);
    await vi.advanceTimersByTimeAsync(999);
    setVisible(el, false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(exposureBodies()).toEqual([]);
    setVisible(el, true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(exposureBodies()).toHaveLength(1);
  });

  it("sends once per test, from either surface, and remembers it across loads", async () => {
    await known("deeper");
    const card = flashCard();
    const banner = document.createElement("div");
    banner.setAttribute("data-store-flash-banner", "");
    document.body.appendChild(banner);
    Experiments.exposureWatcher.observe(banner, "home_banner");
    Experiments.exposureWatcher.observe(card, "store_flash");
    setVisible(banner, true);
    await vi.advanceTimersByTimeAsync(1000);
    setVisible(card, true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(exposureBodies()).toEqual([
      {
        platform: "web",
        exposures: [{ key: KEY, variant: "deeper", surface: "home_banner" }],
      },
    ]);
    expect(localStorage.getItem(`experimentExposure:PUB1:${KEY}`)).toBe("1");

    // A later page load (fresh module state) doesn't send it again.
    Experiments.resetExperimentsForTest();
    await known("deeper");
    expect(await Experiments.recordExposure(KEY, "store_flash")).toBe(false);
    expect(exposureBodies()).toHaveLength(1);
  });

  it("doesn't retry a failed POST in this page load", async () => {
    await known("deeper");
    fetchMock.mockImplementationOnce(async () => json(500, {}));
    expect(await Experiments.recordExposure(KEY, "store_flash")).toBe(true);
    expect(await Experiments.recordExposure(KEY, "store_flash")).toBe(false);
    expect(localStorage.getItem(`experimentExposure:PUB1:${KEY}`)).toBeNull();
  });

  it("sends nothing for a player the test doesn't count", async () => {
    await known("deeper", false);
    const el = flashCard();
    Experiments.exposureWatcher.observe(el, "store_flash");
    setVisible(el, true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(exposureBodies()).toEqual([]);
  });

  it("sends nothing on Steam", async () => {
    Experiments.publishExperimentsForTest(
      assignments("deeper").assignments,
      DEEPER,
    );
    env.steam = true;
    expect(await Experiments.recordExposure(KEY, "store_flash")).toBe(false);
    expect(exposureBodies()).toEqual([]);
  });

  it("sends nothing until the deal is seen", async () => {
    await known("deeper");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(exposureBodies()).toEqual([]);
  });

  it("watches the homepage banner's deal line, with the group's %", async () => {
    await known("deeper");
    const banner = document.createElement("sale-banner") as HTMLElement & {
      linked: boolean;
      sales: unknown[];
      cosmetics: Cosmetics | null;
      updateComplete: Promise<boolean>;
    };
    const cosmetics = Cosmetics.getCachedCosmetics()!;
    banner.linked = true;
    banner.cosmetics = cosmetics;
    banner.sales = cosmetics.promotions!;
    document.body.appendChild(banner);
    await banner.updateComplete;
    const line = banner.querySelector("[data-store-flash-banner]")!;
    expect(line).toBeTruthy();
    expect(banner.textContent).toContain("45");
    setVisible(line, true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(exposureBodies()).toEqual([
      {
        platform: "web",
        exposures: [{ key: KEY, variant: "deeper", surface: "home_banner" }],
      },
    ]);
  });

  it("the homepage box shows a late group's % once its catalog lands", async () => {
    let answer!: (r: Response) => void;
    experimentsRoute = () =>
      new Promise<Response>((resolve) => (answer = resolve));
    Experiments.expectExperiments();
    void Experiments.loadExperiments();
    const box = document.createElement("news-box") as HTMLElement & {
      updateComplete: Promise<boolean>;
    };
    document.body.appendChild(box);
    await vi.advanceTimersByTimeAsync(Cosmetics.EXPERIMENTS_WAIT_MS);
    await vi.waitFor(() =>
      expect(box.querySelector("sale-banner")?.textContent).toContain("35"),
    );
    answer(json(200, assignments("deeper")));
    await vi.waitFor(() =>
      expect(box.querySelector("sale-banner")?.textContent).toContain("45"),
    );
    expect(box.querySelector("sale-banner")?.textContent).not.toContain("35");
  });

  it("doesn't watch the store's own (unlinked) banner", async () => {
    await known("deeper");
    const banner = document.createElement("sale-banner") as HTMLElement & {
      sales: unknown[];
      cosmetics: Cosmetics | null;
      updateComplete: Promise<boolean>;
    };
    const cosmetics = Cosmetics.getCachedCosmetics()!;
    banner.cosmetics = cosmetics;
    banner.sales = cosmetics.promotions!;
    document.body.appendChild(banner);
    await banner.updateComplete;
    const line = banner.querySelector("[data-store-flash-banner]")!;
    expect(FakeIO.instances.some((io) => io.observed.has(line))).toBe(false);
  });
});

describe("store analytics are untouched by a refetch", () => {
  it("never counts the flash card's impression twice in one page view", async () => {
    const send = vi.fn();
    const tracker = new StoreTracker({ send });
    tracker.beginPageView();
    const placement = { kind: "flash" } as const;

    let answer!: (r: Response) => void;
    experimentsRoute = () =>
      new Promise<Response>((resolve) => (answer = resolve));
    Experiments.expectExperiments();
    void Experiments.loadExperiments();
    const first = Cosmetics.fetchCosmetics();
    await vi.advanceTimersByTimeAsync(Cosmetics.EXPERIMENTS_WAIT_MS);
    await first;

    const card = flashCard();
    tracker.observe(card, "flag:skull_candle", placement);
    Experiments.exposureWatcher.observe(card, "store_flash");
    setVisible(card, true);
    await vi.advanceTimersByTimeAsync(1000);
    tracker.click("flag:skull_candle", placement);

    // The late group's refetch, and then the 60 s stale refetch.
    answer(json(200, assignments("deeper")));
    await vi.waitFor(() => expect(catalogCalls()).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      Cosmetics.refreshStaleCosmetics(
        Date.now() + Cosmetics.COSMETICS_STALE_MS + 1,
      ),
    ).toBe(true);
    await Cosmetics.reloadCosmetics();
    expect(catalogCalls()).toHaveLength(3);
    // Re-rendered and re-reported in view, as the store does after each.
    tracker.observe(card, "flag:skull_candle", placement);
    setVisible(card, false);
    setVisible(card, true);
    await vi.advanceTimersByTimeAsync(1000);
    tracker.click("flag:skull_candle", placement);

    tracker.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({
      platform: "web",
      events: [
        { type: "impression", item: "flag:skull_candle", placement },
        { type: "click", item: "flag:skull_candle", placement },
      ],
    });
    // The exposure went once, on its own trigger.
    expect(exposureBodies()).toHaveLength(1);
    tracker.dispose();
  });
});

describe("purchases", () => {
  const skull = {
    type: "flag",
    cosmetic: catalog(45).flags!.skull_candle,
    colorPalette: null,
    relationship: "purchasable",
    key: "flag:skull_candle",
  } as unknown as import("../../src/client/Cosmetics").ResolvedCosmetic;
  beforeEach(() => {
    vi.mocked(getUserMe).mockResolvedValue({
      player: { currency: { hard: 500, soft: 0 }, flares: [] },
    } as never);
    vi.mocked(invalidateUserMe).mockClear();
  });

  const purchaseBodies = () =>
    calls("/shop/purchase").map(([, init]) => JSON.parse(String(init!.body)));

  it("sends the price shown and the platform", async () => {
    await Cosmetics.purchaseCosmetic(skull, "hard");
    expect(purchaseBodies()).toEqual([
      expect.objectContaining({
        cosmeticType: "flag",
        cosmeticName: "skull_candle",
        currencyType: "hard",
        expectedAmount: 44,
        platform: "web",
      }),
    ]);
    // Bought: the profile is refreshed (and the page reloads).
    expect(invalidateUserMe).toHaveBeenCalled();
  });

  it("sends platform steam from the Steam build", async () => {
    env.steam = true;
    await Cosmetics.purchaseCosmetic(skull, "hard");
    expect(purchaseBodies()[0]).toMatchObject({
      expectedAmount: 44,
      platform: "steam",
    });
  });

  it("sends the price shown for a bundle", async () => {
    purchaseRoute = () =>
      json(200, {
        packName: "starter",
        currencyType: "hard",
        amount: "250",
        flareNames: [],
      });
    const pack = {
      type: "cosmeticPack",
      cosmetic: {
        name: "starter",
        displayName: "Starter",
        priceHard: 250,
        items: [],
      },
      colorPalette: null,
      relationship: "purchasable",
      key: "pack:starter",
    } as unknown as import("../../src/client/Cosmetics").ResolvedCosmetic;
    await Cosmetics.purchaseCosmetic(pack, "hard");
    expect(calls("/shop/purchase/pack")).toHaveLength(1);
    expect(purchaseBodies()[0]).toMatchObject({
      packName: "starter",
      expectedAmount: 250,
      platform: "web",
    });
  });

  for (const path of ["/shop/purchase", "/shop/purchase/pack"]) {
    it(`on a 409 price_changed from ${path}: says so, refetches, charges nothing`, async () => {
      purchaseRoute = () =>
        json(409, {
          error: "Conflict",
          reason: "price_changed",
          amount: "52",
        });
      const pack = {
        type: "cosmeticPack",
        cosmetic: { name: "p", displayName: "P", priceHard: 44, items: [] },
        colorPalette: null,
        relationship: "purchasable",
        key: "pack:p",
      } as unknown as import("../../src/client/Cosmetics").ResolvedCosmetic;
      const changed = vi.fn();
      document.addEventListener(Experiments.COSMETICS_CHANGED, changed);

      await Cosmetics.purchaseCosmetic(
        path.endsWith("pack") ? pack : skull,
        "hard",
      );
      document.removeEventListener(Experiments.COSMETICS_CHANGED, changed);

      expect(showInGameAlert).toHaveBeenCalledTimes(1);
      expect(showInGameAlert).toHaveBeenCalledWith("PRICE CHANGED");
      // The store and banner get the catalog as it is now.
      expect(catalogCalls()).toHaveLength(1);
      expect(changed).toHaveBeenCalledTimes(1);
      // No success: no profile refresh or reload, and one request.
      expect(invalidateUserMe).not.toHaveBeenCalled();
      expect(calls("/shop/purchase")).toHaveLength(1);
    });
  }

  it("still buys when the experiments endpoint fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    experimentsRoute = () => json(503, {});
    Experiments.expectExperiments();
    await Experiments.loadExperiments();
    await Cosmetics.purchaseCosmetic(skull, "hard");
    expect(purchaseBodies()).toHaveLength(1);
    // Bought: the profile is refreshed (and the page reloads).
    expect(invalidateUserMe).toHaveBeenCalled();
  });
});
