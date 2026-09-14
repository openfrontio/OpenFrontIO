import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiMockFactory,
  authMockFactory,
  flushAsync,
  utilsMockFactory,
} from "./ClanModalTestUtils";

// ─── Mocks (defined before imports so vi.mock hoisting applies) ─────────────

vi.mock("../../../src/client/Api", () => apiMockFactory());
vi.mock("../../../src/client/Auth", () => authMockFactory());
vi.mock("../../../src/client/Utils", () => utilsMockFactory());
vi.mock("../../../src/client/ClanApi", () => ({
  fetchClanDonations: vi.fn(async () => ({
    results: [],
    total: 0,
    page: 1,
    limit: 10,
  })),
}));

// ─── Imports under test ──────────────────────────────────────────────────────

import type {
  ClanDonation,
  ClanDonationsResponse,
} from "../../../src/client/ClanApi";
import { fetchClanDonations } from "../../../src/client/ClanApi";
import { ClanDonationsView } from "../../../src/client/components/clan/ClanDonationsView";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeDonation(overrides: Partial<ClanDonation> = {}): ClanDonation {
  return {
    id: "1834",
    currencyType: "soft",
    amount: "500",
    reason: "clan_donation",
    note: null,
    createdBy: "donor-1",
    createdByUsername: "alice.0042",
    createdAt: "2024-06-01T12:00:00.000Z",
    ...overrides,
  };
}

const okPage = (
  results: ClanDonation[],
  total = results.length,
  page = 1,
  limit = 10,
): ClanDonationsResponse => ({ results, total, page, limit });

const mockFetch = (impl: () => Promise<unknown>) => {
  (fetchClanDonations as ReturnType<typeof vi.fn>).mockImplementationOnce(impl);
};

async function mountView() {
  if (!customElements.get("clan-donations-view")) {
    customElements.define("clan-donations-view", ClanDonationsView);
  }
  const el = document.createElement("clan-donations-view") as ClanDonationsView;
  el.clanTag = "TST";
  document.body.appendChild(el);
  await flushAsync(el);
  return el;
}

function buttonWithText(el: Element, text: string): HTMLButtonElement {
  const btn = Array.from(el.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text),
  );
  if (!btn) throw new Error(`no button containing "${text}"`);
  return btn;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ClanDonationsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetchClanDonations as ReturnType<typeof vi.fn>).mockResolvedValue(
      okPage([]),
    );
  });

  afterEach(() => {
    document.querySelectorAll("clan-donations-view").forEach((el) => {
      el.remove();
    });
  });

  it("fetches the first page of both currencies on mount", async () => {
    await mountView();

    expect(fetchClanDonations).toHaveBeenCalledOnce();
    expect(fetchClanDonations).toHaveBeenCalledWith("TST", {
      page: 1,
      limit: 10,
      currencyType: undefined,
    });
  });

  it("shows the empty state when there are no donations", async () => {
    const el = await mountView();

    expect(el.textContent).toContain("clan_modal.donations_empty");
    expect(el.querySelector("[data-donation-id]")).toBeNull();
  });

  it("renders each donation with its donor and amount", async () => {
    mockFetch(() =>
      Promise.resolve(
        okPage([
          makeDonation({ id: "1", amount: "5000", currencyType: "soft" }),
          makeDonation({
            id: "2",
            amount: "5",
            currencyType: "hard",
            createdBy: "donor-2",
            createdByUsername: "bob.0001",
          }),
        ]),
      ),
    );
    const el = await mountView();

    const rows = el.querySelectorAll("[data-donation-id]");
    expect(rows).toHaveLength(2);
    // <player-name> splits "name.discriminator" into "name #discriminator".
    expect(rows[0].textContent).toContain("alice");
    expect(rows[0].textContent).toContain("#0042");
    expect(rows[0].textContent).toContain(BigInt(5000).toLocaleString());
    expect(rows[1].textContent).toContain("bob");
    expect(rows[1].textContent).toContain("#0001");
    expect(rows[1].textContent).toContain("5");
    // Plutonium on the hard row only, caps on the soft row only.
    expect(rows[0].querySelector("cap-icon")).not.toBeNull();
    expect(rows[0].querySelector("plutonium-icon")).toBeNull();
    expect(rows[1].querySelector("plutonium-icon")).not.toBeNull();
    expect(rows[1].querySelector("cap-icon")).toBeNull();
  });

  it("labels a donor whose account was deleted instead of linking them", async () => {
    mockFetch(() =>
      Promise.resolve(
        okPage([makeDonation({ createdBy: null, createdByUsername: null })]),
      ),
    );
    const el = await mountView();

    const row = el.querySelector("[data-donation-id]")!;
    expect(row.textContent).toContain("clan_modal.donations_deleted_player");
    expect(row.querySelector("player-name")).toBeNull();
  });

  it("raises view-profile with the donor's public ID when their name is clicked", async () => {
    mockFetch(() => Promise.resolve(okPage([makeDonation()])));
    const el = await mountView();
    const seen: string[] = [];
    el.addEventListener("view-profile", (e) => {
      seen.push((e as CustomEvent<{ publicId: string }>).detail.publicId);
    });

    const nameButton = el.querySelector<HTMLButtonElement>(
      "[data-donation-id] player-name button",
    );
    expect(nameButton).not.toBeNull();
    nameButton!.click();

    expect(seen).toEqual(["donor-1"]);
  });

  it("shows the members-only notice on 403 and hides the filters", async () => {
    mockFetch(() => Promise.resolve({ error: "forbidden" }));
    const el = await mountView();

    expect(el.textContent).toContain("clan_modal.donations_members_only");
    expect(el.querySelector("[role=tablist]")).toBeNull();
  });

  it("offers a retry when the load fails", async () => {
    mockFetch(() => Promise.resolve({ error: "failed" }));
    const el = await mountView();
    expect(el.textContent).toContain("clan_modal.donations_unavailable");

    mockFetch(() => Promise.resolve(okPage([makeDonation()])));
    buttonWithText(el, "leaderboard_modal.try_again").click();
    await flushAsync(el);

    expect(fetchClanDonations).toHaveBeenCalledTimes(2);
    expect(el.querySelectorAll("[data-donation-id]")).toHaveLength(1);
  });

  it("refetches with the chosen currency and resets to page 1", async () => {
    // 30 rows so the pagination controls render.
    mockFetch(() => Promise.resolve(okPage([makeDonation()], 30)));
    const el = await mountView();

    mockFetch(() => Promise.resolve(okPage([makeDonation()], 30, 2)));
    buttonWithText(el, ">").click();
    await flushAsync(el);
    expect(fetchClanDonations).toHaveBeenLastCalledWith("TST", {
      page: 2,
      limit: 10,
      currencyType: undefined,
    });

    mockFetch(() => Promise.resolve(okPage([makeDonation()], 3)));
    el.querySelector<HTMLButtonElement>("[data-currency-filter=hard]")!.click();
    await flushAsync(el);

    expect(fetchClanDonations).toHaveBeenLastCalledWith("TST", {
      page: 1,
      limit: 10,
      currencyType: "hard",
    });
  });

  it("does not render pagination when everything fits on one page", async () => {
    mockFetch(() => Promise.resolve(okPage([makeDonation()], 3)));
    const el = await mountView();

    expect(el.textContent).not.toContain("clan_modal.per_page");
  });
});
