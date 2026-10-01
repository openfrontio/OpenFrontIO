import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import {
  ProfileCard,
  type ProfileCardProgress,
} from "../../src/client/components/ProfileCard";

if (!customElements.get("profile-card")) {
  customElements.define("profile-card", ProfileCard);
}

const PRESTIGE_3: ProfileCardProgress = {
  prestige: 3,
  level: 47,
  legend: false,
  lifetimeXp: 212400,
  xpInLevel: 1490,
  xpForNext: 2410,
};

describe("<profile-card>", () => {
  let card: ProfileCard;

  afterEach(() => card?.remove());

  async function render(props: Partial<ProfileCard>): Promise<ProfileCard> {
    card = document.createElement("profile-card") as ProfileCard;
    Object.assign(card, props);
    document.body.appendChild(card);
    await card.updateComplete;
    return card;
  }

  const text = (sel: string) => card.querySelector(sel)?.textContent ?? null;

  it("shows the name, clan, prestige and level, the XP bar and lifetime XP", async () => {
    await render({ username: "Iamlewis", clanTag: "OF", progress: PRESTIGE_3 });
    expect(card.querySelector("[data-profile-card='full']")).not.toBeNull();
    expect(text("[data-profile-name]")).toContain("Iamlewis");
    expect(text("[data-profile-clan]")).toContain("[OF]");
    const line = text("[data-profile-level-line]")!;
    expect(line).toContain('progression.prestige:{"prestige":3}');
    expect(line).toContain('progression.level:{"level":47}');
    expect(card.querySelector("level-badge")).not.toBeNull();
    expect(
      card.querySelector("[data-xp-bar]")!.getAttribute("aria-valuenow"),
    ).toBe("62");
    expect(text("[data-profile-xp]")).toContain(
      'progression.xp_progress:{"current":"1,490","next":"2,410"}',
    );
    expect(text("[data-profile-lifetime]")).toContain("212,400");
  });

  it("never repeats the games and wins the stats below it show", async () => {
    await render({ username: "Iamlewis", progress: PRESTIGE_3 });
    expect(card.textContent).not.toContain("player_stats_tree.stats_played");
    expect(card.textContent).not.toContain("player_stats_tree.stats_victories");
  });

  it("is one row on the account page, without the lifetime XP", async () => {
    await render({
      variant: "compact",
      username: "Iamlewis",
      clanTag: "OF",
      progress: PRESTIGE_3,
    });
    expect(card.querySelector("[data-profile-card='compact']")).not.toBeNull();
    expect(text("[data-profile-name]")).toContain("Iamlewis");
    expect(text("[data-profile-level-line]")).toContain(
      'progression.level:{"level":47}',
    );
    expect(card.querySelector("[data-xp-bar]")).not.toBeNull();
    expect(card.querySelector("[data-profile-lifetime]")).toBeNull();
    expect(
      (card.querySelector("level-badge") as HTMLElement & { size: number })
        .size,
    ).toBe(64);
  });

  it("leaves prestige out before the first one, and the bar without XP-in-level", async () => {
    await render({
      username: "New",
      progress: { prestige: 0, level: 5, legend: false, lifetimeXp: 900 },
    });
    expect(text("[data-profile-level-line]")).not.toContain(
      "progression.prestige",
    );
    expect(card.querySelector("[data-xp-bar]")).toBeNull();
    expect(text("[data-profile-lifetime]")).toContain("900");
  });

  it("shows a Legend as Legend, with a full bar at max level", async () => {
    await render({
      username: "Umbra",
      progress: {
        prestige: 10,
        level: 100,
        legend: true,
        lifetimeXp: 2106720,
        xpInLevel: 0,
        xpForNext: 0,
      },
    });
    expect(text("[data-profile-level-line]")).toContain("progression.legend");
    expect(
      card.querySelector("[data-xp-bar]")!.getAttribute("aria-valuenow"),
    ).toBe("100");
    expect(text("[data-profile-xp]")).toContain("progression.max_level");
  });

  it("renders nothing while progression is off", async () => {
    await render({ username: "Player", progress: null });
    expect(card.querySelector("[data-profile-card]")).toBeNull();
  });
});
