import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import { ClanWinCard } from "../../src/client/components/card/ClanWinCard";

if (!customElements.get("clan-win-card")) {
  customElements.define("clan-win-card", ClanWinCard);
}

const member = (username: string, alive = true) => ({
  username,
  badge: { level: 10, prestige: 0, legend: false },
  alive,
});

describe("<clan-win-card>", () => {
  let card: ClanWinCard;
  afterEach(() => card?.remove());

  async function render(props: Partial<ClanWinCard>) {
    card = document.createElement("clan-win-card") as unknown as ClanWinCard;
    Object.assign(card, props);
    document.body.appendChild(card as unknown as Node);
    await card.updateComplete;
  }
  const q = (sel: string) => (card as unknown as Element).querySelector(sel);
  const qa = (sel: string) => [
    ...(card as unknown as Element).querySelectorAll(sel),
  ];

  it("on a phone the row wraps: chips get their own line, nothing is clipped", async () => {
    // Laid out for real (320 px) in the review screenshots; jsdom has no
    // layout, so this pins the classes that make it wrap.
    await render({
      clanTag: "WOLF",
      members: [member("Volt"), member("Ash")],
      territoryPct: 61,
    });
    const row = q("[data-clan-win-row]")!;
    expect(row.classList.contains("flex-wrap")).toBe(true);
    const chips = q("[data-clan-members]")!;
    expect(chips.classList.contains("basis-full")).toBe(true);
    expect(chips.classList.contains("order-last")).toBe(true);
  });

  it("shows tag, member chips and both trackers", async () => {
    await render({
      clanTag: "UN",
      members: [member("Volt"), member("Ash", false), member("Kai")],
      territoryPct: 61,
    });
    expect(q("[data-clan-tag]")!.textContent).toContain("[UN]");
    expect(qa("[data-clan-member]").map((m) => m.textContent?.trim())).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Volt"),
        expect.stringContaining("Ash"),
      ]),
    );
    expect(q("[data-card-tracker='territory']")!.textContent).toContain("61%");
    expect(q("[data-card-tracker='members_alive']")!.textContent).toContain(
      "2/3",
    );
  });

  it("dead members dimmed", async () => {
    await render({
      clanTag: "UN",
      members: [member("Volt"), member("Ash", false)],
      territoryPct: 40,
    });
    const ash = qa("[data-clan-member]").find((m) =>
      m.textContent?.includes("Ash"),
    )!;
    expect(ash.hasAttribute("data-dead")).toBe(true);
  });

  it("more than 6 members shows +N", async () => {
    await render({
      clanTag: "UN",
      members: Array.from({ length: 9 }, (_, i) => member(`P${i}`)),
      territoryPct: 40,
    });
    expect(qa("[data-clan-member]")).toHaveLength(6);
    expect(q("[data-clan-more]")!.textContent).toContain("+3");
  });
});
