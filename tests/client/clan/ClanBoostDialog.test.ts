import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchClanBoostStatus = vi.fn();
const buyClanBoost = vi.fn();

vi.mock("../../../src/client/ClanApi", () => ({
  fetchClanBoostStatus: (...args: unknown[]) => fetchClanBoostStatus(...args),
  buyClanBoost: (...args: unknown[]) => buyClanBoost(...args),
}));
vi.mock("../../../src/client/Utils", () => ({
  translateText: vi.fn(
    (key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  ),
}));

import "../../../src/client/components/clan/ClanBoostDialog";
import type { ClanBoostDialog } from "../../../src/client/components/clan/ClanBoostDialog";

const HOUR = 3_600_000;

const status = (overrides: Record<string, unknown> = {}) => ({
  tiers: [
    {
      tier: "spark",
      currency: "soft",
      price: "250",
      durationMs: HOUR,
      weight: 1,
    },
    {
      tier: "surge",
      currency: "soft",
      price: "1200",
      durationMs: 6 * HOUR,
      weight: 1,
    },
  ],
  boostEndsAt: null,
  eligibility: {
    eligible: true,
    memberCount: 3,
    minMembers: 3,
    recentlyActive: true,
  },
  softLimit: { usedMs: 0, capMs: 12 * HOUR, windowMs: 24 * HOUR },
  softBalance: "5000",
  hardBalance: "0",
  ...overrides,
});

const flush = async (
  el: HTMLElement & { updateComplete: Promise<boolean> },
) => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};

const q = <T extends Element>(sel: string) => document.querySelector<T>(sel);
const buyButton = () =>
  q<HTMLButtonElement>('button[data-action="buy-boost"]')!;
const tierButton = (tier: string) =>
  q<HTMLButtonElement>(`button[data-tier="${tier}"]`)!;
const alertText = () => q('[role="alert"]')?.textContent?.trim() ?? null;

describe("clan-boost-dialog", () => {
  let dialog: ClanBoostDialog;

  async function open(s: unknown = status()) {
    fetchClanBoostStatus.mockResolvedValue(s);
    dialog = document.createElement("clan-boost-dialog") as ClanBoostDialog;
    dialog.clanTag = "TST";
    document.body.appendChild(dialog);
    await flush(dialog);
  }

  beforeEach(() => {
    fetchClanBoostStatus.mockReset();
    buyClanBoost.mockReset();
  });

  afterEach(() => {
    dialog?.remove();
  });

  it("lists the tiers from the API, first selected, with the clan balance", async () => {
    await open();
    expect(fetchClanBoostStatus).toHaveBeenCalledWith("TST");
    expect(tierButton("spark").getAttribute("aria-checked")).toBe("true");
    expect(tierButton("surge").getAttribute("aria-checked")).toBe("false");
    expect(tierButton("surge").textContent).toContain(
      "clan_modal.boost_tier_surge",
    );
    expect(tierButton("surge").textContent).toContain((1200).toLocaleString());
    expect(q("[data-clan-balance]")!.textContent).toContain(
      (5000).toLocaleString(),
    );
    expect(document.body.textContent).toContain("clan_modal.boost_final");
    expect(buyButton().disabled).toBe(false);
  });

  it("buys the selected tier and emits boosted", async () => {
    await open();
    buyClanBoost.mockResolvedValue({ endsAt: "2026-10-06T18:00:00.000Z" });
    const boosted = vi.fn();
    dialog.addEventListener("boosted", (e) =>
      boosted((e as CustomEvent).detail),
    );
    tierButton("surge").click();
    await flush(dialog);
    buyButton().click();
    await flush(dialog);

    expect(buyClanBoost).toHaveBeenCalledTimes(1);
    const [tag, tier, key] = buyClanBoost.mock.calls[0];
    expect([tag, tier]).toEqual(["TST", "surge"]);
    expect(typeof key).toBe("string");
    expect(boosted).toHaveBeenCalledWith({
      endsAt: "2026-10-06T18:00:00.000Z",
    });
  });

  it("reuses one idempotency key for retries from the same dialog", async () => {
    await open();
    buyClanBoost.mockResolvedValue({ error: "clan_modal.error_network" });
    buyButton().click();
    await flush(dialog);
    buyButton().click();
    await flush(dialog);
    expect(buyClanBoost).toHaveBeenCalledTimes(2);
    expect(buyClanBoost.mock.calls[0][2]).toBe(buyClanBoost.mock.calls[1][2]);
  });

  it("locks the tier after a network failure, so the retry is the same purchase", async () => {
    await open();
    buyClanBoost.mockResolvedValue({ error: "clan_modal.error_network" });
    buyButton().click();
    await flush(dialog);

    expect(tierButton("surge").disabled).toBe(true);
    tierButton("surge").click();
    await flush(dialog);
    expect(tierButton("spark").getAttribute("aria-checked")).toBe("true");

    buyButton().click();
    await flush(dialog);
    expect(buyClanBoost.mock.calls.map((c) => c[1])).toEqual([
      "spark",
      "spark",
    ]);
  });

  it("a refusal with an answer leaves the tier free to change", async () => {
    await open();
    buyClanBoost.mockResolvedValue({
      error: "clan_modal.boost_error_daily_limit",
    });
    buyButton().click();
    await flush(dialog);
    expect(tierButton("surge").disabled).toBe(false);
  });

  it("is a labelled radio group the arrow keys move through", async () => {
    await open();
    const group = q('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-label")).toBe(
      "clan_modal.boost_tier_label",
    );
    expect(tierButton("spark").tabIndex).toBe(0);
    expect(tierButton("surge").tabIndex).toBe(-1);

    tierButton("spark").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    await flush(dialog);
    expect(tierButton("surge").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(tierButton("surge"));

    tierButton("surge").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    await flush(dialog);
    expect(tierButton("spark").getAttribute("aria-checked")).toBe("true");
  });

  it("shows the server's refusal", async () => {
    await open();
    buyClanBoost.mockResolvedValue({
      error: "clan_modal.boost_error_daily_limit",
    });
    buyButton().click();
    await flush(dialog);
    expect(alertText()).toContain("clan_modal.boost_error_daily_limit");
  });

  it.each([
    [
      "too few members",
      {
        eligibility: {
          eligible: false,
          memberCount: 2,
          minMembers: 3,
          recentlyActive: true,
        },
      },
      "clan_modal.boost_error_not_enough_members",
    ],
    [
      "no recent games",
      {
        eligibility: {
          eligible: false,
          memberCount: 5,
          minMembers: 3,
          recentlyActive: false,
        },
      },
      "clan_modal.boost_error_not_recently_active",
    ],
    [
      "the caps limit",
      { softLimit: { usedMs: 12 * HOUR, capMs: 12 * HOUR, windowMs: 1 } },
      "clan_modal.boost_error_daily_limit",
    ],
    [
      "the clan balance",
      { softBalance: "10" },
      "clan_modal.boost_error_insufficient_balance",
    ],
  ])("explains and blocks on %s", async (_name, overrides, key) => {
    await open(status(overrides));
    expect(alertText()).toContain(key);
    expect(buyButton().disabled).toBe(true);
    buyButton().click();
    await flush(dialog);
    expect(buyClanBoost).not.toHaveBeenCalled();
  });

  it("only blocks the tier that does not fit the caps limit", async () => {
    await open(
      status({
        softLimit: { usedMs: 8 * HOUR, capMs: 12 * HOUR, windowMs: 1 },
      }),
    );
    expect(buyButton().disabled).toBe(false);
    tierButton("surge").click();
    await flush(dialog);
    expect(buyButton().disabled).toBe(true);
    expect(alertText()).toContain("clan_modal.boost_error_daily_limit");
  });

  it("says how long a running boost has left", async () => {
    await open(
      status({ boostEndsAt: new Date(Date.now() + 90 * 60_000).toISOString() }),
    );
    expect(document.body.textContent).toContain("clan_modal.boost_running");
  });

  it("shows a failure when the status cannot load", async () => {
    await open(false);
    expect(alertText()).toContain("clan_modal.boost_error_failed");
    expect(buyButton().disabled).toBe(true);
  });

  it("is a labelled modal dialog, focused on the selected tier once loaded", async () => {
    await open();
    const box = q('[role="dialog"]')!;
    expect(box.getAttribute("aria-modal")).toBe("true");
    expect(
      document.getElementById(box.getAttribute("aria-labelledby")!)!
        .textContent,
    ).toContain("clan_modal.boost_title");
    expect(document.activeElement).toBe(tierButton("spark"));
  });

  it("Escape cancels the dialog only, not the clan modal underneath", async () => {
    const underneath = vi.fn();
    window.addEventListener("keydown", underneath);
    try {
      await open();
      const cancel = vi.fn();
      dialog.addEventListener("cancel", cancel);
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(underneath).not.toHaveBeenCalled();

      // Other keys pass through untouched.
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", bubbles: true }),
      );
      expect(underneath).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", underneath);
    }
  });

  it("stops listening for Escape once detached", async () => {
    await open();
    const cancel = vi.fn();
    dialog.addEventListener("cancel", cancel);
    dialog.remove();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(cancel).not.toHaveBeenCalled();
  });

  it("gives focus back to what opened it", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    await open();
    expect(document.activeElement).not.toBe(opener);
    dialog.remove();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("shows Plutonium tiers in days, with the real-money note", async () => {
    await open(
      status({
        tiers: [
          {
            tier: "headline",
            currency: "hard",
            price: "300",
            durationMs: 7 * 24 * HOUR,
            weight: 3,
          },
        ],
        hardBalance: "500",
      }),
    );
    expect(tierButton("headline").textContent).toContain(
      'clan_modal.boost_days:{"days":7}',
    );
    expect(document.body.textContent).toContain("clan_modal.boost_final_hard");
    expect(q("[data-clan-balance]")!.textContent).toContain("cosmetics.hard");
    expect(buyButton().disabled).toBe(false);
  });

  it("blocks a Plutonium tier the clan can't afford", async () => {
    await open(
      status({
        tiers: [
          {
            tier: "sponsor",
            currency: "hard",
            price: "80",
            durationMs: 24 * HOUR,
            weight: 3,
          },
        ],
        hardBalance: "79",
      }),
    );
    expect(alertText()).toContain(
      "clan_modal.boost_error_insufficient_balance",
    );
    expect(buyButton().disabled).toBe(true);
  });

  it("leaves the real-money note off caps tiers", async () => {
    await open();
    expect(document.body.textContent).not.toContain(
      "clan_modal.boost_final_hard",
    );
  });

  it("cancel emits cancel and removes the overlay on detach", async () => {
    await open();
    const cancel = vi.fn();
    dialog.addEventListener("cancel", cancel);
    Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((b) => b.textContent?.trim() === "common.cancel")!
      .click();
    expect(cancel).toHaveBeenCalled();
    dialog.remove();
    expect(q('button[data-action="buy-boost"]')).toBeNull();
  });
});
