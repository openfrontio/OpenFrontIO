import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import {
  PLAYED_OPEN_KEYS_KEPT,
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

describe("<profile-card> opening flourish", () => {
  let cards: ProfileCard[] = [];
  let openKeyCount = 0;
  const LEGEND: ProfileCardProgress = {
    prestige: 10,
    level: 100,
    legend: true,
    lifetimeXp: 2106720,
    xpInLevel: 0,
    xpForNext: 0,
  };

  // jsdom lays nothing out: a 600x220 card with its badge at the top left.
  const rect = (x: number, y: number, w: number, h: number) =>
    ({
      x,
      y,
      left: x,
      top: y,
      width: w,
      height: h,
      right: x + w,
      bottom: y + h,
      toJSON() {},
    }) as DOMRect;
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.tagName === "LEVEL-BADGE") return rect(44, 50, 120, 120);
        if (this.matches("[data-profile-card]")) return rect(20, 10, 600, 220);
        return rect(0, 0, 0, 0);
      },
    );
  });

  afterEach(() => {
    for (const c of cards) c.remove();
    cards = [];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function show(
    props: Partial<ProfileCard>,
  ): Promise<{ card: ProfileCard; section: HTMLElement }> {
    const card = document.createElement("profile-card") as ProfileCard;
    Object.assign(card, { username: "Wonder", progress: PRESTIGE_3, ...props });
    cards.push(card);
    document.body.appendChild(card);
    await card.updateComplete;
    // The pulse is measured after the first render, once the badge has drawn.
    await new Promise((r) => setTimeout(r, 0));
    await card.updateComplete;
    return {
      card,
      section: card.querySelector<HTMLElement>("[data-profile-card]")!,
    };
  }
  const freshKey = () => `test-open-${++openKeyCount}`;
  const pulseOf = (card: ProfileCard) =>
    card.querySelector<HTMLElement>("[data-profile-pulse]");
  const end = (card: ProfileCard, name: string) => {
    const svg = pulseOf(card)!.querySelector("svg")!;
    const e = new Event("animationend", { bubbles: true });
    Object.defineProperty(e, "animationName", { value: name });
    svg.dispatchEvent(e);
  };

  it("opens the full card with the blue pulse from behind the badge", async () => {
    const { card, section } = await show({ openKey: freshKey() });
    expect(section.classList.contains("profile-card-intro")).toBe(true);
    const pulse = pulseOf(card)!;
    expect(pulse.dataset.profilePulse).toBe("blue");
    const svg = pulse.querySelector<SVGElement>("svg")!;
    expect(svg.classList.contains("profile-card-pulse-blue")).toBe(true);
    // Centred on the badge, in the card's own pixels, reaching the farthest
    // corner and a band past it.
    expect(svg.style.getPropertyValue("--cx")).toBe("84px");
    expect(svg.style.getPropertyValue("--cy")).toBe("100px");
    expect(svg.style.getPropertyValue("--reach")).toBe(
      `${Math.round(Math.hypot(600 - 84, 220 - 100) + 90)}px`,
    );
    // Its own copy of the card's pattern, not the card's.
    expect(svg.querySelector("pattern")!.id).not.toBe(
      section.querySelector(":scope > svg pattern")!.id,
    );
  });

  it("draws its patterns as SVG, so they show", async () => {
    const { card, section } = await show({ openKey: freshKey() });
    const SVG = "http://www.w3.org/2000/svg";
    for (const path of [
      section.querySelector(":scope > svg pattern path")!,
      pulseOf(card)!.querySelector("pattern path")!,
    ]) {
      expect(path.namespaceURI).toBe(SVG);
    }
  });

  it("removes the pulse once it has played", async () => {
    const { card } = await show({ openKey: freshKey() });
    // The rings ending isn't the end: the fade is.
    end(card, "profile-card-wave2");
    await card.updateComplete;
    expect(pulseOf(card)).not.toBeNull();
    end(card, "profile-card-pulse-fade");
    await card.updateComplete;
    expect(pulseOf(card)).toBeNull();
  });

  it("plays once per opening, not again when the card is rebuilt", async () => {
    const key = freshKey();
    const first = await show({ openKey: key });
    expect(pulseOf(first.card)).not.toBeNull();
    // A tab switch builds a new card for the same opening.
    const again = await show({ openKey: key });
    expect(again.section.classList.contains("profile-card-intro")).toBe(false);
    expect(pulseOf(again.card)).toBeNull();
    // A new opening plays it again.
    const reopened = await show({ openKey: freshKey() });
    expect(pulseOf(reopened.card)).not.toBeNull();
  });

  it("remembers only the latest openings, not every one", async () => {
    const oldest = freshKey();
    await show({ openKey: oldest });
    let latest = oldest;
    for (let i = 0; i < PLAYED_OPEN_KEYS_KEPT; i++) {
      latest = freshKey();
      await show({ openKey: latest });
    }
    // The latest are still remembered.
    expect(pulseOf((await show({ openKey: latest })).card)).toBeNull();
    // The oldest has been let go: its page has long since opened again
    // under a new key, so it never comes up.
    expect(pulseOf((await show({ openKey: oldest })).card)).not.toBeNull();
  });

  it("never on the compact card", async () => {
    const { card, section } = await show({
      variant: "compact",
      openKey: freshKey(),
    });
    expect(section.classList.contains("profile-card-intro")).toBe(false);
    expect(pulseOf(card)).toBeNull();
  });

  it("never under reduced motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({ matches: query.includes("reduce") })),
    );
    const { card, section } = await show({ openKey: freshKey() });
    expect(section.classList.contains("profile-card-intro")).toBe(false);
    expect(pulseOf(card)).toBeNull();
  });

  it("never on a hidden page", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const { card } = await show({ openKey: freshKey() });
    expect(pulseOf(card)).toBeNull();
  });

  it("dresses a Legend's full card in gold, with the gold pulse", async () => {
    const { card, section } = await show({
      progress: LEGEND,
      openKey: freshKey(),
    });
    expect(section.classList.contains("profile-card-legend")).toBe(true);
    expect(
      section
        .querySelector(":scope > svg pattern path")!
        .getAttribute("stroke"),
    ).toBe("#facc15");
    expect(pulseOf(card)!.dataset.profilePulse).toBe("gold");
    // It keeps coming back until its last ring (the animation's 8th run).
    end(card, "profile-card-pulse-fade");
    await card.updateComplete;
    expect(pulseOf(card)).not.toBeNull();
    end(card, "profile-card-gold-ring");
    await card.updateComplete;
    expect(pulseOf(card)).toBeNull();
  });

  it("stops the gold pulse when the page is hidden", async () => {
    const { card } = await show({ progress: LEGEND, openKey: freshKey() });
    expect(pulseOf(card)).not.toBeNull();
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await card.updateComplete;
    expect(pulseOf(card)).toBeNull();
    visibility.mockRestore();
  });

  it("stops the gold pulse when the card leaves the page", async () => {
    const { card } = await show({ progress: LEGEND, openKey: freshKey() });
    card.remove();
    document.body.appendChild(card);
    await card.updateComplete;
    expect(pulseOf(card)).toBeNull();
  });

  it("keeps a Legend's compact card plain", async () => {
    const { section } = await show({
      variant: "compact",
      progress: LEGEND,
      openKey: freshKey(),
    });
    expect(section.classList.contains("profile-card-legend")).toBe(false);
  });

  it("pulses the Prestige button's glow with opacity only", async () => {
    await show({
      progress: { ...PRESTIGE_3, level: 100, canPrestige: true },
      prestigeable: true,
    });
    const css = document.getElementById("profile-card-styles")!.textContent!;
    const keyframes = /@keyframes profile-prestige-glow \{([^}]*\})/.exec(
      css,
    )![1];
    expect(keyframes).toContain("opacity");
    expect(keyframes).not.toContain("box-shadow");
    expect(css).not.toContain("profile-prestige-pulse");
  });
});
