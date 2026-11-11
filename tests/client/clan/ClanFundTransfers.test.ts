import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiMockFactory,
  authMockFactory,
  flushAsync,
  utilsMockFactory,
} from "./ClanModalTestUtils";

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
  fetchClanDonationLeaderboard: vi.fn(async () => ({
    results: [],
    total: 0,
    page: 1,
    limit: 10,
  })),
  fetchClanFundTransfers: vi.fn(),
  fetchClanFundRecipients: vi.fn(),
  fetchClanMembers: vi.fn(async () => ({
    results: [
      {
        role: "leader",
        joinedAt: "2024-01-01T00:00:00.000Z",
        publicId: "test-player",
        username: "me",
      },
      {
        role: "member",
        joinedAt: "2024-01-01T00:00:00.000Z",
        publicId: "member-2",
        username: "bob.0001",
      },
      {
        role: "member",
        joinedAt: "2024-01-01T00:00:00.000Z",
        publicId: "member-3",
        username: "newbie.0002",
      },
    ],
    total: 3,
    page: 1,
    limit: 10,
  })),
  sendClanFunds: vi.fn(async () => true),
}));

import type {
  ClanFundRecipient,
  ClanFundTransfer,
  ClanFundTransfersResponse,
  ClanFundTransferStatus,
} from "../../../src/client/ClanApi";
import {
  fetchClanFundRecipients,
  fetchClanFundTransfers,
  fetchClanMembers,
  sendClanFunds,
} from "../../../src/client/ClanApi";
import { ClanDonationsView } from "../../../src/client/components/clan/ClanDonationsView";
import { ClanFundCard } from "../../../src/client/components/clan/ClanFundCard";
import { ClanSendFundsView } from "../../../src/client/components/clan/ClanSendFundsView";

const fetchTransfers = fetchClanFundTransfers as ReturnType<typeof vi.fn>;
const fetchRecipients = fetchClanFundRecipients as ReturnType<typeof vi.fn>;
const send = sendClanFunds as ReturnType<typeof vi.fn>;

function status(
  overrides: Partial<ClanFundTransferStatus> = {},
): ClanFundTransferStatus {
  return {
    enabled: true,
    frozen: false,
    canSend: true,
    hardBalance: "5000",
    clanDailyCap: "5000",
    clanSentToday: "1000",
    capResetsAt: null,
    recipientDailyCap: "2000",
    minMembershipDays: 7,
    ...overrides,
  };
}

function transfer(overrides: Partial<ClanFundTransfer> = {}): ClanFundTransfer {
  return {
    id: "41",
    kind: "transfer",
    amount: "250",
    sender: "test-player",
    senderUsername: "me",
    recipient: "member-2",
    recipientUsername: "bob.0001",
    createdAt: "2026-11-01T12:00:00.000Z",
    reversedAt: null,
    reversesId: null,
    reversesCreatedAt: null,
    ...overrides,
  };
}

const page = (
  results: ClanFundTransfer[],
  s: ClanFundTransferStatus = status(),
): ClanFundTransfersResponse => ({
  results,
  total: results.length,
  page: 1,
  limit: 10,
  status: s,
});

function recipient(
  publicId: string,
  overrides: Partial<ClanFundRecipient> = {},
): ClanFundRecipient {
  return {
    publicId,
    eligible: true,
    reason: null,
    eligibleAt: null,
    leftToday: "2000",
    ...overrides,
  };
}

function define(tag: string, ctor: CustomElementConstructor) {
  if (!customElements.get(tag)) customElements.define(tag, ctor);
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("Payouts log (Donations tab)", () => {
  async function mount(initialMode?: "payouts") {
    define("clan-donations-view", ClanDonationsView);
    const el = document.createElement(
      "clan-donations-view",
    ) as ClanDonationsView;
    el.clanTag = "TST";
    if (initialMode) el.initialMode = initialMode;
    document.body.appendChild(el);
    await flushAsync(el);
    return el;
  }
  const tab = (el: Element) =>
    el.querySelector<HTMLButtonElement>("[data-tabs=mode] [data-tab=payouts]");

  it("hides the tab when the API doesn't offer payouts", async () => {
    fetchTransfers.mockResolvedValue({ error: "unavailable" });
    const el = await mount();
    expect(tab(el)).toBeNull();
  });

  it("opens straight on Payouts from Manage, with no send button", async () => {
    fetchTransfers.mockResolvedValue(
      page([
        transfer({
          id: "42",
          kind: "reversal",
          sender: null,
          senderUsername: null,
          reversesId: "41",
          reversesCreatedAt: "2026-11-01T12:00:00.000Z",
        }),
        transfer({ reversedAt: "2026-11-02T09:00:00.000Z" }),
      ]),
    );
    const el = await mount("payouts");
    expect(tab(el)?.getAttribute("aria-selected")).toBe("true");
    expect(el.querySelector("[data-action=open-send-funds]")).toBeNull();

    const rows = el.querySelectorAll("[data-transfer-id]");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("clan_modal.payout_reversal");
    expect(rows[0].textContent).toContain("clan_modal.payout_original");
    expect(rows[0].textContent).toContain("+");
    // The reversed send keeps its row, marked and struck through.
    expect(rows[1].hasAttribute("data-reversed")).toBe(true);
    expect(rows[1].textContent).toContain("clan_modal.payout_reversed");
    expect(rows[1].textContent).toContain("−");
    expect(rows[1].querySelector(".line-through")).not.toBeNull();
  });

  it("shows a banner while staff have paused the fund", async () => {
    fetchTransfers.mockResolvedValue(
      page([transfer()], status({ frozen: true, canSend: false })),
    );
    const el = await mount("payouts");
    expect(el.querySelector("[data-payouts-frozen]")?.textContent).toContain(
      "clan_modal.clan_fund_frozen",
    );
  });
});

describe("Clan fund card (Manage)", () => {
  async function mount(role: "leader" | "officer", s = status()) {
    fetchTransfers.mockResolvedValue(page([transfer()], s));
    define("clan-fund-card", ClanFundCard);
    const el = document.createElement("clan-fund-card") as ClanFundCard;
    el.clanTag = "TST";
    el.myRole = role;
    document.body.appendChild(el);
    await flushAsync(el);
    return el;
  }

  it("shows the balance, today's use and recent payouts", async () => {
    const el = await mount("leader");
    expect(el.querySelector("[data-fund-balance]")?.textContent).toContain(
      "5,000",
    );
    expect(el.querySelector("[data-sent-today]")?.textContent).toContain(
      "1,000",
    );
    expect(el.querySelectorAll("[data-transfer-id]")).toHaveLength(1);
  });

  it("gives the leader Send, and officers a note instead", async () => {
    const leader = await mount("leader");
    const sendBtn = leader.querySelector<HTMLButtonElement>(
      "[data-action=open-send-funds]",
    )!;
    expect(sendBtn.disabled).toBe(false);
    const navigated = vi.fn();
    leader.addEventListener("navigate-send-funds", navigated);
    sendBtn.click();
    expect(navigated).toHaveBeenCalledTimes(1);
    document.body.innerHTML = "";

    const officer = await mount("officer");
    expect(officer.querySelector("[data-action=open-send-funds]")).toBeNull();
    expect(officer.textContent).toContain("clan_modal.clan_fund_officer_note");
  });

  it("explains and disables sending when the daily limit is used", async () => {
    const el = await mount(
      "leader",
      status({
        clanSentToday: "5000",
        capResetsAt: new Date(Date.now() + 2.5 * 3_600_000).toISOString(),
      }),
    );
    expect(el.querySelector("[data-fund-notice]")?.textContent).toContain(
      "clan_modal.clan_fund_cap_reached",
    );
    expect(
      el.querySelector<HTMLButtonElement>("[data-action=open-send-funds]")!
        .disabled,
    ).toBe(true);
  });

  it("reloads when the daily limit frees up, re-enabling Send", async () => {
    const el = await mount(
      "leader",
      status({
        clanSentToday: "5000",
        // Already passed: the card reloads after its one-second grace.
        capResetsAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    );
    const sendBtn = () =>
      el.querySelector<HTMLButtonElement>("[data-action=open-send-funds]")!;
    expect(sendBtn().disabled).toBe(true);

    fetchTransfers.mockResolvedValue(page([transfer()], status()));
    await new Promise((r) => setTimeout(r, 1_100));
    await flushAsync(el);
    expect(sendBtn().disabled).toBe(false);
  });

  it("doesn't schedule a reload when there's allowance left", async () => {
    const el = await mount("leader");
    expect((el as unknown as { capTimer: unknown }).capTimer).toBeNull();
  });

  it("links to the full log", async () => {
    const el = await mount("officer");
    const navigated = vi.fn();
    el.addEventListener("navigate-payouts", navigated);
    el.querySelector<HTMLButtonElement>("[data-action=view-payouts]")!.click();
    expect(navigated).toHaveBeenCalledTimes(1);
  });
});

describe("Send Plutonium page", () => {
  async function mount(
    eligibility: ClanFundRecipient[] | false = [
      recipient("member-2", { leftToday: "1600" }),
      recipient("member-3", {
        eligible: false,
        reason: "too_recent",
        eligibleAt: new Date(Date.now() + 2.5 * 86_400_000).toISOString(),
      }),
    ],
    statusResponse: ClanFundTransfersResponse | { error: string } = page(
      [],
      status(),
    ),
  ) {
    fetchTransfers.mockResolvedValue(statusResponse);
    fetchRecipients.mockResolvedValue(eligibility);
    define("clan-send-funds-view", ClanSendFundsView);
    const el = document.createElement(
      "clan-send-funds-view",
    ) as ClanSendFundsView;
    el.clanTag = "TST";
    el.myPublicId = "test-player";
    document.body.appendChild(el);
    await flushAsync(el);
    await flushAsync(el);
    return el;
  }

  const sendButton = (el: Element) =>
    el.querySelector<HTMLButtonElement>("[data-action=send]")!;
  const pick = (el: Element, id: string) =>
    el
      .querySelector<HTMLButtonElement>(
        `[data-member="${id}"] button[role=radio]`,
      )!
      .click();
  function typeAmount(el: Element, value: string) {
    const input = el.querySelector<HTMLInputElement>(
      "#clan-send-funds-amount",
    )!;
    input.value = value;
    input.dispatchEvent(new Event("input"));
  }

  it("lists members without the leader, and greys out ineligible ones", async () => {
    const el = await mount();
    const rows = Array.from(el.querySelectorAll("[data-member]"));
    expect(rows.map((r) => r.getAttribute("data-member"))).toEqual([
      "member-2",
      "member-3",
    ]);
    expect(rows[1].hasAttribute("data-ineligible")).toBe(true);
    expect(rows[1].textContent).toContain(
      "clan_modal.send_funds_reason_too_recent",
    );
    pick(el, "member-3");
    await flushAsync(el);
    expect(
      el.querySelector('[data-member="member-3"] [aria-checked=true]'),
    ).toBeNull();
  });

  it("caps Max at the member's limit left today", async () => {
    const el = await mount();
    pick(el, "member-2");
    await flushAsync(el);
    el.querySelector<HTMLButtonElement>("[data-quick=max]")!.click();
    await flushAsync(el);
    expect(
      el.querySelector<HTMLInputElement>("#clan-send-funds-amount")!.value,
    ).toBe("1600");
    typeAmount(el, "1601");
    await flushAsync(el);
    expect(sendButton(el).disabled).toBe(true);
    expect(el.textContent).toContain("clan_modal.send_funds_over_max");
  });

  it("confirms before sending, and Enter doesn't send", async () => {
    const el = await mount();
    const sent = vi.fn();
    el.addEventListener("funds-sent", sent);
    expect(sendButton(el).disabled).toBe(true);
    pick(el, "member-2");
    typeAmount(el, "300");
    await flushAsync(el);

    el.querySelector<HTMLInputElement>(
      "#clan-send-funds-amount",
    )!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await flushAsync(el);
    expect(send).not.toHaveBeenCalled();

    expect(sendButton(el).textContent).toContain(
      "clan_modal.send_funds_send_to",
    );
    sendButton(el).click();
    await flushAsync(el);
    expect(send).not.toHaveBeenCalled();
    const dialog = el.querySelector("confirm-dialog")!;
    expect(dialog).not.toBeNull();
    dialog.dispatchEvent(new CustomEvent("confirm"));
    await flushAsync(el);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0].slice(0, 3)).toEqual(["TST", "member-2", "300"]);
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("can't send until the clan fund status loads, and offers a retry", async () => {
    const el = await mount(undefined, { error: "failed" });
    pick(el, "member-2");
    typeAmount(el, "10");
    await flushAsync(el);
    expect(
      el.querySelector('[data-load-error="status"]')?.textContent,
    ).toContain("clan_modal.clan_fund_load_failed");
    expect(sendButton(el).disabled).toBe(true);

    fetchTransfers.mockResolvedValue(page([], status()));
    el.querySelector<HTMLButtonElement>(
      '[data-load-error="status"] [data-action=retry]',
    )!.click();
    await flushAsync(el);
    expect(el.querySelector('[data-load-error="status"]')).toBeNull();
    expect(sendButton(el).disabled).toBe(false);
  });

  it("can't send when the status says this leader can't", async () => {
    for (const s of [status({ canSend: false }), status({ enabled: false })]) {
      const el = await mount(undefined, page([], s));
      pick(el, "member-2");
      typeAmount(el, "10");
      await flushAsync(el);
      expect(sendButton(el).disabled).toBe(true);
      el.remove();
    }
  });

  it("shows a member-load failure with Retry instead of 'no members'", async () => {
    vi.mocked(fetchClanMembers).mockResolvedValueOnce(false);
    const el = await mount();
    const box = el.querySelector('[data-load-error="members"]');
    expect(box?.textContent).toContain("clan_modal.send_funds_members_failed");
    expect(el.textContent).not.toContain("clan_modal.send_funds_no_members");

    box!.querySelector<HTMLButtonElement>("[data-action=retry]")!.click();
    await flushAsync(el);
    await flushAsync(el);
    expect(el.querySelector('[data-load-error="members"]')).toBeNull();
    expect(el.querySelectorAll("[data-member]")).toHaveLength(2);
  });

  it("keeps the picked member's limit after the list reloads", async () => {
    const el = await mount();
    pick(el, "member-2");
    await flushAsync(el);
    // A search whose eligibility no longer includes the picked member.
    fetchRecipients.mockResolvedValueOnce([recipient("member-3")]);
    await (
      el as unknown as { loadMembers(p: number, s: string): Promise<void> }
    ).loadMembers(1, "new");
    await flushAsync(el);
    el.querySelector<HTMLButtonElement>("[data-quick=max]")!.click();
    await flushAsync(el);
    expect(
      el.querySelector<HTMLInputElement>("#clan-send-funds-amount")!.value,
    ).toBe("1600");
  });

  it("falls back to letting the server decide when eligibility fails", async () => {
    send.mockResolvedValueOnce({
      error: "clan_modal.send_funds_error_not_eligible",
    });
    const el = await mount(false);
    expect(el.querySelectorAll("[data-ineligible]")).toHaveLength(0);
    pick(el, "member-3");
    typeAmount(el, "10");
    await flushAsync(el);
    sendButton(el).click();
    await flushAsync(el);
    el.querySelector("confirm-dialog")!.dispatchEvent(
      new CustomEvent("confirm"),
    );
    await flushAsync(el);
    expect(el.querySelector("[role=alert]")?.textContent).toContain(
      "clan_modal.send_funds_error_not_eligible",
    );
  });
});
